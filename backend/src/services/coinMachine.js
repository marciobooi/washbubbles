import EventEmitter from 'events'
import middleware from './middleware.js'
import Client from './client.js'
import Setting from '../models/setting.js'
import Machine from '../models/machine.js'
import Interface from '../models/interface.js'
import Peripheral from '../models/peripheral.js'
import Sale from '../models/sale.js'
import Price from '../models/price.js'
import Card from '../models/card.js'
import { broadcastMachine, broadcastMachines, broadcastHardwareEvent } from '../wsServer.js'
import { roundMoney } from '../utils/money.js'
import { isChannelBusy } from './lowLevel.js'
import { CardSync } from './cardSync.js'
import { isBlankCard } from './blankCard.js'
import { Uplink } from './uplink.js'
import { Downlink } from './downlink.js'
import { RemoteCommands } from './remoteCommands.js'
import { prefetchUploads } from './uploadsCache.js'
import { uploadDir } from '../routes/admin.js'
import { CashSessionStore } from './cashSession.js'
import AuditLog from '../models/auditLog.js'
import { reportFault } from './maintenance.js'
import { sendCycleCompleteMessage } from './whatsapp.js'
import { incrementCashDrawer } from './cashDrawer.js'

/** Consecutive idle readings required before a running machine is freed. */
const IDLE_READINGS_TO_FREE = 3

/**
 * CoinMachine coordinator - integrates middleware, client state, and backend API
 * Based on the coin-machine module from the old program
 */
class CoinMachine extends EventEmitter {
  constructor(options = {}) {
    super()
    
    this.middleware = options.middleware || middleware
    this.client = new Client()
    this.settings = null
    this.running = false
    this.subscriptions = []
    this.machines = new Map() // Track machine states
    /**
     * Consecutive "idle" status readings per machine.
     *
     * Hardware status is noisy and arrives several times a second; one dropped
     * bit must not end a paid cycle. See handleMachineStatusUpdate.
     */
    this.idleReadings = new Map()
    /**
     * The tenant whose hardware this process drives.
     *
     * The coin machine is a singleton wired to the serial ports physically
     * attached to THIS server, which belong to exactly one site. Every query
     * here used to be unscoped: `Setting.findOne({key})` returned whichever
     * tenant's row Mongo happened to hand back, so one operator's bonus rate was
     * applied to another's coins, and `Machine.findOne({intId})` could start a
     * different tenant's machine on someone else's payment.
     */
    this.tenantId = options.tenantId || null

    // Unspent cash is paid back after the kiosk has been left alone for a while (see refundCredit).
    this.lastCreditActivity = Date.now()
    this.refunding = null
    this.refundTimer = null
  }

  /** Scope a filter to this machine's tenant. Fails closed if none is resolved. */
  scoped(filter = {}) {
    return { ...filter, tenantId: this.tenantId }
  }

  /**
   * Work out which tenant this hardware belongs to.
   *
   * Explicit env config wins; otherwise a single-tenant install resolves
   * unambiguously. With several tenants and no config we refuse to start the
   * hardware rather than guess whose money it is.
   */
  async resolveTenant() {
    if (this.tenantId) return this.tenantId

    const configured = process.env.COIN_MACHINE_TENANT_ID
    if (configured) {
      this.tenantId = configured
      return this.tenantId
    }

    const Tenant = (await import('../models/tenant.js')).default
    const tenants = await Tenant.find().limit(2).lean()
    if (tenants.length === 1) {
      this.tenantId = tenants[0]._id
      console.log(`[CoinMachine] Bound to sole tenant ${tenants[0].name}`)
      return this.tenantId
    }

    throw new Error(
      tenants.length === 0
        ? 'No tenant exists — cannot start the coin machine'
        : 'Multiple tenants exist: set COIN_MACHINE_TENANT_ID to the site this server drives'
    )
  }

  /**
   * Start the coin machine system
   */
  async start() {
    if (this.running) {
      console.log('CoinMachine already running')
      return
    }

    try {
      console.log('Starting CoinMachine...')

      // Must come first — everything below is scoped to this tenant.
      await this.resolveTenant()

      // The central server is the source of truth for machines, prices, settings and
      // hardware config. Pull once BEFORE loading them so a new/empty site comes up
      // already configured; offline just keeps what is stored locally (no-op unless
      // SYNC_SERVER_URL / SYNC_API_KEY are set).
      this.downlink = new Downlink({ tenantId: this.tenantId })
      // Whatever the central server changed (refund time, coin/bill codes, bonuses) takes effect
      // on the next pull, not only after a restart.
      this.downlink.on('synced', () => {
        this.loadSettings().catch(() => {})
        this.middleware.loadEquivalenceTables?.().catch?.(() => {})
        // An operator may have taken a machine out of service (or back) on the central server.
        broadcastMachines?.().catch?.(() => {})
        // Keep a copy of the pictures the settings mention (logo, banners) so they also show offline.
        prefetchUploads({ SettingModel: Setting, tenantId: this.tenantId, uploadDir }).catch(() => {})
      })
      await this.downlink.pullAll()
      this.downlink.start()

      // Load settings
      await this.loadSettings()

      // Initialize middleware connections
      await this.middleware.initialize()

      // Card <-> database balance sync (controller mode only; a no-op otherwise).
      this.cardSync = new CardSync({ middleware: this.middleware, tenantId: this.tenantId })
      this.cardSync.start()

      // Offline-first: sales, card balances and day-closes are queued locally and
      // pushed to the central server whenever it can be reached (no-op unless
      // SYNC_SERVER_URL / SYNC_API_KEY are set).
      this.uplink = new Uplink({ tenantId: this.tenantId })
      this.uplink.start()

      // The central admin can start or release a machine here with no payment: its request
      // is queued on the server and picked up by this poller (no-op unless sync is configured).
      this.remoteCommands = new RemoteCommands({
        handlers: {
          start_machine: (p) => this.adminStartMachine(p.machineId, p.blocks),
          end_machine: (p) => this.adminEndMachine(p.machineId),
          set_service: (p) => this.setMachineService(p.machineId, p.outOfService, p.status),
          empty_hopper: async () => {
            const r = await this.emptyHopper()
            if (!(r.dispensed > 0)) throw new Error(r.error || 'Nenhuma moeda saiu do hopper')
            return r
          },
          blank_card: async () => this.blankCardAtReader(),
          gift_card: async (p) => { const { issueGiftCard } = await import('./giftCard.js'); return issueGiftCard({ tenantId: this.tenantId }, this, { ...p, by: p?.by || 'admin (central)' }) },
          sync_now: async () => { await this.downlink?.pullAll?.(); return { success: true } },
        },
      })
      this.remoteCommands.start()
      // Back online after an outage: send what piled up now (the uplink's own back-off can be minutes) and refresh prices/settings.
      this.remoteCommands.on('online', () => {
        console.log('[Sync] central server reachable again — sending what was recorded offline')
        if (this.uplink) this.uplink.nextTryAt = 0
        this.uplink?.flush?.().catch(() => {})
        this.downlink?.pullAll?.().catch?.(() => {})
      })
      this.remoteCommands.on('offline', () => console.warn('[Sync] central server not reachable — working offline, everything is kept and sent later'))
      // MB WAY payments nobody is waiting for any more are still followed to the end (see services/mbway.js).
      import('./mbway.js').then((m) => m.startSweeper()).catch((e) => console.error('[MBWAY] sweeper not started:', e.message))

      // Cash already inserted survives a crash / power cut. Restore FIRST, then
      // start persisting (subscribing saves the current state immediately, which
      // would otherwise wipe the very file we are about to read).
      this.cashStore = new CashSessionStore({ tenantId: this.tenantId })
      await this.restoreCashSession()
      this.cashSub = this.client.subscribe((state) => this.cashStore.save({ balance: state.balance, bonus: state.bonus }))
      
      // Set up event handlers
      this.setupEventHandlers()
      
      this.startCreditRefundWatch()
      this.startImpulseScheduler()
      this.running = true
      this.emit('started')
      
      console.log('CoinMachine started successfully')
    } catch (err) {
      console.error('Failed to start CoinMachine:', err)
      throw err
    }
  }

  /** Record a system-generated event for the operator. Never throws. */
  async auditSystem(action, details) {
    try {
      await AuditLog.create({
        tenantId: this.tenantId, actorUsername: 'system', action,
        targetType: 'CashSession', targetId: '', details,
      })
    } catch (err) {
      console.error('[CashSession] audit write failed:', err.message)
    }
  }

  /** Give a customer back the cash they had inserted before a restart. */
  async restoreCashSession() {
    const r = this.cashStore.take()
    if (!r) return

    if (r.expired) {
      const { balance, bonus, ageMs } = r.expired
      const minutes = Math.round(ageMs / 60000)
      console.warn(`[CashSession] €${balance.toFixed(2)} inserted ${minutes} min before the restart was NOT restored (too old — the customer has gone). Recorded for the operator.`)
      await this.auditSystem('cash.session.expired', { balance, bonus, minutesAgo: minutes })
      this.emit('session-expired', { balance, bonus, minutes })
      return
    }

    this.client.client.balance = r.balance
    this.client.client.bonus = r.bonus
    this.client.updateCredits()
    this.touchCredit() // a fresh idle period before it is paid back
    console.warn(`[CashSession] Recovered €${r.balance.toFixed(2)} of inserted cash from before the restart`)
    await this.auditSystem('cash.session.recovered', { balance: r.balance, bonus: r.bonus, secondsAgo: Math.round(r.ageMs / 1000) })
    this.emit('session-recovered', { balance: r.balance, bonus: r.bonus })
  }

  /**
   * Stop the coin machine system
   */
  async stop() {
    if (!this.running) {
      return
    }

    console.log('Stopping CoinMachine...')
    
    // Save any pending card data
    await this.client.saveCardBalance()
    
    this.cardSync?.stop()
    this.uplink?.stop()
    this.downlink?.stop()
    this.remoteCommands?.stop()
    this.stopCreditRefundWatch()
    this.stopImpulseScheduler?.()
    // (the cash-session file is deliberately kept: money still in the session is restored on the next start)
    this.cashSub?.unsubscribe()

    // Disconnect all peripherals
    await this.middleware.disconnectAll()
    
    // Clean up subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe())
    this.subscriptions = []
    
    this.running = false
    this.emit('stopped')
    
    console.log('CoinMachine stopped')
  }

  /**
   * Load app settings (coin/bill equivalence tables, bonuses, auto-charge)
   */
  async loadSettings() {
    try {
      const coinEqSetting = await Setting.findOne(this.scoped({ key: 'coinEqTable' }))
      const billEqSetting = await Setting.findOne(this.scoped({ key: 'billEqTable' }))
      const rechargeCoinBonus = await Setting.findOne(this.scoped({ key: 'rechargeCoinBonus' }))
      const rechargeBillBonus = await Setting.findOne(this.scoped({ key: 'rechargeBillBonus' }))
      const autoCharge = await Setting.findOne(this.scoped({ key: 'autoCharge' }))
      const creditRefundSeconds = await Setting.findOne(this.scoped({ key: 'creditRefundSeconds' }))
      
      this.settings = {
        coinEqTable: coinEqSetting?.value || [],
        billEqTable: billEqSetting?.value || [],
        rechargeCoinBonus: rechargeCoinBonus?.value || 0,
        rechargeBillBonus: rechargeBillBonus?.value || 0,
        autoCharge: autoCharge?.value || false,
        creditRefundSeconds: creditRefundSeconds?.value ?? 120
      }
      
      console.log('Loaded coin/bill equivalence tables')
    } catch (err) {
      console.warn('Failed to load settings, using defaults:', err)
      this.settings = {
        coinEqTable: [],
        billEqTable: [],
        rechargeCoinBonus: 0,
        rechargeBillBonus: 0,
        autoCharge: false
      }
    }
  }

  /**
   * Set up event handlers for middleware events
   */
  setupEventHandlers() {
    // Coin inserted
    const coinSub = this.middleware.subscribe('coin-inserted', (data) => {
      this.handleCoinInserted(data)
    })
    this.subscriptions.push(coinSub)

    // Bill inserted
    const billSub = this.middleware.subscribe('bill-inserted', (data) => {
      this.handleBillInserted(data)
    })
    this.subscriptions.push(billSub)

    // Card read
    const cardSub = this.middleware.subscribe('card-read', (data) => {
      this.handleCardRead(data)
    })
    this.subscriptions.push(cardSub)

    // Card dispensed
    const dispenseSub = this.middleware.subscribe('card-dispensed', (data) => {
      this.handleCardDispensed(data)
    })
    this.subscriptions.push(dispenseSub)

    // Remote credits
    const remoteSub = this.middleware.subscribe('remote-credits', (data) => {
      this.handleRemoteCredits(data)
    })
    this.subscriptions.push(remoteSub)

    // Card removed
    const cardRemoveSub = this.middleware.subscribe('card-removed', () => {
      this.handleCardRemoved()
    })
    this.subscriptions.push(cardRemoveSub)

    // Machine events
    const machineStartedSub = this.middleware.subscribe('machine-started', (data) => {
      this.handleMachineStarted(data)
    })
    this.subscriptions.push(machineStartedSub)

    const machineReservedSub = this.middleware.subscribe('machine-reserved', (data) => {
      this.handleMachineReserved(data)
    })
    this.subscriptions.push(machineReservedSub)

    // `middleware.js` has always emitted `machine-res-canceled`, but nothing
    // listened — so a cancelled reservation left the machine `reserved` forever,
    // unbookable by anyone, while `activateMachine` would still start it.
    const machineResCanceledSub = this.middleware.subscribe('machine-res-canceled', (data) => {
      this.handleMachineReservationCanceled(data)
    })
    this.subscriptions.push(machineResCanceledSub)

    const machineIssueSub = this.middleware.subscribe('machine-issue', (data) => {
      this.handleMachineIssue(data)
    })
    this.subscriptions.push(machineIssueSub)

    const statusIntSub = this.middleware.subscribe('status_int', (data) => {
      this.handleStatusInt(data)
    })
    this.subscriptions.push(statusIntSub)

    // Interface machine status updates (door, occupied, fault, etc.)
    const machineStatusSub = this.middleware.subscribe('machine-status-update', (data) => {
      this.handleMachineStatusUpdate(data)
    })
    this.subscriptions.push(machineStatusSub)

    // Same, but read from the low-level controller's `status_int` reply.
    const gatewayStatusSub = this.middleware.subscribe('gateway-machine-status', (data) => {
      this.handleGatewayMachineStatus(data)
    })
    this.subscriptions.push(gatewayStatusSub)

    const machineFaultSub = this.middleware.subscribe('machine-fault', (data) => {
      this.handleMachineFault(data)
    })
    this.subscriptions.push(machineFaultSub)

    // Coin/bill rejection events
    const coinRejectedSub = this.middleware.subscribe('coin-rejected', (data) => {
      this.handleCoinRejected(data)
    })
    this.subscriptions.push(coinRejectedSub)

    const billRejectedSub = this.middleware.subscribe('bill-rejected', (data) => {
      this.handleBillRejected(data)
    })
    this.subscriptions.push(billRejectedSub)

    // Hopper events
    const hopperEmptySub = this.middleware.subscribe('hopper-empty', (data) => {
      this.handleHopperEmpty(data)
    })
    this.subscriptions.push(hopperEmptySub)

    const hopperFaultSub = this.middleware.subscribe('hopper-fault', (data) => {
      this.handleHopperFault(data)
    })
    this.subscriptions.push(hopperFaultSub)

    // The hardware bridge keeps the controller session alive across restarts of this program; it tells us
    // when the session is brand new or lost, which is when the bill acceptor may have been switched off.
    const bridgeSub = this.middleware.subscribe('bridge-status', (s) => {
      this.handleBridgeStatus(s).catch((e) => console.error('[Bridge] status handling failed:', e.message))
    })
    this.subscriptions.push(bridgeSub)
    // The first status of a run arrives before the line above exists: handle the one the middleware kept.
    const kept = this.middleware.bridgeStatus
    if (kept) {
      const age = Number(kept.sessionAgeMs) + (Date.now() - (kept.receivedAt || Date.now()))
      this.handleBridgeStatus({ ...kept, sessionAgeMs: age }).catch((e) => console.error('[Bridge] status handling failed:', e.message))
    }
  }

  /** Warn the operator when the controller session is new or lost (the bill acceptor may be off). */
  async handleBridgeStatus(s) {
    const now = Date.now()
    let subject = null
    let message = null
    if (s.controller === 'disconnected') {
      subject = 'Controlador desligado'
      message = 'A ligação ao controlador do hardware perdeu-se. Moedas, notas e cartões não funcionam até voltar.'
    } else if (s.controller === 'connected' && Number(s.sessionAgeMs) < 5 * 60_000) {
      subject = 'Controlador reiniciado - verificar leitor de notas'
      message = 'A sessão com o controlador é nova. O leitor de notas pode ter ficado desligado: se a luz estiver apagada, volte a ligar o cabo do leitor.'
    }
    // A NEW controller session (the PC just started, or the controller restarted): the controller has switched the bill acceptor off
    // and a plain reconnect does not bring it back, only the complete peripheral list does. Send it by ourselves, once per session,
    // so nobody has to re-seat a cable after a reboot. (A backend restart alone keeps the old session: nothing is sent.)
    if (s.controller === 'disconnected') this.autoReinitDone = false
    else if (s.controller === 'connected' && Number(s.sessionAgeMs) < 5 * 60_000 && !this.autoReinitDone) {
      this.autoReinitDone = true
      const timer = setTimeout(() => {
        console.log('[Bridge] new controller session: re-initialising the peripherals')
        this.middleware.reinitPeripherals(['all']).catch((e) => console.error('[Bridge] re-init failed:', e.message))
      }, 8000)
      timer.unref?.()
    }
    if (!subject) return
    if (this.lastBridgeAlert && now - this.lastBridgeAlert.at < 10 * 60_000 && this.lastBridgeAlert.subject === subject) return
    this.lastBridgeAlert = { at: now, subject }
    console.warn(`[Bridge] ${subject}`)
    await this.auditSystem('controller.session', { controller: s.controller, sessionAgeMs: s.sessionAgeMs })
    broadcastHardwareEvent(this.tenantId, 'controller:session', { controller: s.controller, fresh: subject.startsWith('Controlador reiniciado') })
    try {
      const { sendAlertForTenant } = await import('./alerts.js')
      await sendAlertForTenant(this.tenantId, subject, message)
    } catch (e) { console.error('[Bridge] alert not sent:', e.message) }
  }

  /**
   * Handle coin rejected (bad coin, foreign, slug)
   */
  handleCoinRejected(data) {
    const { peripheral, reason, code, exact } = data
    this.emit('coin-rejected', { peripheral, reason, code, exact })
    console.warn(`Coin rejected: ${reason || 'unknown reason'}`)
    // Signature is (tenantId, type, payload). Called with two args the tenant
    // became the event name and the payload the type, so these alerts — fraud
    // included — reached nobody.
    broadcastHardwareEvent(this.tenantId, 'peripheral:rejected', { type: 'coin', reason: reason || 'rejected', code, exact })
  }

  /**
   * Handle bill rejected (bad bill, unrecognised, fraud/fake, jammed)
   */
  handleBillRejected(data) {
    const { peripheral, reason, fraud, code, exact } = data
    const eventType = fraud ? 'peripheral:fraud' : 'peripheral:rejected'
    this.emit('bill-rejected', { peripheral, reason, fraud, code, exact })
    console.warn(`Bill ${fraud ? 'FRAUD' : 'rejected'}: ${reason || 'unknown reason'}`)
    broadcastHardwareEvent(this.tenantId, eventType, { type: 'bill', reason: reason || 'rejected', fraud: !!fraud, code, exact })
  }

  /**
   * Handle hopper empty — cannot dispense change
   */
  handleHopperEmpty(data) {
    this.emit('hopper-empty', data)
    console.error('Hopper empty — cannot dispense change!')
    broadcastHardwareEvent(this.tenantId, 'hopper:empty', { message: 'Hopper is empty, change cannot be dispensed' })
  }

  /**
   * Handle hopper fault
   */
  handleHopperFault(data) {
    this.emit('hopper-fault', data)
    console.error('Hopper fault:', data)
    broadcastHardwareEvent(this.tenantId, 'hopper:fault', data)
  }

  /**
   * Handle coin insertion
   */
  handleCoinInserted(data) {
    const { value, code, exact } = data

    // The middleware has already turned the device code into euros (`code` is
    // present). Only a bare value with no code still needs the table — mapping an
    // already-resolved euro amount again could collide with a decimal code.
    const mappedValue = code === undefined ? this.applyCoinEquivalence(value) : value
    
    // Calculate bonus
    let bonusValue = 0
    if (this.settings.rechargeCoinBonus > 0) {
      bonusValue = roundMoney((mappedValue * this.settings.rechargeCoinBonus) / 100)
      this.client.client.bonusArr.push(bonusValue)
      this.client.client.bonus = roundMoney(this.client.client.bonus + bonusValue)
    }

    // Auto-charge bookkeeping. `moneyArr` is a record of what went in; the coin
    // is NOT also queued as a card credit here. It used to be pushed into
    // `chargedArr` *and* added to the spendable balance below, so €5 in became €5
    // to spend now plus €5 on the card at removal. The unspent remainder is what
    // transfers to the card — see `client.sendChargeRequest`.
    if (this.settings.autoCharge && this.client.client.hasCard) {
      this.client.client.moneyArr.push(mappedValue)
    }

    this.client.addToBalance(mappedValue)
    this.touchCredit()
    incrementCashDrawer(this.tenantId, mappedValue)
    this.emit('coin-inserted', {
      value: mappedValue,
      bonus: bonusValue,
      balance: this.client.getState().balance
    })
    // Lets the coin-calibration wizard learn/confirm a channel code even when
    // it's already mapped (re-inserting an accepted coin), not just unmapped ones.
    broadcastHardwareEvent(this.tenantId, 'peripheral:accepted', { type: 'coin', value: mappedValue, code, exact })
    // The kiosk page's cash counter (CartModal) listens for this message; without it the
    // coin is credited in the backend but nothing shows on screen.
    broadcastHardwareEvent(this.tenantId, 'peripheral:credit', { type: 'coin', amount: mappedValue })

    console.log(`Coin inserted: €${mappedValue.toFixed(2)}${bonusValue > 0 ? ` + €${bonusValue.toFixed(2)} bonus` : ''}, Total: €${this.client.getState().credits.toFixed(2)}`)
  }

  /**
   * Handle bill insertion
   */
  handleBillInserted(data) {
    const { value, code, exact } = data

    // See handleCoinInserted: already euros when `code` is present.
    const mappedValue = code === undefined ? this.applyBillEquivalence(value) : value
    
    // Calculate bonus
    let bonusValue = 0
    if (this.settings.rechargeBillBonus > 0) {
      bonusValue = roundMoney((mappedValue * this.settings.rechargeBillBonus) / 100)
      this.client.client.bonusArr.push(bonusValue)
      this.client.client.bonus = roundMoney(this.client.client.bonus + bonusValue)
    }

    // See handleCoinInserted: the note is not queued as a card credit here, only
    // recorded. The unspent remainder transfers on card removal.
    if (this.settings.autoCharge && this.client.client.hasCard) {
      this.client.client.moneyArr.push(mappedValue)
    }
    
    this.client.addToBalance(mappedValue)
    this.touchCredit()
    incrementCashDrawer(this.tenantId, mappedValue)
    this.emit('bill-inserted', {
      value: mappedValue,
      bonus: bonusValue,
      balance: this.client.getState().balance
    })
    broadcastHardwareEvent(this.tenantId, 'peripheral:accepted', { type: 'bill', value: mappedValue, code, exact })
    broadcastHardwareEvent(this.tenantId, 'peripheral:credit', { type: 'bill', amount: mappedValue })

    console.log(`Bill inserted: €${mappedValue.toFixed(2)}${bonusValue > 0 ? ` + €${bonusValue.toFixed(2)} bonus` : ''}, Total: €${this.client.getState().credits.toFixed(2)}`)
  }

  /**
   * Handle remote credits from backend/admin
   */
  handleRemoteCredits(data) {
    // Remote credits data is in cents, convert to euros
    const value = data.value ? Math.round(Number(data.value)) / 100 : 0
    
    this.client.client.credits = value
    this.client.addToBalance(value)
    
    // Send acknowledgment back to middleware
    this.middleware.send({ op: 'remote-credits-res', data: value.toString() })
    
    this.emit('remote-credits', { value, balance: this.client.getState().balance })
    console.log(`Remote credits received: €${value.toFixed(2)}`)
  }

  /**
   * Handle card removed event
   */
  async handleCardRemoved() {
    this.currentBlank = null
    await this.client.resetCardInfo()
    this.emit('card-removed')
    broadcastHardwareEvent(this.tenantId, 'rfid:card_removed', {})
    console.log('Card removed')
  }

  /**
   * Handle card read
   */
  async handleCardRead(data) {
    const { cardNumber } = data

    // A BLANK card at the reader (just dispensed after a purchase): write the purchase onto it now.
    if (data.card && isBlankCard(data.card)) {
      this.currentBlank = String(data.card.cardId)
      await this.activatePendingCard(this.currentBlank)
      return
    }

    // Controller mode: the card carries its own balance and identity. Adopt an
    // unknown card, or settle any disagreement with our record, BEFORE loading it.
    if (data.card && this.cardSync?.enabled) {
      let r
      try {
        r = await this.cardSync.reconcile(data.card)
      } catch (err) {
        console.error('[CardSync] reconcile failed:', err)
      }
      if (r?.status === 'invalid') {
        this.emit('card-invalid', { cardNumber, reason: r.reason })
        console.warn(`Card ${cardNumber} refused: ${r.reason}`)
        return
      }
      // The same card re-reported (e.g. the controller echoes it after a write):
      // nothing changed, don't reload and disturb the session.
      if (r?.status === 'in-sync' && this.client.getState().cardNumber === cardNumber) return
    }
    
    const loaded = await this.client.setClientInfoByCard(cardNumber)
    
    if (loaded) {
      this.emit('card-loaded', { client: this.client.getState() })
      console.log(`Card loaded: ${cardNumber}, Balance: €${this.client.getState().balanceCard.toFixed(2)}`)
      // The kiosk screens load the card (balance, history) and auto-pay from this message. The old hardware
      // agent sent it; the controller path never did, so the screen showed no balance for a card in the reader.
      broadcastHardwareEvent(this.tenantId, 'rfid:card_detected', { cardCode: String(cardNumber), balance: this.client.getState().balanceCard })
    } else {
      this.emit('card-invalid', { cardNumber })
      console.warn(`Invalid card: ${cardNumber}`)
    }
  }

  /**
   * Write a purchased card: put its id and balance on the blank card in the reader, then make it
   * spendable. One write per card at a time (the kiosk screen may ask for the same thing).
   */
  async activateCard(code) {
    this.activating = this.activating || new Map()
    if (this.activating.has(code)) return this.activating.get(code)
    const job = (async () => {
      const card = await Card.findOne(this.scoped({ code }))
      if (!card) throw new Error('Card not found')
      if (card.status === 'blocked') throw new Error('Card is blocked')
      const reader = await Peripheral.findOne(this.scoped({ type: 'rfid_reader', enabled: true }))
      if (!reader) throw new Error('No RFID reader configured')
      // Throws when it cannot verify the write: a card we never touched is never reported as written.
      await this.middleware.writeCardData(reader._id, {
        code: card.code, balance: card.balance, name: card.name, email: card.email, phone: card.phone, contribuinte: card.contribuinte,
      })
      card.status = 'active'
      await card.save()
      const CardPurchase = (await import('../models/cardPurchase.js')).default
      await CardPurchase.findOneAndUpdate({ tenantId: this.tenantId, cardCode: code }, { cardWritten: true })
      await this.auditSystem('card.activate', { code, balance: card.balance })
      console.log(`[Card] ${code} written and activated with EUR ${Number(card.balance).toFixed(2)}`)
      broadcastHardwareEvent(this.tenantId, 'rfid:card_detected', { cardCode: String(code), balance: card.balance })
      return card
    })().finally(() => { this.activating.delete(code) })
    this.activating.set(code, job)
    return job
  }

  /** A card with no id put in the reader by a customer is registered and written (balance 0). Off with AUTO_REGISTER_BLANK_CARDS=false. */
  get autoRegisterBlankCards() { return String(process.env.AUTO_REGISTER_BLANK_CARDS || 'true').toLowerCase() !== 'false' }

  /**
   * A blank card, no purchase waiting for it: give it an identity. Its own chip id becomes the card code, the record starts
   * at ZERO (no money is created: it is loaded with cash like any card), and the id and balance are written onto the chip.
   *  - a card of ours that already exists under this chip id (the chip was wiped or lost its data) is written back from the
   *    database instead, so the customer gets their card and balance back;
   *  - a chip wiped by staff a moment ago ("Limpar cartão") is left alone, so recycling is not undone by the reader's echo.
   */
  async registerBlankCard(chipId) {
    const recent = this.recentlyBlanked?.get(chipId)
    if (recent && Date.now() - recent < 10 * 60_000) {
      console.log(`[Card] ${chipId} was wiped by staff a moment ago: not registering it again`)
      return null
    }
    const existing = await Card.findOne(this.scoped({ code: chipId }))
    if (existing) {
      if (existing.status === 'blocked') return null
      console.log(`[Card] blank chip of known card ${chipId}: writing its record (EUR ${Number(existing.balance).toFixed(2)}) back onto the card`)
      return this.activateCard(chipId)
    }
    await Card.create({
      tenantId: this.tenantId, code: chipId, balance: 0, status: 'pending_write',
      metadata: { autoRegistered: { at: new Date(), from: 'blank-card-at-reader' } },
    })
    await this.auditSystem('card.register_blank', { code: chipId, balance: 0 })
    console.log(`[Card] blank card ${chipId} registered with EUR 0.00; writing it`)
    return this.activateCard(chipId)
  }

  /** A blank card was read: write the most recent purchase that is still waiting for its card. */
  async activatePendingCard(chipId = null) {
    const pending = await Card.findOne(this.scoped({ status: 'pending_write', createdAt: { $gte: new Date(Date.now() - 30 * 60_000) } })).sort({ createdAt: -1 })
    if (!pending) {
      // No purchase is waiting for this card. A customer's own card that has no id yet is registered now (see registerBlankCard).
      if (chipId && this.autoRegisterBlankCards) {
        try { return await this.registerBlankCard(String(chipId)) } catch (err) {
          console.error(`[Card] could not register the blank card ${chipId}: ${err.message}`)
          return null
        }
      }
      console.warn('[Card] A blank card was presented and there is no purchase waiting for one')
      this.emit('card-invalid', { cardNumber: null, reason: 'blank-card-no-purchase' })
      return null
    }
    try {
      // The chip keeps the id its reader gave it and ignores the one we generate. The purchase takes the
      // chip's id as its code from here on; otherwise the next read finds an unknown id and adopts a
      // second, separate card.
      if (chipId && String(chipId) !== String(pending.code)) {
        const taken = await Card.findOne(this.scoped({ code: String(chipId) }))
        if (taken) throw new Error(`the card id ${chipId} already belongs to another card`)
        const oldCode = pending.code
        pending.code = String(chipId)
        pending.metadata = { ...(pending.metadata || {}), previousCode: oldCode }
        pending.markModified('metadata')
        await pending.save()
        const CardPurchase = (await import('../models/cardPurchase.js')).default
        await CardPurchase.updateMany({ tenantId: this.tenantId, cardCode: oldCode }, { cardCode: String(chipId) })
        await Sale.updateMany({ tenantId: this.tenantId, cardCode: oldCode }, { cardCode: String(chipId) })
        console.log(`[Card] purchase ${oldCode} now uses the chip's own id ${chipId}`)
      }
      return await this.activateCard(pending.code)
    } catch (err) {
      console.error(`[Card] could not write the purchased card ${pending.code}: ${err.message} (it stays pending, the customer can retry)`)
      return null
    }
  }

  /**
   * Handle card dispensed
   */
  handleCardDispensed(data) {
    this.emit('card-dispensed', data)
    console.log('Card dispensed successfully')
  }

  /**
   * Apply coin equivalence table
   */
  applyCoinEquivalence(value) {
    if (!this.settings.coinEqTable || this.settings.coinEqTable.length === 0) {
      return value
    }

    const mapping = this.settings.coinEqTable.find(entry => entry.key === value.toString())
    return mapping ? mapping.value : value
  }

  /**
   * Apply bill equivalence table
   */
  applyBillEquivalence(value) {
    if (!this.settings.billEqTable || this.settings.billEqTable.length === 0) {
      return value
    }

    const mapping = this.settings.billEqTable.find(entry => entry.key === value.toString())
    return mapping ? mapping.value : value
  }

  /**
   * Process payment for a machine
   */
  /**
   * Take payment for a machine from the customer's combined credits.
   *
   * Coins and card balance are one pot: €3 on the card plus €2 in coins buys a €5
   * wash. `paymentType` restricts which sources may be used when the operator
   * wants to force one; 'auto' (the default) spends cash first, then the card.
   *
   * The old version computed a `useCard` flag that `deductCredits` then ignored —
   * it always drained the card regardless — and only saved the card when that
   * wrong flag happened to be true. On a cash-mode payment the card was debited in
   * memory and never written, so the customer's balance never actually dropped.
   */
  async processPayment(machineId, amount, paymentType = 'auto') {
    const price = roundMoney(amount)
    if (!(price > 0)) throw new Error('Invalid payment amount')

    const state = this.client.getState()

    // Work out what this payment type is allowed to draw on.
    let spendable
    if (paymentType === 'card') {
      if (!state.hasCard) throw new Error('No card presented')
      spendable = roundMoney(state.balanceCard)
    } else if (paymentType === 'cash') {
      spendable = roundMoney(state.balance)
    } else {
      spendable = roundMoney(state.credits) // cash + card together
    }

    if (spendable + 0.005 < price) {
      const err = new Error('Insufficient credits')
      err.code = 'INSUFFICIENT_CREDITS'
      err.available = spendable
      err.required = price
      throw err
    }

    // Snapshot so a failed card write can be undone rather than leaving the
    // customer debited in memory for a payment that never landed.
    const snapshot = this.client.snapshotBalances()

    let split
    if (paymentType === 'card') {
      // Forced card: move the whole amount off the card.
      this.client.client.balanceCard = roundMoney(state.balanceCard - price)
      this.client.updateCredits()
      split = { amount: price, fromCash: 0, fromCard: price }
    } else if (paymentType === 'cash') {
      // Forced cash: never touch the card.
      this.client.client.balance = roundMoney(state.balance - price)
      this.client.updateCredits()
      split = { amount: price, fromCash: price, fromCard: 0 }
    } else {
      split = this.client.deductCredits(price)
    }

    // Persist the card whenever any of it came off the card — on EVERY path.
    if (split.fromCard > 0) {
      try {
        await this.client.saveCardBalance()
      } catch (err) {
        this.client.restoreBalances(snapshot)
        console.error('[CoinMachine] Card write failed; payment rolled back:', err.message)
        const wrapped = new Error('Could not update the card balance — payment cancelled')
        wrapped.code = 'CARD_WRITE_FAILED'
        wrapped.cause = err
        throw wrapped
      }
    }

    const source = split.fromCard > 0 && split.fromCash > 0 ? 'mixed'
      : split.fromCard > 0 ? 'card' : 'cash'

    this.emit('payment-processed', {
      machineId, amount: price, paymentType: source,
      fromCash: split.fromCash, fromCard: split.fromCard,
      remainingBalance: this.client.getState().credits
    })

    return {
      success: true,
      paymentType: source,
      fromCash: split.fromCash,
      fromCard: split.fromCard,
      remainingBalance: this.client.getState().credits
    }
  }

  /**
   * Dispense card with initial balance
   */
  async dispenseNewCard(cardDispenserId, initialBalance = 0) {
    try {
      await this.middleware.dispenseCard(cardDispenserId)
      
      // TODO: Write initial balance to card via RFID
      
      this.emit('new-card-dispensed', { initialBalance })
      
      return { success: true }
    } catch (err) {
      console.error('Failed to dispense card:', err)
      throw err
    }
  }

  // ---------------------------------------------------------------- credit refund

  /** Seconds of nobody touching the kiosk after which unspent cash is paid back (0 = never). */
  get creditRefundSeconds() {
    const n = Number(this.settings?.creditRefundSeconds)
    return Number.isFinite(n) && n >= 0 ? n : 120
  }

  /** The customer is still here: a coin/bill went in, the screen was touched, or cash was restored. */
  touchCredit() {
    this.lastCreditActivity = Date.now()
  }

  /** Whole seconds left before the unspent cash is paid back, or null when nothing is waiting. */
  creditRefundCountdown() {
    const s = this.client.getState()
    if (!(s.balance > 0) || s.hasCard || this.creditRefundSeconds <= 0) return null
    return Math.max(0, Math.ceil(this.creditRefundSeconds - (Date.now() - this.lastCreditActivity) / 1000))
  }

  startCreditRefundWatch(everyMs = 5000) {
    this.stopCreditRefundWatch()
    this.refundTimer = setInterval(() => { this.checkCreditRefund().catch(() => {}) }, everyMs)
    this.refundTimer.unref?.()
  }

  // ---------------------------------------------------------------- dryer blocks

  /** Longest dryer purchase, in blocks of `tImp` minutes (8 x 15 = 2 h). */
  get maxBlocks() { return Number(process.env.MAX_DRYER_BLOCKS) || 8 }

  /** Blocks the customer asked for on this cart line: dryers only, whole numbers, clamped. */
  blocksFor(machine, item) {
    if ((machine?.type || 'wash') !== 'dry') return 1
    const q = Math.floor(Number(item?.quantity ?? item?.qty ?? 1))
    return Number.isFinite(q) && q >= 1 ? Math.min(q, this.maxBlocks) : 1
  }

  /** Minutes between impulses for this machine (dryers carry `tImp`, 15 by default). */
  gapMinutes(machine) {
    return Number(machine?.tImp) > 0 ? Number(machine.tImp) : 15
  }

  /**
   * Start a PAID machine on the hardware: send the first impulse and remember how many blocks
   * are still to come. Throws (nothing marked, nothing charged by the caller) when the machine
   * cannot be started. A no-op where there is no hardware (the central server).
   */
  async startPaidMachine(machineId, blocks = 1) {
    if (!this.running) return { skipped: true }
    const machine = await Machine.findOne(this.scoped({ _id: machineId })).populate('interfaceId')
    if (!machine) throw new Error('Machine not found')
    const iface = machine.interfaceId
    if (!iface || !machine.port) throw new Error(`${machine.name} has no interface/port configured`)
    if (iface.status !== 'active') throw new Error(`Interface ${iface.name} is not active (status: ${iface.status})`)
    const n = Math.max(1, Math.floor(blocks))
    // How the blocks reach the machine:
    //  batch (default, what the old program does): ONE command carrying n impulses; the machine adds
    //    the time itself;
    //  staggered: one impulse now, one more every `tImp` minutes (DRYER_IMPULSE_MODE=staggered).
    const staggered = String(process.env.DRYER_IMPULSE_MODE || 'batch').toLowerCase() === 'staggered' && n > 1
    // Throws when the controller is not connected: the caller then charges nothing.
    await this.middleware.sendMachineActivation(machine, iface, staggered ? 1 : n)
    const minutes = await this.cycleMinutes(machine, n)
    machine.busyUntil = new Date(Date.now() + minutes * 60_000)
    machine.sawBusy = false
    machine.pendingImpulses = staggered ? n - 1 : 0
    machine.nextImpulseAt = staggered ? new Date(Date.now() + this.gapMinutes(machine) * 60_000) : null
    machine.startedAt = new Date()
    await machine.save()
    console.log(`[Cycle] ${machine.name} started: ${staggered ? 'block 1 of ' + n + ', next impulse at ' + machine.nextImpulseAt.toISOString() : n + ' impulse(s) sent at once'}`)
    return { success: true, blocks: n }
  }

  /** How long a paid cycle lasts: dryers n x tImp; washers the price row's duration, else a default. */
  async cycleMinutes(machine, blocks = 1) {
    if ((machine.type || 'wash') === 'dry') return blocks * this.gapMinutes(machine)
    try {
      const row = await Price.findOne(this.scoped({ type: machine.type || 'wash', weight: machine.weight })).lean()
      if (Number(row?.duration) > 0) return Number(row.duration)
    } catch { /* fall through to the default */ }
    return Number(process.env.WASH_DEFAULT_MINUTES) || 60
  }

  startImpulseScheduler(everyMs = 10_000) {
    this.stopImpulseScheduler()
    this.impulseTimer = setInterval(() => { this.tickImpulses().catch((e) => console.error('[Cycle] tick failed:', e.message)) }, everyMs)
    this.impulseTimer.unref?.()
  }

  stopImpulseScheduler() {
    clearInterval(this.impulseTimer)
    this.impulseTimer = null
  }

  /** Send the next block's impulse to every machine whose time has come. Retries while the controller is away. */
  async tickImpulses(now = new Date()) {
    if (this.impulseBusy) return 0
    this.impulseBusy = true
    let sent = 0
    try {
      // Time block over: a machine whose signal never showed it running is freed now (no signal can).
      const expired = await Machine.find(this.scoped({
        status: 'working', busyUntil: { $lte: now }, sawBusy: { $ne: true }, pendingImpulses: { $not: { $gt: 0 } },
      }))
      for (const m of expired) {
        m.status = 'free'; m.statusText = 'Livre'; m.busyUntil = null; m.sawBusy = false
        m.startedAt = null; m.currentProgram = null; m.reserved = false; m.reservedBy = null
        await m.save()
        try { await broadcastMachine(m) } catch { /* cosmetic */ }
        console.log(`[Cycle] ${m.name}: paid time is over, freed by the clock (its signal never showed it running)`)
      }
      const due = await Machine.find(this.scoped({ pendingImpulses: { $gt: 0 }, nextImpulseAt: { $lte: now } })).populate('interfaceId')
      for (const machine of due) {
        const iface = machine.interfaceId
        try {
          if (!iface || !machine.port) throw new Error('no interface/port')
          await this.middleware.sendMachineActivation(machine, iface)
          machine.pendingImpulses = Math.max(0, machine.pendingImpulses - 1)
          machine.nextImpulseAt = machine.pendingImpulses > 0 ? new Date(Date.now() + this.gapMinutes(machine) * 60_000) : null
          machine.status = 'working'
          machine.statusText = 'Ocupado'
          await machine.save()
          sent++
          console.log(`[Cycle] ${machine.name}: next block sent, ${machine.pendingImpulses} to go`)
        } catch (err) {
          console.error(`[Cycle] ${machine.name}: could not send the next block (${err.message}); will retry`)
          const lateMin = (Date.now() - new Date(machine.nextImpulseAt).getTime()) / 60_000
          if (lateMin >= 5 && !machine.__alerted) {
            machine.__alerted = true
            await this.auditSystem('machine.block.late', { machine: machine.name, pending: machine.pendingImpulses, lateMinutes: Math.round(lateMin), error: err.message })
            broadcastHardwareEvent(this.tenantId, 'machine:block-late', { machine: machine.name, pending: machine.pendingImpulses })
          }
        }
      }
    } finally {
      this.impulseBusy = false
    }
    return sent
  }

  stopCreditRefundWatch() {
    clearInterval(this.refundTimer)
    this.refundTimer = null
  }

  /** Pay the cash back once the kiosk has been left alone for `creditRefundSeconds`. */
  async checkCreditRefund() {
    const left = this.creditRefundCountdown()
    if (left === null || left > 0) return null
    return this.refundCredit({ reason: 'idle' })
  }

  /**
   * Give the customer back the cash they inserted and did not spend, from the hoppers.
   *
   * A payout that comes up short is NOT forgotten: the unpaid part stays as credit (and stays
   * saved, so a restart does not lose it), the kiosk is told, and the operator gets an audit
   * entry with the exact amount owed. A customer who has a card loaded is left to the card
   * flow, which moves the unspent cash onto the card when it is removed.
   */
  async refundCredit({ reason = 'manual' } = {}) {
    if (this.refunding) return this.refunding
    this.refunding = (async () => {
      const state = this.client.getState()
      const amount = roundMoney(state.balance)
      if (!(amount > 0)) return { success: true, refunded: 0, remaining: 0 }
      if (state.hasCard) return { success: false, skipped: 'card-loaded', refunded: 0, remaining: amount }

      let dispensed = 0
      let error = ''
      try {
        const hopper = await Peripheral.findOne(this.scoped({ type: 'hopper', enabled: true }))
        if (!hopper) {
          error = 'No hopper configured'
        } else {
          const result = await this.dispenseChange(hopper._id, amount)
          dispensed = roundMoney(Math.min(amount, Math.max(0, Number(result?.dispensed ?? (result?.success === false ? 0 : amount)))))
          if (result?.success === false) error = result.error || 'The hopper could not pay out the full amount'
        }
      } catch (err) {
        error = err.message || 'Refund failed'
      }

      const remaining = roundMoney(amount - dispensed)
      // Take back only what was really paid out; the rest stays as the customer's credit.
      this.client.restoreBalances({ balance: remaining, balanceCard: state.balanceCard })
      const details = { amount, refunded: dispensed, remaining, reason, error }
      await this.auditSystem(remaining > 0 ? 'cash.refund.short' : 'cash.refund', details)
      broadcastHardwareEvent(this.tenantId, remaining > 0 ? 'credit:refund-failed' : 'credit:refunded', details)
      this.emit(remaining > 0 ? 'refund-short' : 'refunded', details)
      if (remaining > 0) {
        console.error(`[Refund] EUR ${remaining.toFixed(2)} of EUR ${amount.toFixed(2)} could NOT be paid back (${error}); kept as credit`)
        this.touchCredit() // do not hammer a broken hopper every 5 s: try again after another idle period
      } else {
        console.log(`[Refund] EUR ${dispensed.toFixed(2)} paid back (${reason})`)
      }
      return { success: remaining <= 0, refunded: dispensed, remaining, error }
    })().finally(() => { this.refunding = null })
    return this.refunding
  }

  /** Wipe the card at the reader and forget it here (its sales stay: that money really came in). */
  async blankCardAtReader() {
    const res = await this.middleware.blankCardViaGateway()
    const code = res.before.cardId
    const { forgetCard } = await import('./cardForget.js')
    const gone = await forgetCard(this.tenantId, code)
    this.recentlyBlanked = this.recentlyBlanked || new Map()
    this.recentlyBlanked.set(String(code), Date.now())
    await this.auditSystem('card.blanked', { ...res.before, ...gone })
    return { code, name: res.before.name, balance: res.before.balance }
  }

  /**
   * Pay out EVERYTHING the hopper holds: one huge get-change; the controller answers with the part it could not pay,
   * so (asked - not paid) is what was inside. The coins drop into the tray: a container must be under it.
   */
  async emptyHopper() {
    if (roundMoney(this.client.getState().balance) > 0) return { dispensed: 0, error: 'Há crédito de um cliente na máquina: espere ou devolva-o primeiro' }
    const hopper = await Peripheral.findOne(this.scoped({ type: 'hopper', enabled: true }))
    if (!hopper) return { dispensed: 0, error: 'Nenhum hopper configurado' }
    const result = await this.dispenseChange(hopper._id, 9999, { timeoutMs: 10 * 60 * 1000 })
    const dispensed = roundMoney(Number(result?.dispensed) || 0)
    // Everything that could be paid was paid, so the stock kept by the system is zero (counted by hand again after a refill).
    if (dispensed > 0 || result?.success !== false) await Peripheral.findOneAndUpdate({ _id: hopper._id }, { $set: { 'hopperConfig.currentCount': 0, 'hopperConfig.currentStock': {} } })
    await this.auditSystem('hopper.empty', { dispensed, error: result?.error })
    return { dispensed, error: result?.error, unconfirmed: !!result?.unconfirmed }
  }

  /**
   * Dispense change
   */
  async dispenseChange(hopperId, amount, opts = {}) {
    try {
      const result = await this.middleware.dispenseChange(hopperId, amount, opts)
      
      this.emit('change-dispensed', { amount })
      
      // Pass the controller's real answer on. This used to return { success: true } whatever
      // happened, so a hopper that came up short looked like a completed payout.
      return { ...(result || {}), success: result?.success !== false }
    } catch (err) {
      console.error('Failed to dispense change:', err)
      throw err
    }
  }

  /**
   * Print receipt
   */
  async printReceipt(printerId, content) {
    try {
      await this.middleware.print(printerId, content)
      
      this.emit('receipt-printed')
      
      return { success: true }
    } catch (err) {
      console.error('Failed to print receipt:', err)
      throw err
    }
  }

  /**
   * Activate machine(s) with specified configuration
   * Based on old code: [{id: intId, chn: channel, impulses: '1'}]
   * Now integrates with Interface hardware for actual pulse control
   */
  async activateMachine(activationData) {
    try {
      const dataArray = Array.isArray(activationData) ? activationData : [activationData]
      
      // Process each machine activation
      for (const act of dataArray) {
        let machine
        
        // Find machine by intId (from old code) or MongoDB _id
        if (act.id) {
          machine = await Machine.findOne(this.scoped({ intId: act.id })).populate('interfaceId')
        } else if (act.machineId) {
          machine = await Machine.findById(act.machineId).populate('interfaceId')
        }
        
        if (!machine) {
          console.warn(`Machine not found: ${act.id || act.machineId}`)
          continue
        }

        // VALIDATION: Machine must have a program selected
        if (!machine.currentProgram) {
          throw new Error(`Machine ${machine.name} has no program selected. Please select a program first.`)
        }

        // VALIDATION: Machine must be reserved (payment successful)
        if (machine.status !== 'reserved') {
          throw new Error(`Machine ${machine.name} is not reserved. Status: ${machine.status}. Payment must be completed before activation.`)
        }

        // VALIDATION: Machine must have been paid for
        if (!machine.reserved || !machine.reservedBy) {
          throw new Error(`Machine ${machine.name} payment not verified. Please complete payment first.`)
        }

        // Check if machine has interface configured
        if (!machine.interfaceId || !machine.port) {
          console.warn(`Machine ${machine.name} has no interface/port configured`)
          // Fall back to old-style activation
          await this.middleware.activateMachine(act)
          continue
        }

        // Load interface if not populated
        const machineInterface = machine.interfaceId._id ? machine.interfaceId : await Interface.findById(machine.interfaceId)
        
        if (!machineInterface) {
          console.warn(`Interface not found for machine ${machine.name}`)
          continue
        }

        // Check if interface is active
        if (machineInterface.status !== 'active') {
          throw new Error(`Interface ${machineInterface.name} is not active (status: ${machineInterface.status})`)
        }

        // Send activation through interface hardware
        await this.middleware.sendMachineActivation(machine, machineInterface)
        
        // Update machine status in database
        machine.status = 'working'
        machine.startedAt = new Date()
        await machine.save()
        
        this.machines.set(machine.intId || machine._id, {
          ...machine.toObject(),
          activatedAt: new Date()
        })

        console.log(`Machine ${machine.name} activated via Interface ${machineInterface.name} (addr=${machineInterface.address}, port=${machine.port})`)
      }
      
      this.emit('machines-activated', activationData)
      return { success: true }
    } catch (err) {
      console.error('Failed to activate machine:', err)
      throw err
    }
  }

  /** Central admin took a machine out of service (or back): apply it at once, the pull is only the backstop. */
  async setMachineService(machineId, outOfService, status) {
    const machine = await Machine.findOne(this.scoped({ _id: machineId }))
    if (!machine) throw new Error('Machine not found')
    machine.outOfService = Boolean(outOfService)
    const want = status === 'fault' ? 'fault' : 'offline'
    machine.serviceStatus = machine.outOfService ? want : null
    machine.status = machine.outOfService ? want : 'free'
    machine.statusText = machine.outOfService ? (want === 'fault' ? 'Avariada' : 'Fora de servi\u00e7o') : ''
    await machine.save()
    this.machines.set(machine.intId || machine._id, machine.toObject())
    await broadcastMachine(machine)
    console.log(`[Service] ${machine.name} is now ${machine.outOfService ? 'OUT of service' : 'back in service'} (central admin)`)
    return { success: true }
  }

  /**
   * Admin start: run a machine now, no payment, no reservation. For the operator to test
   * wiring, serve a customer by hand, or start a machine from the central admin (which reaches
   * the shop as a remote command, see services/remoteCommands.js).
   * Still refuses what would only fail at the washer: no interface/port, inactive interface,
   * machine already running, or no controller link.
   */
  async adminStartMachine(machineId, blocks = 1) {
    const machine = await Machine.findOne(this.scoped({ _id: machineId })).populate('interfaceId')
    if (!machine) throw new Error('Machine not found')
    const iface = machine.interfaceId
    if (!iface || !machine.port) throw new Error(`${machine.name} has no interface/port configured`)
    if (iface.status !== 'active') throw new Error(`Interface ${iface.name} is not active (status: ${iface.status})`)
    if (machine.status === 'working') throw new Error(`${machine.name} is already running`)
    if (machine.outOfService || machine.status === 'offline' || machine.status === 'fault') throw new Error(`${machine.name} is out of service`)

    // A dryer can be started for several cycles (blocks of `tImp` minutes), exactly as a customer picks them.
    const n = this.blocksFor(machine, { quantity: blocks })
    // Throws if the controller is not connected — nothing is marked running in that case.
    if ((machine.type || 'wash') === 'dry') {
      // startPaidMachine sends the impulses and keeps the cycle clock, so the dryer frees itself at the end.
      await this.startPaidMachine(machine._id, n)
    } else {
      await this.middleware.sendMachineActivation(machine, iface)
    }
    const fresh = await Machine.findOne(this.scoped({ _id: machineId }))
    fresh.status = 'working'
    fresh.statusText = 'Ocupado'
    fresh.startedAt = new Date()
    fresh.currentProgram = n > 1 ? `Início manual (${n} ciclos)` : 'Início manual'
    await fresh.save()
    this.machines.set(machine.intId || machine._id, { ...fresh.toObject(), activatedAt: new Date() })
    try { await broadcastMachine(fresh) } catch { /* the websocket server may not be up in tests */ }
    this.emit('machines-activated', { machineId: String(machine._id), admin: true })
    console.log(`Machine ${machine.name} started by admin via Interface ${iface.name} (addr=${iface.address}, port=${machine.port}, blocks=${n})`)
    return { success: true, blocks: n }
  }

  /**
   * Admin end: free the machine in the system. The controller has no stop command (see the
   * protocol notes in docs §9), so a running cycle finishes by itself; this only releases the
   * machine here so the next customer can pick it.
   */
  async adminEndMachine(machineId) {
    const machine = await Machine.findOne(this.scoped({ _id: machineId }))
    if (!machine) throw new Error('Machine not found')
    machine.status = 'free'
    machine.statusText = 'Livre'
    machine.startedAt = null
    machine.currentProgram = null
    machine.reserved = false
    machine.reservedBy = null
    machine.pendingImpulses = 0
    machine.nextImpulseAt = null
    machine.busyUntil = null
    machine.sawBusy = false
    await machine.save()
    try { await broadcastMachine(machine) } catch { /* see above */ }
    return { success: true }
  }

  /**
   * Handle machine-started event from low-level device
   */
  async handleMachineStarted(data) {
    const { id, chn } = data
    console.log(`Machine started: id=${id}, channel=${chn}`)
    
    try {
      const machine = await Machine.findOne(this.scoped({ intId: id }))
      if (machine) {
        machine.status = 'working'
        machine.reserved = false
        machine.startedAt = new Date()
        await machine.save()
        
        this.machines.set(id, machine.toObject())
        this.emit('machine-started', { machine: machine.toObject() })
        
        // Broadcast to WebSocket clients
        await broadcastMachine(machine)
      }
    } catch (err) {
      console.error('Error handling machine-started:', err)
    }
  }

  /**
   * Handle machine-reserved event
   */
  /**
   * Clear a reservation the hardware reports as cancelled.
   *
   * Only frees the machine if it is still merely `reserved` — a machine that has
   * since been paid for and started must not be released out from under the
   * customer by a late cancellation event.
   */
  async handleMachineReservationCanceled(data) {
    const ids = Array.isArray(data) ? data : [data]
    for (const entry of ids) {
      const id = entry && typeof entry === 'object' ? (entry.id ?? entry.intId) : entry
      if (id == null) continue
      try {
        const machine = await Machine.findOneAndUpdate(
          this.scoped({ intId: Number(id), status: 'reserved' }),
          {
            $set: {
              status: 'free', statusText: 'Available',
              reserved: false, reservedBy: null, reservedAt: null, reservationDuration: 0,
            },
          },
          { new: true }
        )
        if (!machine) continue
        this.machines.set(machine.intId || String(machine._id), machine.toObject())
        await broadcastMachine(machine)
        this.emit('machine-reservation-canceled', { machine: machine.toObject() })
        console.log(`Reservation cleared on machine ${machine.name}`)
      } catch (err) {
        console.error('Error clearing cancelled reservation:', err)
      }
    }
  }

  async handleMachineReserved(data) {
    const { id, duration } = data
    console.log(`Machine reserved: id=${id}, duration=${duration}`)
    
    try {
      const machine = await Machine.findOne(this.scoped({ intId: id }))
      if (machine) {
        machine.status = 'reserved'
        machine.reserved = true
        machine.reservedAt = new Date()
        machine.reservationDuration = duration || 5
        await machine.save()
        
        this.machines.set(id, machine.toObject())
        this.emit('machine-reserved', { machine: machine.toObject() })
        
        // Broadcast to WebSocket clients
        await broadcastMachine(machine)
      }
    } catch (err) {
      console.error('Error handling machine-reserved:', err)
    }
  }

  /**
   * Handle machine-issue event (fault detected)
   */
  async handleMachineIssue(data) {
    // The controller reports `{ id: "<interface>", chn: "<channel>", active, status }`
    // — an interface id and channel, not a machine id, and no `issue` text.
    if (data && data.chn !== undefined) {
      if (String(data.active) === '0') {
        await this.handleGatewayMachineStatus({
          address: Number(data.id), port: Number(data.chn), connected: false, level: false,
        })
      }
      return
    }

    const { id, issue } = data
    console.log(`Machine issue: id=${id}, issue=${issue}`)

    try {
      const machine = await Machine.findOne(this.scoped({ intId: id }))
      if (machine) {
        machine.status = 'fault'
        machine.statusText = issue || 'Unknown fault'
        await machine.save()
        reportFault(machine.tenantId, machine._id, issue || 'Unknown fault')

        this.machines.set(id, machine.toObject())
        this.emit('machine-issue', { machine: machine.toObject(), issue })
        
        // Broadcast to WebSocket clients
        await broadcastMachine(machine)
      }
    } catch (err) {
      console.error('Error handling machine-issue:', err)
    }
  }

  /**
   * One channel of a controller `status_int` reply, reduced to the same signals
   * a KITSEC status byte gives (`fault`, `occupied`, `doorClosed`) so the
   * existing cycle/idle-confirmation logic in handleMachineStatusUpdate applies.
   * The controller does not report door state, so it is assumed closed.
   */
  async handleGatewayMachineStatus({ address, port, connected, level }) {
    try {
      const iface = await Interface.findOne(this.scoped({ address: Number(address) }))
      if (!iface) return // an interface we have no record of

      // The channel bit is a line LEVEL. Which level means "busy" is the machine's
      // activation polarity (high: 1 = busy, low: 0 = busy) — reading "1" as
      // running for every machine would show idle low-polarity machines as busy.
      const machine = await Machine.findOne(this.scoped({ interfaceId: iface._id, port: Number(port) }))
      const busy = connected && isChannelBusy(level, machine?.activation)

      await this.handleMachineStatusUpdate({
        interfaceId: iface._id,
        port: Number(port),
        status: { fault: !connected, occupied: busy, doorLocked: false, doorClosed: true },
      })
      // While anything runs, ask again soon so the end of the cycle is noticed.
      if (busy) this.middleware.scheduleBusyPoll?.()
    } catch (err) {
      console.error('Error handling gateway machine status:', err)
    }
  }

  /**
   * Handle status_int event (status update from low-level)
   */
  async handleStatusInt(data) {
    // data contains machine status updates
    console.log('Status update:', data)
    this.emit('status-update', data)
    
    // Update machine statuses in database
    try {
      if (Array.isArray(data.machines)) {
        for (const machineData of data.machines) {
          const machine = await Machine.findOne(this.scoped({ intId: machineData.id }))
          if (machine && machineData.status) {
            // Map low-level status to our status enum
            const statusMap = {
              'idle': 'free',
              'running': 'working',
              'reserved': 'reserved',
              'fault': 'fault',
              'offline': 'offline'
            }
            
            machine.status = statusMap[machineData.status] || 'offline'
            await machine.save()
            if (machine.status === 'fault') {
              reportFault(machine.tenantId, machine._id, 'Fault reported by low-level status', machineData.status)
            }

            this.machines.set(machineData.id, machine.toObject())
            
            // Broadcast individual machine update
            await broadcastMachine(machine)
          }
        }
      }
    } catch (err) {
      console.error('Error handling status_int:', err)
    }
  }

  /**
   * Get machine states
   */
  getMachineStates() {
    return Array.from(this.machines.values())
  }

  /**
   * Get specific machine state
   */
  getMachineState(machineId) {
    return this.machines.get(machineId)
  }

  /**
   * Get current client state
   */
  getClientState() {
    return this.client.getState()
  }

  /**
   * Reset client session
   */
  resetClient() {
    this.client.reset()
    this.emit('client-reset')
  }

  /**
   * Remove card but keep cash balance
   */
  removeCard() {
    this.client.resetCardInfo()
    this.emit('card-removed')
  }

  /**
   * Handle machine status update from Interface hardware
   * Receives door status, occupied status, etc.
   */
  async handleMachineStatusUpdate(data) {
    const { interfaceId, port, status } = data
    
    try {
      // Find machine by interface and port
      const machine = await Machine.findOne(this.scoped({
        interfaceId: interfaceId,
        port: port
      }))

      if (!machine) {
        console.warn(`No machine found for Interface ${interfaceId} Port ${port}`)
        return
      }

      // Out of service is the operator's call: hardware readings must not bring it back.
      if (machine.outOfService) {
        const want = machine.serviceStatus === 'fault' ? 'fault' : 'offline'
        if (machine.status !== want) {
          machine.status = want
          machine.statusText = want === 'fault' ? 'Avariada' : 'Fora de servi\u00e7o'
          await machine.save()
          this.machines.set(machine.intId || machine._id, machine.toObject())
          await broadcastMachine(machine)
        }
        return
      }

      console.log(`Machine ${machine.name} status update:`, status)

      // The signal does work for this machine: from now on it, not the clock, decides when it is free.
      if (status.occupied && machine.busyUntil && !machine.sawBusy) machine.sawBusy = true

      // Update machine status based on hardware signals
      let machineStatus = machine.status
      let statusText = ''
      let cycleStartedAt = null

      if (status.fault) {
        machineStatus = 'fault'
        statusText = 'Hardware fault detected'
        reportFault(machine.tenantId, machine._id, statusText)
      } else if (status.occupied || status.doorLocked) {
        machineStatus = 'working'
        statusText = status.doorClosed ? 'Running - Door closed' : 'Running - Door open'
      } else if (!status.doorClosed) {
        statusText = 'Door open'
        // Don't change status, just update text
      } else if (status.doorClosed && machineStatus === 'working' && machine.pendingImpulses > 0) {
        // Between two blocks of a dryer the signal goes idle; the customer has paid for more.
        statusText = 'Ocupado'
      } else if (status.doorClosed && machineStatus === 'working') {
        // Machine finished — door closed and not occupied.
        //
        // Require the idle reading to persist before freeing a paid machine. A
        // single dropped `occupied` bit (one noisy status packet, and these
        // arrive several times a second) used to free a machine mid-cycle,
        // clearing the customer's program and reservation and handing their
        // wash to whoever walked up next.
        const key = String(machine._id)
        const seen = (this.idleReadings.get(key) || 0) + 1
        this.idleReadings.set(key, seen)

        const heldByClock = machine.busyUntil && machine.busyUntil > new Date() && !machine.sawBusy
        if (heldByClock) {
          // Paid for, and the line has not shown it running: do not free it before the paid time is over.
          statusText = 'Ocupado'
          machineStatus = 'working'
        } else if (seen < IDLE_READINGS_TO_FREE) {
          // Not confident yet — leave it running and wait for confirmation.
          statusText = 'Running'
          machineStatus = 'working'
        } else {
          this.idleReadings.delete(key)
          machineStatus = 'free'
          statusText = 'Available'
          // Captured before startedAt is cleared below — this is the only
          // window in which we can bound the Sale lookup used for the
          // WhatsApp cycle-complete notification (reservedBy is never
          // actually populated by the real payment flow, so the card link
          // only ever exists on the Sale row, not here).
          cycleStartedAt = machine.startedAt
          machine.currentProgram = null
          machine.reserved = false
          machine.reservedBy = null
          machine.startedAt = null
          machine.busyUntil = null
          machine.sawBusy = false
          // Turns the existing-but-otherwise-dead `cycle` counter into a
          // real running total (see maintenance.js / Round D).
          machine.cycle = (machine.cycle || 0) + 1
        }
      } else if (status.occupied) {
        // Still running — any earlier idle reading was a blip.
        this.idleReadings.delete(String(machine._id))
      }

      // Update machine
      machine.status = machineStatus
      machine.statusText = statusText
      await machine.save()

      // Update cache
      this.machines.set(machine.intId || machine._id, machine.toObject())

      // Broadcast update via WebSocket
      await broadcastMachine(machine)

      this.emit('machine-status-changed', {
        machine: machine.toObject(),
        hardwareStatus: status
      })

      // WhatsApp cycle-complete notification — fire-and-forget, never blocks
      // or throws into this handler. Only runs on the free transition above
      // (cycleStartedAt is only set there). See services/whatsapp.js.
      if (cycleStartedAt) {
        this.notifyCycleComplete(machine, cycleStartedAt).catch(() => {})
      }
    } catch (err) {
      console.error('Error handling machine status update:', err)
    }
  }

  /**
   * Look up which card ran the just-finished cycle and, if it has a phone
   * number and WhatsApp is enabled for the tenant, send a "cycle complete"
   * message. The card link only ever exists on the Sale row — `reservedBy`
   * on Machine is never populated by the real payment flow (pos.js/
   * gateways.js write status+cycle directly, not reservedBy).
   */
  async notifyCycleComplete(machine, cycleStartedAt) {
    const sale = await Sale.findOne({
      tenantId: machine.tenantId,
      machineId: machine._id,
      type: 'payment',
      createdAt: { $gte: cycleStartedAt }
    }).sort({ createdAt: -1 })
    if (!sale?.cardCode) return
    const card = await Card.findOne({ tenantId: machine.tenantId, code: sale.cardCode })
    if (!card?.phone) return
    await sendCycleCompleteMessage(machine.tenantId, card.phone, machine.name)
  }

  /**
   * Handle machine fault from Interface hardware
   */
  async handleMachineFault(data) {
    const { interfaceId, port, errorCode } = data
    
    try {
      // Find machine by interface and port
      const machine = await Machine.findOne(this.scoped({
        interfaceId: interfaceId,
        port: port
      }))

      if (!machine) {
        console.warn(`No machine found for Interface ${interfaceId} Port ${port}`)
        return
      }

      console.error(`Machine ${machine.name} fault - Error code: ${errorCode}`)

      // Update machine status to fault
      machine.status = 'fault'
      machine.statusText = `Error ${errorCode}`
      await machine.save()
      reportFault(machine.tenantId, machine._id, `Error ${errorCode}`, String(errorCode))

      // Update cache
      this.machines.set(machine.intId || machine._id, machine.toObject())

      // Broadcast update via WebSocket
      await broadcastMachine(machine)

      this.emit('machine-fault-detected', {
        machine: machine.toObject(),
        errorCode: errorCode
      })
    } catch (err) {
      console.error('Error handling machine fault:', err)
    }
  }
}

// Create singleton instance
const coinMachine = new CoinMachine()

export { CoinMachine }
export default coinMachine

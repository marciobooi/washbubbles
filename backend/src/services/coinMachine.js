import EventEmitter from 'events'
import middleware from './middleware.js'
import Client from './client.js'
import Setting from '../models/setting.js'
import Machine from '../models/machine.js'
import Interface from '../models/interface.js'
import Sale from '../models/sale.js'
import Card from '../models/card.js'
import { broadcastMachine, broadcastHardwareEvent } from '../wsServer.js'
import { roundMoney } from '../utils/money.js'
import { reportFault } from './maintenance.js'
import { sendCycleCompleteMessage } from './whatsapp.js'

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

      // Load settings
      await this.loadSettings()
      
      // Initialize middleware connections
      await this.middleware.initialize()
      
      // Set up event handlers
      this.setupEventHandlers()
      
      this.running = true
      this.emit('started')
      
      console.log('CoinMachine started successfully')
    } catch (err) {
      console.error('Failed to start CoinMachine:', err)
      throw err
    }
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
      
      this.settings = {
        coinEqTable: coinEqSetting?.value || [],
        billEqTable: billEqSetting?.value || [],
        rechargeCoinBonus: rechargeCoinBonus?.value || 0,
        rechargeBillBonus: rechargeBillBonus?.value || 0,
        autoCharge: autoCharge?.value || false
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
  }

  /**
   * Handle coin rejected (bad coin, foreign, slug)
   */
  handleCoinRejected(data) {
    const { peripheral, reason } = data
    this.emit('coin-rejected', { peripheral, reason })
    console.warn(`Coin rejected: ${reason || 'unknown reason'}`)
    // Signature is (tenantId, type, payload). Called with two args the tenant
    // became the event name and the payload the type, so these alerts — fraud
    // included — reached nobody.
    broadcastHardwareEvent(this.tenantId, 'peripheral:rejected', { type: 'coin', reason: reason || 'rejected' })
  }

  /**
   * Handle bill rejected (bad bill, unrecognised, fraud/fake, jammed)
   */
  handleBillRejected(data) {
    const { peripheral, reason, fraud } = data
    const eventType = fraud ? 'peripheral:fraud' : 'peripheral:rejected'
    this.emit('bill-rejected', { peripheral, reason, fraud })
    console.warn(`Bill ${fraud ? 'FRAUD' : 'rejected'}: ${reason || 'unknown reason'}`)
    broadcastHardwareEvent(this.tenantId, eventType, { type: 'bill', reason: reason || 'rejected', fraud: !!fraud })
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
    const { value } = data
    
    // Apply equivalence table mapping if configured
    const mappedValue = this.applyCoinEquivalence(value)
    
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
    this.emit('coin-inserted', { 
      value: mappedValue, 
      bonus: bonusValue,
      balance: this.client.getState().balance 
    })
    
    console.log(`Coin inserted: €${mappedValue.toFixed(2)}${bonusValue > 0 ? ` + €${bonusValue.toFixed(2)} bonus` : ''}, Total: €${this.client.getState().credits.toFixed(2)}`)
  }

  /**
   * Handle bill insertion
   */
  handleBillInserted(data) {
    const { value } = data
    
    // Apply equivalence table mapping if configured
    const mappedValue = this.applyBillEquivalence(value)
    
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
    this.emit('bill-inserted', { 
      value: mappedValue,
      bonus: bonusValue, 
      balance: this.client.getState().balance 
    })
    
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
    await this.client.resetCardInfo()
    this.emit('card-removed')
    console.log('Card removed')
  }

  /**
   * Handle card read
   */
  async handleCardRead(data) {
    const { cardNumber } = data
    
    const loaded = await this.client.setClientInfoByCard(cardNumber)
    
    if (loaded) {
      this.emit('card-loaded', { client: this.client.getState() })
      console.log(`Card loaded: ${cardNumber}, Balance: €${this.client.getState().balanceCard.toFixed(2)}`)
    } else {
      this.emit('card-invalid', { cardNumber })
      console.warn(`Invalid card: ${cardNumber}`)
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

  /**
   * Dispense change
   */
  async dispenseChange(hopperId, amount) {
    try {
      await this.middleware.dispenseChange(hopperId, amount)
      
      this.emit('change-dispensed', { amount })
      
      return { success: true }
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

      console.log(`Machine ${machine.name} status update:`, status)

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

        if (seen < IDLE_READINGS_TO_FREE) {
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

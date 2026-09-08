/**
 * WashBubbles POS Engine
 * Local business logic — payments, cards, machine activation, all offline
 * 
 * Improvements:
 * - #7: Day Close (X/Z Report) logic
 */
const EventEmitter = require('events')
const { machines, cards, sales, prices, settings, interfaces, syncQueue, session,
        dayCloses, generateId, roundMoney, runTransaction, flushSave } = require('./database.cjs')

/**
 * Longest a wash/dry cycle can plausibly run before a machine still marked
 * `working` at startup is treated as stale. Generous on purpose: freeing a
 * machine that is genuinely running would let a second customer pay for it.
 */
const MAX_CYCLE_MS = 4 * 60 * 60 * 1000

/**
 * A card that has been paid for and physically dispensed but not yet written
 * at the reader is blank — no id, no balance a physical thief could even find
 * — and must not be spendable. This mirrors the server's own guard
 * (services/cardBalance.js SPENDABLE) so the same protection holds locally,
 * offline, not only when the request happens to reach the server.
 */
function assertCardSpendable(card) {
  if (!card) throw new Error('Card not found')
  if (card.status === 'pending_write') throw new Error('Card is not activated yet — insert it in the reader first')
  if (card.status === 'blocked') throw new Error('Card is blocked')
}

class PosEngine extends EventEmitter {
  constructor(hardwareAgent, tenantId) {
    super()
    this.hw = hardwareAgent
    this.tenantId = tenantId
    this.sessionState = { cashBalance: 0, cardCode: null, cardBalance: 0, hasCard: false, bonus: 0, credits: 0 }
    this.settings = {}
  }

  init() {
    this.loadSettings()
    this.setupHardwareListeners()
    this.restoreSession()
    this.reconcileMachines()
    console.log('[POS] Engine initialized for tenant:', this.tenantId)
  }

  /**
   * Restore the cash a customer had already fed in before a power cut.
   *
   * `init()` used to call `session.reset()` unconditionally, and the session was
   * never written to disk in the first place, so a blip after someone inserted
   * €20 destroyed it with no record — the customer's money simply disappeared.
   */
  restoreSession() {
    let row = session.getCurrent()
    if (!row) { session.create(); row = session.getCurrent() }
    if (!row) return

    this.sessionState.cashBalance = roundMoney(Number(row.cash_balance) || 0)
    this.sessionState.bonus = roundMoney(Number(row.bonus) || 0)
    this.sessionState.cardCode = row.card_code || null
    this.sessionState.hasCard = Boolean(row.has_card) && Boolean(row.card_code)

    // Re-read the card balance from the cards table rather than trusting the
    // stored copy — the card is the source of truth and may have changed.
    if (this.sessionState.hasCard) {
      const card = cards.getByCode(this.tenantId, this.sessionState.cardCode)
      if (card) {
        this.sessionState.cardBalance = roundMoney(card.balance || 0)
      } else {
        this.sessionState.cardCode = null; this.sessionState.hasCard = false; this.sessionState.cardBalance = 0
      }
    } else {
      this.sessionState.cardBalance = 0
    }

    this.updateCredits()
    if (this.sessionState.cashBalance > 0) {
      console.warn(`[POS] Recovered €${this.sessionState.cashBalance.toFixed(2)} of inserted cash from the previous session`)
      this.emit('session:recovered', this.getSession())
    }
  }

  /** Write the live session to disk so it survives a power loss. */
  persistSession() {
    try {
      const row = session.getCurrent()
      if (!row) return
      session.update(row.id, {
        cash_balance: this.sessionState.cashBalance,
        bonus: this.sessionState.bonus,
        card_code: this.sessionState.cardCode,
        card_balance: this.sessionState.cardBalance,
        has_card: this.sessionState.hasCard ? 1 : 0
      })
    } catch (err) {
      console.error('[POS] Failed to persist session:', err.message)
    }
  }

  /**
   * Free machines this kiosk marked `working` but can no longer be running.
   *
   * Nothing frees a machine locally, so a crash mid-cycle left it permanently
   * "Ocupado" and `processSale` rejected every following customer for it.
   */
  reconcileMachines() {
    try {
      const stale = machines.getAll(this.tenantId).filter((m) => {
        if (m.status !== 'working') return false
        if (!m.started_at) return true // marked busy with no start time — cannot be tracked
        const runningMs = Date.now() - new Date(m.started_at).getTime()
        return runningMs > MAX_CYCLE_MS
      })
      for (const m of stale) {
        machines.updateStatus(m.id, 'free', 'Livre')
        syncQueue.push('machine', m.id, 'update', { id: m.id, status: 'free' }, 3)
        console.warn(`[POS] Machine ${m.name || m.id} was left 'working' across a restart — freed`)
      }
      if (stale.length) flushSave()
    } catch (err) {
      console.error('[POS] Machine reconciliation failed:', err.message)
    }
  }

  loadSettings() {
    const keys = ['coinEqTable', 'billEqTable', 'rechargeCoinBonus', 'rechargeBillBonus', 'autoCharge', 'loyaltyCard.cost', 'loyaltyCard.credit', 'hopperCoinValue', 'hopperMaxDispenseCoins']
    this.settings = {}
    for (const key of keys) {
      const s = settings.get(this.tenantId, key)
      if (s) { try { this.settings[key] = JSON.parse(s.value) } catch { this.settings[key] = s.value } }
    }
  }

  setupHardwareListeners() {
    if (!this.hw) return
    this.hw.on('credit', (data) => this.handleCredit(data))
    this.hw.on('rfid:card_detected', (data) => this.handleCardDetected(data))
    this.hw.on('machine:activation_sent', (data) => this.emit('machine:activated', data))
    this.hw.on('machine:activation_failed', (data) => this.emit('machine:activation_failed', data))
    this.hw.on('hopper:dispensed', (data) => this.emit('hopper:dispensed', data))
    this.hw.on('hopper:empty', (data) => this.emit('hopper:empty', data))
    this.hw.on('hopper:fault', (data) => this.emit('hopper:fault', data))
    this.hw.on('rejected', (data) => this.emit('credit:rejected', data))
    this.hw.on('fraud', (data) => this.emit('credit:fraud', data))
    this.hw.on('interface:status', (data) => this.emit('interface:status', data))
  }

  handleCredit(data) {
    const { type, amount } = data
    let mappedAmount = amount
    const eqTable = type === 'coin_acceptor' ? (this.settings.coinEqTable || []) : (this.settings.billEqTable || [])
    if (Array.isArray(eqTable) && eqTable.length > 0) {
      const mapping = eqTable.find(e => String(e.key) === String(amount))
      if (mapping) mappedAmount = Number(mapping.value)
    }
    let bonus = 0
    const bonusPercent = type === 'coin_acceptor' ? (this.settings.rechargeCoinBonus || 0) : (this.settings.rechargeBillBonus || 0)
    if (bonusPercent > 0) bonus = roundMoney((mappedAmount * bonusPercent) / 100)
    this.sessionState.cashBalance = roundMoney(this.sessionState.cashBalance + mappedAmount)
    this.sessionState.bonus = roundMoney(this.sessionState.bonus + bonus)
    this.updateCredits()
    // Persist and flush immediately: the customer's cash is physically in the
    // machine now, so it must survive a power cut from this moment on.
    this.persistSession()
    flushSave()
    this.emit('session:updated', this.getSession())
    this.emit('credit:accepted', { type, amount: mappedAmount, bonus, credits: this.sessionState.credits })
  }

  handleCardDetected(data) {
    const { cardCode } = data
    const card = cards.getByCode(this.tenantId, cardCode)
    if (!card) {
      this.emit('card:unknown', { cardCode })
      return
    }
    // A blank (pending_write) or blocked card must never become spendable, not
    // even locally — refusing it here means `sessionState.hasCard`/`cardBalance`
    // are never set for it, so nothing downstream in processSale/topUpCard can
    // spend against it regardless of connectivity.
    if (card.status && card.status !== 'active') {
      this.emit('card:blocked', { cardCode, status: card.status })
      return
    }
    this.sessionState.cardCode = cardCode
    this.sessionState.cardBalance = card.balance || 0
    this.sessionState.hasCard = true
    this.updateCredits()
    this.persistSession()
    this.emit('card:loaded', { card, session: this.getSession() })
  }

  /**
   * Queue a card balance delta for the server.
   *
   * Every delta carries its own `localId`. Card pushes are retried after a
   * timeout or a power cut, and the server applies `balance += delta`, so
   * without a stable per-operation key a retry turns a €20 recharge into €40.
   * The server dedupes on this id and returns `status:'duplicate'`.
   */
  queueCardDelta(card, delta, localId) {
    syncQueue.push('card', card.id, 'update', {
      id: card.id,
      code: card.code,
      delta: roundMoney(delta),
      localId: localId || generateId()
    }, 2)
  }

  removeCard() {
    if (this.sessionState.hasCard && this.settings.autoCharge && this.sessionState.cashBalance > 0) {
      const card = cards.getByCode(this.tenantId, this.sessionState.cardCode)
      if (card) {
        const chargeAmount = roundMoney(this.sessionState.cashBalance + this.sessionState.bonus)
        const newBalance = roundMoney((card.balance || 0) + chargeAmount)
        const saleId = generateId()
        // Record the transfer as a sale. Without this row the cash physically in
        // the drawer could not be reconciled against the credit put on the card,
        // and day-close showed an unexplained surplus.
        runTransaction(() => {
          cards.updateBalance(card.id, newBalance)
          sales.create({
            id: saleId, local_id: saleId, tenant_id: this.tenantId,
            amount: chargeAmount,
            items: [{ type: 'recharge', amount: chargeAmount, source: 'auto_charge_on_remove' }],
            type: 'recharge', method: 'cash', card_id: card.id, card_code: card.code,
            inserted: chargeAmount, change_amount: 0
          })
        })
        syncQueue.push('sale', saleId, 'create', { local_id: saleId, tenant_id: this.tenantId, type: 'recharge', amount: chargeAmount, method: 'cash', card_code: card.code }, 1)
        this.queueCardDelta(card, chargeAmount, saleId)
        this.sessionState.cashBalance = 0; this.sessionState.bonus = 0
        // The customer is walking away with this credit — it must survive a power
        // cut inside the 2s autosave debounce.
        flushSave()
      }
    }
    this.sessionState.cardCode = null; this.sessionState.cardBalance = 0; this.sessionState.hasCard = false
    this.updateCredits()
    this.persistSession()
    this.emit('card:removed')
    this.emit('session:updated', this.getSession())
  }

  getCard(code) { return cards.getByCode(this.tenantId, code) }
  getCardHistory(code) {
    const card = cards.getByCode(this.tenantId, code)
    if (!card) return null
    return { card, transactions: sales.getByCardCode(this.tenantId, code, 30) }
  }

  topUpCard(code, amount) {
    const card = cards.getByCode(this.tenantId, code)
    assertCardSpendable(card)
    const topUpAmount = roundMoney(Number(amount))
    const newBalance = roundMoney((card.balance || 0) + topUpAmount)
    if (!(topUpAmount > 0)) throw new Error('Top-up amount must be greater than zero')
    // The sale row and the balance update must land together, or a crash between
    // them leaves either money taken with no credit or credit with no record.
    const saleId = generateId()
    runTransaction(() => {
      sales.create({ id: saleId, local_id: saleId, tenant_id: this.tenantId, amount: topUpAmount, items: [{ type: 'recharge', amount: topUpAmount }], type: 'recharge', method: 'cash', card_id: card.id, card_code: code, inserted: topUpAmount, change_amount: 0 })
      cards.updateBalance(card.id, newBalance)
    })
    syncQueue.push('sale', saleId, 'create', { local_id: saleId, tenant_id: this.tenantId, type: 'recharge', amount: topUpAmount, method: 'cash', card_code: code }, 1)
    this.queueCardDelta(card, topUpAmount, saleId)
    if (this.sessionState.cardCode === code) { this.sessionState.cardBalance = newBalance; this.updateCredits(); this.persistSession(); this.emit('session:updated', this.getSession()) }
    // The customer has already paid for this — unlike processSale, this path used
    // to rely on the 2s autosave debounce, so a power cut lost the recharge.
    flushSave()
    return { card: { ...card, balance: newBalance }, newBalance }
  }

  getMachines() { return machines.getAll(this.tenantId) }
  getMachine(id) { return machines.getById(id) }

  getPrice(type, weight) {
    const price = prices.lookup(this.tenantId, type, Number(weight))
    if (!price) return null
    if (price.promo_active) {
      const now = new Date(); const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']; const today = dayNames[now.getDay()]; const promoDays = price.promo_days ? JSON.parse(price.promo_days) : []; const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
      if (promoDays.includes(today) && (!price.promo_start_time || currentTime >= price.promo_start_time) && (!price.promo_end_time || currentTime <= price.promo_end_time)) {
        return { ...price, effective_cash_price: price.promo_cash_price ?? price.cash_price, effective_card_price: price.promo_card_price ?? price.card_price, is_promo: true }
      }
    }
    return { ...price, effective_cash_price: price.cash_price, effective_card_price: price.card_price, is_promo: false }
  }

  getAllPrices() { return prices.getAll(this.tenantId) }

  processSale(machineId, amount, method, cardCode, batchId, items) {
    const machine = machines.getById(machineId); if (!machine) throw new Error('Machine not found'); if (machine.status === 'working') throw new Error('Machine already in use')
    const price = roundMoney(Number(amount)); const saleId = generateId(); let cardSyncData = null
    if (!(price >= 0)) throw new Error('Invalid sale amount')
    // `sessionState` is a plain JS object, so `runTransaction` cannot roll it
    // back. A throw at `sales.create` used to undo the SQL but leave the customer
    // debited in memory — their credits simply vanished. Snapshot and restore.
    const sessionBefore = { ...this.sessionState }
    try {
    runTransaction(() => {
      if (method === 'card' && cardCode) {
        const card = cards.getByCode(this.tenantId, cardCode); assertCardSpendable(card)
        const newBalance = roundMoney((card.balance || 0) - price); if (newBalance < 0) throw new Error('Insufficient card balance')
        cards.updateBalance(card.id, newBalance); if (this.sessionState.cardCode === cardCode) this.sessionState.cardBalance = newBalance
        cardSyncData = { id: card.id, code: cardCode, delta: -price }
      } else {
        if (roundMoney(this.sessionState.credits) < price) throw new Error('Insufficient credits')
        if (this.sessionState.hasCard && this.sessionState.cardBalance >= price) {
          this.sessionState.cardBalance = roundMoney(this.sessionState.cardBalance - price)
          const card = cards.getByCode(this.tenantId, this.sessionState.cardCode); if (card) { cards.updateBalance(card.id, this.sessionState.cardBalance); cardSyncData = { id: card.id, code: card.code, delta: -price } }
        } else if (this.sessionState.hasCard && this.sessionState.cardBalance > 0) {
          const fromCard = this.sessionState.cardBalance; const remainder = roundMoney(price - fromCard)
          if (this.sessionState.cardCode) { const card = cards.getByCode(this.tenantId, this.sessionState.cardCode); if (card) { cards.updateBalance(card.id, 0); cardSyncData = { id: card.id, code: card.code, delta: -fromCard } } }
          this.sessionState.cardBalance = 0; this.sessionState.cashBalance = roundMoney(this.sessionState.cashBalance - remainder)
        } else { this.sessionState.cashBalance = roundMoney(this.sessionState.cashBalance - price) }
        if (this.sessionState.cashBalance < -0.01) throw new Error('Insufficient cash balance')
        this.updateCredits()
      }
      sales.create({ id: saleId, local_id: saleId, tenant_id: this.tenantId, machine_id: machineId, amount: price, items: items || [{ type: machine.type, weight: machine.weight, price }], type: 'payment', method: method || (cardCode ? 'card' : 'cash'), batch_id: batchId || null, card_code: cardCode || null, inserted: method === 'cash' ? roundMoney(this.sessionState.cashBalance + price) : 0, change_amount: 0 })
      machines.updateStatus(machineId, 'working', 'Ocupado'); machines.incrementCycle(machineId)
    })
    } catch (err) {
      this.sessionState = sessionBefore
      this.emit('session:updated', this.getSession())
      throw err
    }
    syncQueue.push('sale', saleId, 'create', { local_id: saleId, tenant_id: this.tenantId, machine_id: machineId, amount: price, type: 'payment', method: method || (cardCode ? 'card' : 'cash'), card_code: cardCode || null }, 1)
    // Keyed on the sale id so a retried push is not applied twice.
    if (cardSyncData) this.queueCardDelta({ id: cardSyncData.id, code: cardSyncData.code }, cardSyncData.delta, saleId)
    syncQueue.push('machine', machineId, 'update', { id: machineId, status: 'working', cycle: (machine.cycle || 0) + 1 }, 3)
    const iface = machine.interface_id ? interfaces.getById(machine.interface_id) : null
    if (iface && this.hw) this.hw.activateMachine(machine, iface)
    this.persistSession(); flushSave(); this.emit('sale:completed', { sale: { id: saleId, amount: price }, machine: machines.getById(machineId) }); this.emit('session:updated', this.getSession())
    return { success: true, saleId, machine: machines.getById(machineId) }
  }

  // ─── Day Close (X/Z Report) (#7) ───

  /** Perform Day Close calculation and save report */
  performDayClose(notes = '') {
    const today = new Date().toISOString().split('T')[0]
    const allSales = sales.getAll(this.tenantId, 1000) // All recent sales
    
    // Filter sales for today
    const todaySales = allSales.filter(s => s.created_at.startsWith(today))
    
    let totalSales = 0, totalCash = 0, totalCard = 0, totalRecharges = 0
    todaySales.forEach(s => {
      totalSales = roundMoney(totalSales + s.amount)
      if (s.type === 'recharge') totalRecharges = roundMoney(totalRecharges + s.amount)
      if (s.method === 'cash') totalCash = roundMoney(totalCash + s.amount)
      else if (s.method === 'card') totalCard = roundMoney(totalCard + s.amount)
    })

    const report = {
      tenant_id: this.tenantId,
      date: today,
      total_sales: totalSales,
      total_cash: totalCash,
      total_card: totalCard,
      total_recharges: totalRecharges,
      sale_count: todaySales.length,
      notes,
      created_at: new Date().toISOString()
    }

    const result = dayCloses.create(report)
    // The pushed payload must carry the local id, or the server cannot dedupe a
    // retried Z-report and the day gets counted twice.
    syncQueue.push('day_close', result.local_id, 'create', { ...report, local_id: result.local_id }, 4)

    // A Z-report is the operator's record of the day's takings — flush it rather
    // than leaving it in the 2s autosave debounce.
    flushSave()
    console.log(`[POS] Day Close completed for ${today}: €${totalSales}`)
    return { ...report, local_id: result.local_id }
  }

  // ─── Others ───

  adminStartMachine(machineId) {
    const machine = machines.getById(machineId); if (!machine) throw new Error('Machine not found'); const saleId = generateId()
    runTransaction(() => { machines.updateStatus(machineId, 'working', 'Admin Start'); machines.incrementCycle(machineId); sales.create({ id: saleId, local_id: saleId, tenant_id: this.tenantId, machine_id: machineId, amount: 0, items: [{ type: 'admin_start' }], type: 'admin_start', method: 'admin' }) })
    syncQueue.push('sale', saleId, 'create', { local_id: saleId, type: 'admin_start', machine_id: machineId, amount: 0 }, 1)
    syncQueue.push('machine', machineId, 'update', { id: machineId, status: 'working' }, 3)
    const iface = machine.interface_id ? interfaces.getById(machine.interface_id) : null
    if (iface && this.hw) this.hw.activateMachine(machine, iface)
    flushSave(); return { success: true }
  }

  async dispenseChange(amount) {
    if (amount <= 0) return { success: true, amount: 0 }
    if (!this.hw) return { success: false, error: 'Hardware not available' }
    const opts = {
      coinValue: this.settings.hopperCoinValue != null ? Number(this.settings.hopperCoinValue) : undefined,
      maxCoins: this.settings.hopperMaxDispenseCoins != null ? Number(this.settings.hopperMaxDispenseCoins) : undefined,
    }
    const success = await this.hw.dispenseCoins(amount, opts)
    return { success, amount }
  }
  printReceipt(content) { if (!this.hw) return false; return this.hw.printReceipt(content) }
  updateCredits() { this.sessionState.credits = roundMoney(this.sessionState.cashBalance + this.sessionState.cardBalance + this.sessionState.bonus) }
  getSession() { return { ...this.sessionState } }
  resetSession() { this.sessionState = { cashBalance: 0, cardCode: null, cardBalance: 0, hasCard: false, bonus: 0, credits: 0 }; session.reset(); this.emit('session:updated', this.getSession()) }
  getTransactions(limit) { return sales.getAll(this.tenantId, limit) }
  getSetting(key) { return settings.get(this.tenantId, key) }
  getAllSettings() { return settings.getAll(this.tenantId) }
}

module.exports = { PosEngine }

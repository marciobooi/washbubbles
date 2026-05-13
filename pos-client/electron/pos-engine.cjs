/**
 * WashBubbles POS Engine
 * Local business logic — payments, cards, machine activation, all offline
 *
 * Fixes applied:
 * - #3:  All money math uses roundMoney() to prevent floating-point drift
 * - #4:  processSale wrapped in SQLite transaction for atomicity
 * - #5:  topUpCard uses returned sale ID for sync queue
 * - #6:  Card balance validated >= 0 before deduction
 * - #15: removeCard auto-charge sends delta instead of absolute balance
 */
const EventEmitter = require('events')
const { machines, cards, sales, prices, settings, interfaces, syncQueue, session,
        generateId, roundMoney, runTransaction, flushSave } = require('./database.cjs')

class PosEngine extends EventEmitter {
  constructor(hardwareAgent, tenantId) {
    super()
    this.hw = hardwareAgent
    this.tenantId = tenantId
    this.sessionState = {
      cashBalance: 0, cardCode: null, cardBalance: 0,
      hasCard: false, bonus: 0, credits: 0
    }
    this.settings = {}
  }

  init() {
    this.loadSettings()
    this.setupHardwareListeners()
    session.reset()
    console.log('[POS] Engine initialized for tenant:', this.tenantId)
  }

  loadSettings() {
    const keys = ['coinEqTable', 'billEqTable', 'rechargeCoinBonus', 'rechargeBillBonus',
                  'autoCharge', 'loyaltyCard.cost', 'loyaltyCard.credit']
    this.settings = {}
    for (const key of keys) {
      const s = settings.get(this.tenantId, key)
      if (s) {
        try { this.settings[key] = JSON.parse(s.value) }
        catch { this.settings[key] = s.value }
      }
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

  // ─── Credit Handling ───

  handleCredit(data) {
    const { type, amount } = data
    let mappedAmount = amount

    const eqTable = type === 'coin_acceptor'
      ? (this.settings.coinEqTable || [])
      : (this.settings.billEqTable || [])
    if (Array.isArray(eqTable) && eqTable.length > 0) {
      const mapping = eqTable.find(e => String(e.key) === String(amount))
      if (mapping) mappedAmount = Number(mapping.value)
    }

    let bonus = 0
    const bonusPercent = type === 'coin_acceptor'
      ? (this.settings.rechargeCoinBonus || 0)
      : (this.settings.rechargeBillBonus || 0)
    if (bonusPercent > 0) {
      bonus = roundMoney((mappedAmount * bonusPercent) / 100) // Fix #3
    }

    // Fix #3: Round all money operations
    this.sessionState.cashBalance = roundMoney(this.sessionState.cashBalance + mappedAmount)
    this.sessionState.bonus = roundMoney(this.sessionState.bonus + bonus)
    this.updateCredits()

    console.log(`[POS] Credit: €${mappedAmount.toFixed(2)} (${type})${bonus > 0 ? ` + €${bonus.toFixed(2)} bonus` : ''}, Total: €${this.sessionState.credits.toFixed(2)}`)
    this.emit('session:updated', this.getSession())
    this.emit('credit:accepted', { type, amount: mappedAmount, bonus, credits: this.sessionState.credits })
  }

  // ─── Card Operations ───

  handleCardDetected(data) {
    const { cardCode } = data
    const card = cards.getByCode(this.tenantId, cardCode)
    if (card) {
      this.sessionState.cardCode = cardCode
      this.sessionState.cardBalance = card.balance || 0
      this.sessionState.hasCard = true
      this.updateCredits()
      console.log(`[POS] Card loaded: ${cardCode}, Balance: €${(card.balance || 0).toFixed(2)}`)
      this.emit('card:loaded', { card, session: this.getSession() })
    } else {
      console.warn(`[POS] Unknown card: ${cardCode}`)
      this.emit('card:unknown', { cardCode })
    }
  }

  removeCard() {
    // Fix #15: Auto-charge sends delta, not absolute
    if (this.sessionState.hasCard && this.settings.autoCharge && this.sessionState.cashBalance > 0) {
      const card = cards.getByCode(this.tenantId, this.sessionState.cardCode)
      if (card) {
        const chargeAmount = roundMoney(this.sessionState.cashBalance + this.sessionState.bonus)
        const newBalance = roundMoney((card.balance || 0) + chargeAmount)
        cards.updateBalance(card.id, newBalance)
        // Fix #15: Send delta instead of absolute balance
        syncQueue.push('card', card.id, 'update',
          { id: card.id, code: card.code, delta: chargeAmount }, 2)
        this.sessionState.cashBalance = 0
        this.sessionState.bonus = 0
      }
    }
    this.sessionState.cardCode = null
    this.sessionState.cardBalance = 0
    this.sessionState.hasCard = false
    this.updateCredits()
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
    if (!card) throw new Error('Card not found')
    const topUpAmount = roundMoney(Number(amount))
    const newBalance = roundMoney((card.balance || 0) + topUpAmount)

    // Fix #5: Use returned sale ID for sync queue
    const saleResult = sales.create({
      tenant_id: this.tenantId,
      amount: topUpAmount,
      items: [{ type: 'recharge', amount: topUpAmount }],
      type: 'recharge',
      method: 'cash',
      card_id: card.id,
      card_code: code,
      inserted: topUpAmount,
      change_amount: 0
    })

    cards.updateBalance(card.id, newBalance)
    syncQueue.push('sale', saleResult.local_id, 'create',
      { local_id: saleResult.local_id, type: 'recharge', amount: topUpAmount, card_code: code }, 1)
    syncQueue.push('card', card.id, 'update',
      { id: card.id, code, delta: topUpAmount }, 2) // Fix #15: delta

    if (this.sessionState.cardCode === code) {
      this.sessionState.cardBalance = newBalance
      this.updateCredits()
      this.emit('session:updated', this.getSession())
    }
    return { card: { ...card, balance: newBalance }, newBalance }
  }

  // ─── Machine Operations ───

  getMachines() { return machines.getAll(this.tenantId) }
  getMachine(id) { return machines.getById(id) }

  getPrice(type, weight) {
    const price = prices.lookup(this.tenantId, type, Number(weight))
    if (!price) return null

    if (price.promo_active) {
      const now = new Date()
      const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
      const today = dayNames[now.getDay()]
      const promoDays = price.promo_days ? JSON.parse(price.promo_days) : []
      const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`

      if (promoDays.includes(today) &&
          (!price.promo_start_time || currentTime >= price.promo_start_time) &&
          (!price.promo_end_time || currentTime <= price.promo_end_time)) {
        return { ...price,
          effective_cash_price: price.promo_cash_price ?? price.cash_price,
          effective_card_price: price.promo_card_price ?? price.card_price,
          is_promo: true }
      }
    }
    return { ...price, effective_cash_price: price.cash_price, effective_card_price: price.card_price, is_promo: false }
  }

  getAllPrices() { return prices.getAll(this.tenantId) }

  /**
   * Process a sale — Fix #4: entire operation wrapped in transaction
   * Fix #3: all money rounded. Fix #6: balance validated >= 0
   */
  processSale(machineId, amount, method, cardCode, batchId, items) {
    const machine = machines.getById(machineId)
    if (!machine) throw new Error('Machine not found')
    if (machine.status === 'working') throw new Error('Machine already in use')

    const price = roundMoney(Number(amount))
    const saleId = generateId()
    let cardSyncData = null

    // Fix #4: Wrap entire operation in transaction — all or nothing
    runTransaction(() => {
      if (method === 'card' && cardCode) {
        const card = cards.getByCode(this.tenantId, cardCode)
        if (!card) throw new Error('Card not found')
        // Fix #6: Validate balance >= 0 after deduction
        const newBalance = roundMoney((card.balance || 0) - price)
        if (newBalance < 0) throw new Error('Insufficient card balance')
        cards.updateBalance(card.id, newBalance)

        if (this.sessionState.cardCode === cardCode) {
          this.sessionState.cardBalance = newBalance
        }
        cardSyncData = { id: card.id, code: cardCode, delta: -price }
      } else {
        // Fix #3: Round credit check
        if (roundMoney(this.sessionState.credits) < price) throw new Error('Insufficient credits')

        if (this.sessionState.hasCard && this.sessionState.cardBalance >= price) {
          this.sessionState.cardBalance = roundMoney(this.sessionState.cardBalance - price)
          const card = cards.getByCode(this.tenantId, this.sessionState.cardCode)
          if (card) {
            cards.updateBalance(card.id, this.sessionState.cardBalance)
            cardSyncData = { id: card.id, code: card.code, delta: -price }
          }
        } else if (this.sessionState.hasCard && this.sessionState.cardBalance > 0) {
          const fromCard = this.sessionState.cardBalance
          const remainder = roundMoney(price - fromCard)
          if (this.sessionState.cardCode) {
            const card = cards.getByCode(this.tenantId, this.sessionState.cardCode)
            if (card) {
              cards.updateBalance(card.id, 0)
              cardSyncData = { id: card.id, code: card.code, delta: -fromCard }
            }
          }
          this.sessionState.cardBalance = 0
          this.sessionState.cashBalance = roundMoney(this.sessionState.cashBalance - remainder)
        } else {
          this.sessionState.cashBalance = roundMoney(this.sessionState.cashBalance - price)
        }
        // Fix #6: Validate no negative
        if (this.sessionState.cashBalance < -0.01) throw new Error('Insufficient cash balance')
        this.updateCredits()
      }

      // Create sale inside transaction
      sales.create({
        id: saleId, local_id: saleId, tenant_id: this.tenantId,
        machine_id: machineId, amount: price,
        items: items || [{ type: machine.type, weight: machine.weight, price }],
        type: 'payment', method: method || (cardCode ? 'card' : 'cash'),
        batch_id: batchId || null, card_code: cardCode || null,
        inserted: method === 'cash' ? roundMoney(this.sessionState.cashBalance + price) : 0,
        change_amount: 0
      })

      machines.updateStatus(machineId, 'working', 'Ocupado')
      machines.incrementCycle(machineId)
    })

    // Queue sync items (outside transaction — not critical if these fail)
    syncQueue.push('sale', saleId, 'create',
      { local_id: saleId, tenant_id: this.tenantId, machine_id: machineId, amount: price,
        type: 'payment', method: method || (cardCode ? 'card' : 'cash'), card_code: cardCode || null }, 1)
    if (cardSyncData) syncQueue.push('card', cardSyncData.id, 'update', cardSyncData, 2)
    syncQueue.push('machine', machineId, 'update',
      { id: machineId, status: 'working', cycle: (machine.cycle || 0) + 1 }, 3)

    // Activate hardware (outside transaction — hardware is separate concern)
    const iface = machine.interface_id ? interfaces.getById(machine.interface_id) : null
    if (iface && this.hw) this.hw.activateMachine(machine, iface)

    flushSave() // Force immediate disk save after sale

    const updatedMachine = machines.getById(machineId)
    this.emit('sale:completed', { sale: { id: saleId, amount: price }, machine: updatedMachine })
    this.emit('session:updated', this.getSession())
    return { success: true, saleId, machine: updatedMachine }
  }

  adminStartMachine(machineId) {
    const machine = machines.getById(machineId)
    if (!machine) throw new Error('Machine not found')
    const saleId = generateId()

    runTransaction(() => {
      machines.updateStatus(machineId, 'working', 'Admin Start')
      machines.incrementCycle(machineId)
      sales.create({
        id: saleId, local_id: saleId, tenant_id: this.tenantId,
        machine_id: machineId, amount: 0, items: [{ type: 'admin_start' }],
        type: 'admin_start', method: 'admin'
      })
    })

    syncQueue.push('sale', saleId, 'create', { local_id: saleId, type: 'admin_start', machine_id: machineId, amount: 0 }, 1)
    syncQueue.push('machine', machineId, 'update', { id: machineId, status: 'working' }, 3)

    const iface = machine.interface_id ? interfaces.getById(machine.interface_id) : null
    if (iface && this.hw) this.hw.activateMachine(machine, iface)

    flushSave()
    return { success: true }
  }

  dispenseChange(amount) {
    if (amount <= 0) return { success: true, amount: 0 }
    if (!this.hw) return { success: false, error: 'Hardware not available' }
    return { success: this.hw.dispenseCoins(amount), amount }
  }

  printReceipt(content) {
    if (!this.hw) return false
    return this.hw.printReceipt(content)
  }

  // ─── Session ───

  updateCredits() {
    this.sessionState.credits = roundMoney(
      this.sessionState.cashBalance + this.sessionState.cardBalance + this.sessionState.bonus)
  }

  getSession() { return { ...this.sessionState } }

  resetSession() {
    this.sessionState = { cashBalance: 0, cardCode: null, cardBalance: 0, hasCard: false, bonus: 0, credits: 0 }
    session.reset()
    this.emit('session:updated', this.getSession())
  }

  getTransactions(limit) { return sales.getAll(this.tenantId, limit) }
  getSetting(key) { return settings.get(this.tenantId, key) }
  getAllSettings() { return settings.getAll(this.tenantId) }
}

module.exports = { PosEngine }

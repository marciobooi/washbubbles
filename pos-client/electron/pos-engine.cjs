/**
 * WashBubbles POS Engine
 * Local business logic coordinator — processes payments, activates machines,
 * handles cards, all 100% offline using local SQLite
 */
const EventEmitter = require('events')
const { machines, cards, sales, prices, settings, interfaces, syncQueue, session, generateId } = require('./database.cjs')

class PosEngine extends EventEmitter {
  constructor(hardwareAgent, tenantId) {
    super()
    this.hw = hardwareAgent
    this.tenantId = tenantId
    this.sessionState = {
      cashBalance: 0,
      cardCode: null,
      cardBalance: 0,
      hasCard: false,
      bonus: 0,
      credits: 0
    }
    this.settings = {}
  }

  /** Initialize POS engine — load settings, set up hardware event handlers */
  init() {
    this.loadSettings()
    this.setupHardwareListeners()
    // Reset session
    session.reset()
    console.log('[POS] Engine initialized for tenant:', this.tenantId)
  }

  /** Load settings from local DB */
  loadSettings() {
    const keys = ['coinEqTable', 'billEqTable', 'rechargeCoinBonus', 'rechargeBillBonus', 'autoCharge',
                  'loyaltyCard.cost', 'loyaltyCard.credit']
    this.settings = {}
    for (const key of keys) {
      const s = settings.get(this.tenantId, key)
      if (s) {
        try { this.settings[key] = JSON.parse(s.value) }
        catch { this.settings[key] = s.value }
      }
    }
  }

  /** Wire up hardware agent events to POS logic */
  setupHardwareListeners() {
    if (!this.hw) return

    // Coin/bill credit
    this.hw.on('credit', (data) => this.handleCredit(data))

    // RFID card detected
    this.hw.on('rfid:card_detected', (data) => this.handleCardDetected(data))

    // Machine activation result
    this.hw.on('machine:activation_sent', (data) => this.emit('machine:activated', data))
    this.hw.on('machine:activation_failed', (data) => this.emit('machine:activation_failed', data))

    // Hopper events
    this.hw.on('hopper:dispensed', (data) => this.emit('hopper:dispensed', data))
    this.hw.on('hopper:empty', (data) => this.emit('hopper:empty', data))
    this.hw.on('hopper:fault', (data) => this.emit('hopper:fault', data))

    // Rejection/fraud events
    this.hw.on('rejected', (data) => this.emit('credit:rejected', data))
    this.hw.on('fraud', (data) => this.emit('credit:fraud', data))

    // Interface status
    this.hw.on('interface:status', (data) => this.handleInterfaceStatus(data))
  }

  // ─── Credit Handling (Coins/Bills) ───

  handleCredit(data) {
    const { type, amount } = data
    let mappedAmount = amount

    // Apply equivalence table
    const eqTable = type === 'coin_acceptor'
      ? (this.settings.coinEqTable || [])
      : (this.settings.billEqTable || [])
    if (Array.isArray(eqTable) && eqTable.length > 0) {
      const mapping = eqTable.find(e => String(e.key) === String(amount))
      if (mapping) mappedAmount = Number(mapping.value)
    }

    // Calculate bonus
    let bonus = 0
    const bonusPercent = type === 'coin_acceptor'
      ? (this.settings.rechargeCoinBonus || 0)
      : (this.settings.rechargeBillBonus || 0)
    if (bonusPercent > 0) {
      bonus = (mappedAmount * bonusPercent) / 100
    }

    // Update session balance
    this.sessionState.cashBalance += mappedAmount
    this.sessionState.bonus += bonus
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
      console.log(`[POS] Card loaded: ${cardCode}, Balance: €${card.balance.toFixed(2)}`)
      this.emit('card:loaded', { card, session: this.getSession() })
    } else {
      console.warn(`[POS] Unknown card: ${cardCode}`)
      this.emit('card:unknown', { cardCode })
    }
  }

  removeCard() {
    // Auto-charge logic: if card was present and autoCharge is on, save accumulated cash to card
    if (this.sessionState.hasCard && this.settings.autoCharge && this.sessionState.cashBalance > 0) {
      const card = cards.getByCode(this.tenantId, this.sessionState.cardCode)
      if (card) {
        const newBalance = Number(((card.balance || 0) + this.sessionState.cashBalance + this.sessionState.bonus).toFixed(2))
        cards.updateBalance(card.id, newBalance)
        syncQueue.push('card', card.id, 'update', { id: card.id, code: card.code, balance: newBalance }, 2)
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

  getCard(code) {
    return cards.getByCode(this.tenantId, code)
  }

  getCardHistory(code) {
    const card = cards.getByCode(this.tenantId, code)
    if (!card) return null
    const txns = sales.getByCardCode(this.tenantId, code, 30)
    return { card, transactions: txns }
  }

  topUpCard(code, amount) {
    const card = cards.getByCode(this.tenantId, code)
    if (!card) throw new Error('Card not found')
    const newBalance = Number(((card.balance || 0) + Number(amount)).toFixed(2))
    cards.updateBalance(card.id, newBalance)

    // Create sale record
    const saleData = {
      tenant_id: this.tenantId,
      amount: Number(amount),
      items: JSON.stringify([{ type: 'recharge', amount }]),
      type: 'recharge',
      method: 'cash',
      card_id: card.id,
      card_code: code,
      inserted: Number(amount),
      change_amount: 0,
      created_at: new Date().toISOString()
    }
    sales.create(saleData)
    syncQueue.push('sale', saleData.local_id || card.id, 'create', saleData, 1)
    syncQueue.push('card', card.id, 'update', { id: card.id, code, balance: newBalance }, 2)

    // Update session if this card is loaded
    if (this.sessionState.cardCode === code) {
      this.sessionState.cardBalance = newBalance
      this.updateCredits()
      this.emit('session:updated', this.getSession())
    }

    return { card: { ...card, balance: newBalance }, newBalance }
  }

  // ─── Machine Operations ───

  getMachines() {
    return machines.getAll(this.tenantId)
  }

  getMachine(id) {
    return machines.getById(id)
  }

  getPrice(type, weight) {
    const price = prices.lookup(this.tenantId, type, Number(weight))
    if (!price) return null

    // Check promo pricing
    if (price.promo_active) {
      const now = new Date()
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      const today = dayNames[now.getDay()]
      const promoDays = price.promo_days ? JSON.parse(price.promo_days) : []
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

      if (promoDays.includes(today) &&
          (!price.promo_start_time || currentTime >= price.promo_start_time) &&
          (!price.promo_end_time || currentTime <= price.promo_end_time)) {
        return {
          ...price,
          effective_cash_price: price.promo_cash_price ?? price.cash_price,
          effective_card_price: price.promo_card_price ?? price.card_price,
          is_promo: true
        }
      }
    }

    return { ...price, effective_cash_price: price.cash_price, effective_card_price: price.card_price, is_promo: false }
  }

  getAllPrices() {
    return prices.getAll(this.tenantId)
  }

  /** Process a sale — deduct credits, create record, activate machine */
  processSale(machineId, amount, method, cardCode, batchId, items) {
    const machine = machines.getById(machineId)
    if (!machine) throw new Error('Machine not found')
    if (machine.status === 'working') throw new Error('Machine already in use')

    const price = Number(amount)

    // Validate payment
    if (method === 'card' && cardCode) {
      const card = cards.getByCode(this.tenantId, cardCode)
      if (!card) throw new Error('Card not found')
      if ((card.balance || 0) < price) throw new Error('Insufficient card balance')

      // Deduct from card
      const newBalance = Number(((card.balance || 0) - price).toFixed(2))
      cards.updateBalance(card.id, newBalance)

      // Update session if this card is loaded
      if (this.sessionState.cardCode === cardCode) {
        this.sessionState.cardBalance = newBalance
        this.updateCredits()
      }

      // Queue card sync
      syncQueue.push('card', card.id, 'update', { id: card.id, code: cardCode, balance: newBalance, delta: -price }, 2)
    } else {
      // Cash payment — deduct from session balance
      if (this.sessionState.credits < price) throw new Error('Insufficient credits')
      // Deduct from card first if loaded, then cash
      if (this.sessionState.hasCard && this.sessionState.cardBalance >= price) {
        this.sessionState.cardBalance -= price
        const card = cards.getByCode(this.tenantId, this.sessionState.cardCode)
        if (card) {
          cards.updateBalance(card.id, this.sessionState.cardBalance)
          syncQueue.push('card', card.id, 'update', { id: card.id, code: card.code, balance: this.sessionState.cardBalance, delta: -price }, 2)
        }
      } else if (this.sessionState.hasCard) {
        const remainder = price - this.sessionState.cardBalance
        if (this.sessionState.cardCode) {
          const card = cards.getByCode(this.tenantId, this.sessionState.cardCode)
          if (card) {
            cards.updateBalance(card.id, 0)
            syncQueue.push('card', card.id, 'update', { id: card.id, code: card.code, balance: 0, delta: -this.sessionState.cardBalance }, 2)
          }
        }
        this.sessionState.cardBalance = 0
        this.sessionState.cashBalance -= remainder
      } else {
        this.sessionState.cashBalance -= price
      }
      this.updateCredits()
    }

    // Create sale record
    const saleId = generateId()
    const saleData = {
      id: saleId,
      local_id: saleId,
      tenant_id: this.tenantId,
      machine_id: machineId,
      amount: price,
      items: items || [{ type: machine.type, weight: machine.weight, price }],
      type: 'payment',
      method: method || (cardCode ? 'card' : 'cash'),
      batch_id: batchId || null,
      card_id: null,
      card_code: cardCode || null,
      inserted: method === 'cash' ? this.sessionState.cashBalance + price : 0,
      change_amount: 0,
      created_at: new Date().toISOString()
    }
    sales.create(saleData)

    // Queue sale for sync (highest priority)
    syncQueue.push('sale', saleId, 'create', saleData, 1)

    // Update machine status locally
    machines.updateStatus(machineId, 'working', 'Ocupado')
    machines.incrementCycle(machineId)

    // Activate physical machine via hardware
    const iface = machine.interface_id ? interfaces.getById(machine.interface_id) : null
    if (iface && this.hw) {
      this.hw.activateMachine(machine, iface)
    }

    // Queue machine status sync
    syncQueue.push('machine', machineId, 'update', { id: machineId, status: 'working', cycle: (machine.cycle || 0) + 1 }, 3)

    this.emit('sale:completed', { sale: saleData, machine: machines.getById(machineId) })
    this.emit('session:updated', this.getSession())

    return { success: true, saleId, machine: machines.getById(machineId) }
  }

  /** Admin start — activate machine without payment */
  adminStartMachine(machineId) {
    const machine = machines.getById(machineId)
    if (!machine) throw new Error('Machine not found')

    machines.updateStatus(machineId, 'working', 'Admin Start')
    machines.incrementCycle(machineId)

    const saleId = generateId()
    sales.create({
      id: saleId, local_id: saleId, tenant_id: this.tenantId,
      machine_id: machineId, amount: 0, items: [{ type: 'admin_start' }],
      type: 'admin_start', method: 'admin',
      created_at: new Date().toISOString()
    })
    syncQueue.push('sale', saleId, 'create', { id: saleId, type: 'admin_start', machine_id: machineId, amount: 0 }, 1)

    const iface = machine.interface_id ? interfaces.getById(machine.interface_id) : null
    if (iface && this.hw) this.hw.activateMachine(machine, iface)

    syncQueue.push('machine', machineId, 'update', { id: machineId, status: 'working' }, 3)
    return { success: true }
  }

  // ─── Change Dispensing ───

  dispenseChange(amount) {
    if (amount <= 0) return { success: true, amount: 0 }
    if (!this.hw) return { success: false, error: 'Hardware not available' }
    const ok = this.hw.dispenseCoins(amount)
    return { success: ok, amount }
  }

  // ─── Receipt Printing ───

  printReceipt(content) {
    if (!this.hw) return false
    return this.hw.printReceipt(content)
  }

  // ─── Interface Status Handling ───

  handleInterfaceStatus(data) {
    this.emit('interface:status', data)
  }

  // ─── Session Management ───

  updateCredits() {
    this.sessionState.credits = this.sessionState.cashBalance + this.sessionState.cardBalance + this.sessionState.bonus
  }

  getSession() {
    return { ...this.sessionState }
  }

  resetSession() {
    this.sessionState = { cashBalance: 0, cardCode: null, cardBalance: 0, hasCard: false, bonus: 0, credits: 0 }
    session.reset()
    this.emit('session:updated', this.getSession())
  }

  // ─── Transactions ───

  getTransactions(limit = 100) {
    return sales.getAll(this.tenantId, limit)
  }

  // ─── Settings ───

  getSetting(key) {
    return settings.get(this.tenantId, key)
  }

  getAllSettings() {
    return settings.getAll(this.tenantId)
  }
}

module.exports = { PosEngine }

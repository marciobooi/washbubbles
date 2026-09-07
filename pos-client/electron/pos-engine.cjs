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
    session.reset()
    console.log('[POS] Engine initialized for tenant:', this.tenantId)
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
    this.emit('session:updated', this.getSession())
    this.emit('credit:accepted', { type, amount: mappedAmount, bonus, credits: this.sessionState.credits })
  }

  handleCardDetected(data) {
    const { cardCode } = data
    const card = cards.getByCode(this.tenantId, cardCode)
    if (card) {
      this.sessionState.cardCode = cardCode
      this.sessionState.cardBalance = card.balance || 0
      this.sessionState.hasCard = true
      this.updateCredits()
      this.emit('card:loaded', { card, session: this.getSession() })
    } else {
      this.emit('card:unknown', { cardCode })
    }
  }

  removeCard() {
    if (this.sessionState.hasCard && this.settings.autoCharge && this.sessionState.cashBalance > 0) {
      const card = cards.getByCode(this.tenantId, this.sessionState.cardCode)
      if (card) {
        const chargeAmount = roundMoney(this.sessionState.cashBalance + this.sessionState.bonus)
        const newBalance = roundMoney((card.balance || 0) + chargeAmount)
        cards.updateBalance(card.id, newBalance)
        syncQueue.push('card', card.id, 'update', { id: card.id, code: card.code, delta: chargeAmount }, 2)
        this.sessionState.cashBalance = 0; this.sessionState.bonus = 0
      }
    }
    this.sessionState.cardCode = null; this.sessionState.cardBalance = 0; this.sessionState.hasCard = false
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
    const saleResult = sales.create({ tenant_id: this.tenantId, amount: topUpAmount, items: [{ type: 'recharge', amount: topUpAmount }], type: 'recharge', method: 'cash', card_id: card.id, card_code: code, inserted: topUpAmount, change_amount: 0 })
    cards.updateBalance(card.id, newBalance)
    syncQueue.push('sale', saleResult.local_id, 'create', { local_id: saleResult.local_id, type: 'recharge', amount: topUpAmount, card_code: code }, 1)
    syncQueue.push('card', card.id, 'update', { id: card.id, code, delta: topUpAmount }, 2)
    if (this.sessionState.cardCode === code) { this.sessionState.cardBalance = newBalance; this.updateCredits(); this.emit('session:updated', this.getSession()) }
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
    runTransaction(() => {
      if (method === 'card' && cardCode) {
        const card = cards.getByCode(this.tenantId, cardCode); if (!card) throw new Error('Card not found')
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
    syncQueue.push('sale', saleId, 'create', { local_id: saleId, tenant_id: this.tenantId, machine_id: machineId, amount: price, type: 'payment', method: method || (cardCode ? 'card' : 'cash'), card_code: cardCode || null }, 1)
    if (cardSyncData) syncQueue.push('card', cardSyncData.id, 'update', cardSyncData, 2)
    syncQueue.push('machine', machineId, 'update', { id: machineId, status: 'working', cycle: (machine.cycle || 0) + 1 }, 3)
    const iface = machine.interface_id ? interfaces.getById(machine.interface_id) : null
    if (iface && this.hw) this.hw.activateMachine(machine, iface)
    flushSave(); this.emit('sale:completed', { sale: { id: saleId, amount: price }, machine: machines.getById(machineId) }); this.emit('session:updated', this.getSession())
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
    syncQueue.push('day_close', result.local_id, 'create', report, 4)
    
    console.log(`[POS] Day Close completed for ${today}: €${totalSales}`)
    return report
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

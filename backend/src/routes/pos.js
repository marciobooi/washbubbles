import express from 'express'
import Machine from '../models/machine.js'
import Sale from '../models/sale.js'
import Setting from '../models/setting.js'
import Price from '../models/price.js'
import { requireKiosk } from '../middleware/auth.js'
import { broadcastMachines, broadcastMachine } from '../wsServer.js'
import { withTenant } from '../services/tenant.js'
import { roundMoney, parseAmount } from '../utils/money.js'
import coinMachine from '../services/coinMachine.js'

const router = express.Router()

// POS routes are public (can be configured to use token if required)
const getMachineStatus = async (req, res) => {
  const MachineT = withTenant(Machine, req)
  const machines = await MachineT.find().sort({ createdAt: 1 })
  const data = machines.map((m) => ({ id: m.id, name: m.name, status: m.status, cycle: m.cycle }))
  res.json(data)
}

router.get('/machine-status', getMachineStatus)
// Alias used by frontend hook: `/api/machine`
router.get('/machine', getMachineStatus)

// Public price lookup endpoint for POS kiosk display (no auth required)
router.get('/prices/lookup', async (req, res) => {
  const { type, weight } = req.query
  if (!type || !weight) return res.status(400).json({ error: 'Missing type or weight' })
  const PriceT = withTenant(Price, req)
  const price = await PriceT.findOne({ type, weight: Number(weight) })
  if (!price) return res.status(404).json({ error: 'Price not found for this type/weight' })
  res.json(price)
})

// Kiosk-only machines list: returns richer machine objects and accepts optional `type` query
// This endpoint requires a kiosk API key (`x-api-key` header or `Authorization: ApiKey <key>`).
// Kiosks should use this to fetch machine metadata; status changes (occupy/free) are performed via /pos/sale.
router.get('/machines', requireKiosk, async (req, res) => {
  const typeFilter = req.query.type
  const MachineT = withTenant(Machine, req)
  const machines = await MachineT.find().sort({ createdAt: 1 })
  let data = machines.map((m) => ({
    _id: m._id,
    id: m.id,
    name: m.name,
    weight: m.weight,
    price: m.price,
    loyaltyPrice: m.loyaltyPrice,
    status: m.status,
    statusText: m.statusText,
    type: m.type,
    icon: m.icon,
  }))
  if (typeFilter) data = data.filter((m) => (m.type || 'wash') === String(typeFilter))
  res.json(data)
})

router.post('/sale', requireKiosk, async (req, res) => {
  const { machineId, amount, items, method, inserted, type, cardCode, cardId, batchId } = req.body
  if (!machineId || !items) return res.status(400).json({ error: 'Missing parameters' })

  const parsedSale = parseAmount(amount)
  if (!parsedSale.ok) return res.status(400).json({ error: parsedSale.error })
  const saleAmount = parsedSale.value

  // Only accept 'card' or 'cash' as payment methods from clients
  if (method && !['card', 'cash'].includes(String(method))) return res.status(400).json({ error: 'Unsupported payment method' })

  // Ensure machine exists
  const MachineT = withTenant(Machine, req)
  const machine = await MachineT.findById(machineId)
  if (!machine) return res.status(404).json({ error: 'Machine not found' })

  // Prevent occupying a machine that is already working
  if (machine.status === 'working') {
    return res.status(409).json({ error: 'Machine already in use' })
  }

  // If card specified and method is card, deduct from card balance
  let card = null
  if ((cardId || cardCode) && method === 'card') {
    const Card = (await import('../models/card.js')).default
    const CardT = withTenant(Card, req)
    card = cardId ? await CardT.findById(cardId) : await CardT.findOne({ code: cardCode })
    if (!card) return res.status(404).json({ error: 'Card not found' })
    if (roundMoney(card.balance || 0) < saleAmount) return res.status(400).json({ error: 'Insufficient balance' })
    card.balance = roundMoney((card.balance || 0) - saleAmount)
    if (!card.tenantId && req.tenantId) card.tenantId = req.tenantId
    await card.save()
  }

  // Compute inserted/change defaults and create sale. `change` is always derived,
  // never taken from the request body — a client-supplied change value is a
  // request to empty the hopper.
  const parsedInserted = parseAmount(inserted, { allowZero: true })
  const insertedNum = parsedInserted.ok ? parsedInserted.value : 0
  const changeNum = roundMoney(Math.max(0, insertedNum - saleAmount))
  const SaleT = withTenant(Sale, req)
  const sale = await SaleT.create({ machineId, amount: saleAmount, items, method, batchId, inserted: insertedNum, change: changeNum, type: type || 'payment', cardId: card ? card._id : undefined, cardCode: card ? card.code : (cardCode || undefined) })

  // Update machine: increment cycle and mark as occupied after successful payment
  await MachineT.findByIdAndUpdate(machineId, { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } })

  const updated = await MachineT.findById(machineId)
  // broadcast single updated machine so clients refresh quickly
  try { await broadcastMachine(updated) } catch (e) { console.error('[pos] broadcastMachine error', e) }

  res.json({ sale, machine: updated, card })
})

// Card recharge / top-up (kiosk) — stored as a transaction without a machine reference
// Card recharge / top-up (kiosk) — stored as a transaction and optionally attached to a loyalty card
router.post('/recharge', requireKiosk, async (req, res) => {
  const { amount, items, method, inserted, cardCode, cardId, batchId } = req.body

  // Recharges are always card-based in this system
  if (method && String(method) !== 'card') return res.status(400).json({ error: 'Recharges must be performed with method "card"' })

  const parsedAmount = parseAmount(amount)
  if (!parsedAmount.ok) return res.status(400).json({ error: parsedAmount.error })
  const rechargeAmount = parsedAmount.value

  const parsedInserted = parseAmount(inserted == null ? rechargeAmount : inserted)
  if (!parsedInserted.ok) return res.status(400).json({ error: `inserted: ${parsedInserted.error}` })
  const insertedNum = parsedInserted.value

  if (insertedNum < rechargeAmount) {
    return res.status(400).json({ error: 'Inserted amount is less than the recharge amount' })
  }
  // Change is always derived here, never taken from the request — a client-supplied
  // `change` is a request to empty the hopper.
  const changeAmount = roundMoney(insertedNum - rechargeAmount)

  // Both models must be tenant-scoped: without it a kiosk key from tenant A can
  // top up tenant B's card by id or code.
  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const SaleT = withTenant(Sale, req)

  // If card specified, update its balance
  let card = null
  if (cardId || cardCode) {
    if (cardId) card = await CardT.findById(cardId)
    else card = await CardT.findOne({ code: cardCode })
    if (!card && cardCode) {
      // create card implicitly when code provided (CardT.create() injects tenantId automatically)
      card = await CardT.create({ code: cardCode, balance: 0 })
    }
    if (card) {
      card.balance = roundMoney((card.balance || 0) + rechargeAmount)
      await card.save()
    }
  }

  // Record the sale BEFORE any coin leaves the machine. If this throws, no change
  // has been dispensed yet; the reverse ordering left coins in the customer's hand
  // with no Sale row, which shows up at day-close as an unexplainable shortage.
  const sale = await SaleT.create({
    amount: rechargeAmount,
    items,
    method: method || 'card',
    batchId,
    inserted: insertedNum,
    change: changeAmount,
    type: 'recharge',
    cardId: card ? card._id : undefined,
    cardCode: card ? card.code : (cardCode || undefined)
  })

  // Dispense change if needed
  let changeDispensed = false
  let changeError = null
  if (changeAmount > 0) {
    try {
      const Peripheral = (await import('../models/peripheral.js')).default
      const PeripheralT = withTenant(Peripheral, req)
      const hopper = await PeripheralT.findOne({ type: 'hopper', enabled: true })

      if (hopper) {
        const result = await coinMachine.dispenseChange(hopper._id, changeAmount)
        // dispenseChange resolves with `{success:false}` on a jam rather than throwing.
        changeDispensed = result?.success !== false
        if (!changeDispensed) changeError = result?.error || 'Hopper reported a fault'
      } else {
        changeError = 'No hopper configured'
        console.warn('[pos] No hopper available for change dispensing')
      }
    } catch (e) {
      changeError = e.message
      console.error('[pos] Failed to dispense change:', e.message)
    }
    if (!changeDispensed) {
      // The sale is already recorded, so the shortfall is attributable. Tell the
      // kiosk so it can show "collect your change at the counter" instead of
      // silently keeping the customer's money.
      console.error(`[pos] Change of €${changeAmount.toFixed(2)} owed on sale ${sale._id}: ${changeError}`)
    }
  }

  res.json({ sale, card, change: changeAmount, changeDispensed, changeError })
})

// Card purchase endpoint - handles new card purchases with customer data
router.post('/card/purchase', requireKiosk, async (req, res) => {
  const { inserted, customerName, customerEmail, customerPhone, customerContribuinte, batchId } = req.body
  
  if (!inserted || Number(inserted) <= 0) {
    return res.status(400).json({ error: 'Missing payment amount' })
  }

  try {
    // Get card purchase settings from loyaltyCard config
    const SettingT = withTenant(Setting, req)
    const purchasePrice = await SettingT.findOne({ key: 'loyaltyCard.cost' })
    const initialCredit = await SettingT.findOne({ key: 'loyaltyCard.credit' })
    
    const price = purchasePrice?.value ? Number(purchasePrice.value) : 0
    const credit = initialCredit?.value ? Number(initialCredit.value) : 0
    
    if (price <= 0) {
      return res.status(400).json({ error: 'Card purchase price not configured' })
    }

    const insertedAmount = Number(inserted)
    
    if (insertedAmount < price) {
      return res.status(400).json({ error: `Insufficient payment. Card costs €${price.toFixed(2)}` })
    }

    // Calculate change
    const changeAmount = insertedAmount - price

    // Generate unique card code (10 digits)
    const Card = (await import('../models/card.js')).default
    const CardPurchase = (await import('../models/cardPurchase.js')).default
    const CardT = withTenant(Card, req)
    const CardPurchaseT = withTenant(CardPurchase, req)
    
    let cardCode = ''
    let cardExists = true
    
    // Generate unique card code
    while (cardExists) {
      cardCode = Math.floor(1000000000 + Math.random() * 9000000000).toString()
      cardExists = await CardT.findOne({ code: cardCode })
    }

    // Step 1: Dispense card from dispenser
    let cardDispensed = false
    try {
      const { middleware } = await import('../index.js')
      const Peripheral = (await import('../models/peripheral.js')).default
      const PeripheralT = withTenant(Peripheral, req)
      const dispenser = await PeripheralT.findOne({ type: 'card_dispenser', enabled: true })
      
      if (dispenser && middleware) {
        await middleware.dispenseCard(dispenser._id)
        cardDispensed = true
        console.log(`Card dispensed for code: ${cardCode}`)
      } else {
        console.warn('No card dispenser available')
      }
    } catch (e) {
      console.error('Failed to dispense card:', e.message)
      return res.status(500).json({ error: 'Failed to dispense card' })
    }

    // Step 2: Create card in database with customer data
    const card = await CardT.create({
      code: cardCode,
      balance: credit,
      name: customerName || '',
      email: customerEmail || '',
      phone: customerPhone || '',
      contribuinte: customerContribuinte || ''
    })

    // Step 3: Wait for user to insert card into reader to write data
    // This will be handled by frontend flow - card data is already in DB
    // RFID reader will verify card code matches when user inserts

    // Create sale record
    const SaleT = withTenant(Sale, req)
    const sale = await SaleT.create({
      amount: price,
      items: [{ type: 'card_purchase', amount: price, cardCode }],
      method: 'cash',
      batchId,
      inserted: insertedAmount,
      change: changeAmount,
      type: 'card_purchase'
    })

    // Track card purchase
    const cardPurchase = await CardPurchaseT.create({
      cardId: card._id,
      cardCode: cardCode,
      purchasePrice: price,
      initialCredit: credit,
      paymentMethod: 'cash',
      amountInserted: insertedAmount,
      changeGiven: changeAmount,
      customerName: customerName || '',
      customerEmail: customerEmail || '',
      customerPhone: customerPhone || '',
      customerContribuinte: customerContribuinte || '',
      saleId: sale._id,
      batchId,
      dispenserUsed: cardDispensed,
      cardWritten: false // Will be updated when card is written
    })

    // Dispense change if needed
    let changeDispensed = false
    if (changeAmount > 0) {
      try {
        const { middleware } = await import('../index.js')
        const Peripheral = (await import('../models/peripheral.js')).default
        const PeripheralT = withTenant(Peripheral, req)
        const hopper = await PeripheralT.findOne({ type: 'hopper', enabled: true })
        
        if (hopper && middleware) {
          await middleware.dispenseChange(hopper._id, changeAmount)
          changeDispensed = true
          console.log(`Change dispensed: €${changeAmount.toFixed(2)}`)
        }
      } catch (e) {
        console.error('Failed to dispense change:', e.message)
      }
    }

    res.json({
      success: true,
      card,
      cardPurchase,
      sale,
      change: changeAmount,
      changeDispensed,
      message: 'Card dispensed. Please insert card into reader to activate.'
    })
  } catch (e) {
    console.error('Card purchase error:', e)
    res.status(500).json({ error: e.message || 'Card purchase failed' })
  }
})

// Get card balance + recent transaction history (kiosk)
router.get('/cards/:code/history', requireKiosk, async (req, res) => {
  const code = req.params.code
  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const card = await CardT.findOne({ code }).lean()
  if (!card) return res.status(404).json({ error: 'Card not found' })

  const SaleT = withTenant(Sale, req)
  const sales = await SaleT.find({ cardCode: code }).sort({ createdAt: -1 }).limit(30).lean()
  const transactions = sales.map((s) => ({
    id: String(s._id),
    ts: s.createdAt,
    type: s.type || 'payment',
    amount: s.type === 'payment' ? -Math.abs(s.amount) : Math.abs(s.amount)
  }))

  res.json({ card, transactions })
})

// Mark card as written after RFID write
router.post('/card/mark-written/:code', requireKiosk, async (req, res) => {
  const code = req.params.code
  
  try {
    const CardPurchase = (await import('../models/cardPurchase.js')).default
    const CardPurchaseT = withTenant(CardPurchase, req)

    const purchase = await CardPurchaseT.findOneAndUpdate(
      { cardCode: code, cardWritten: false },
      { cardWritten: true },
      { new: true }
    )
    
    if (!purchase) {
      return res.status(404).json({ error: 'Card purchase not found or already written' })
    }
    
    res.json({ success: true, purchase })
  } catch (e) {
    console.error('Mark card written error:', e)
    res.status(500).json({ error: e.message })
  }
})

// Write card data to RFID card
router.post('/card/write/:code', requireKiosk, async (req, res) => {
  const code = req.params.code
  
  try {
    const Card = (await import('../models/card.js')).default
    const CardT = withTenant(Card, req)
    const card = await CardT.findOne({ code })
    
    if (!card) {
      return res.status(404).json({ error: 'Card not found' })
    }

    // Get RFID reader and write data
    const { middleware } = await import('../index.js')
    const Peripheral = (await import('../models/peripheral.js')).default
    const PeripheralT = withTenant(Peripheral, req)
    const rfidReader = await PeripheralT.findOne({ type: 'rfid_reader', enabled: true })
    
    if (!rfidReader || !middleware) {
      return res.status(503).json({ error: 'RFID reader not available' })
    }

    // Write card data
    const result = await middleware.writeCardData(rfidReader._id, {
      code: card.code,
      balance: card.balance,
      name: card.name,
      email: card.email,
      phone: card.phone,
      contribuinte: card.contribuinte
    })

    if (result.success) {
      // Mark purchase as written
      const CardPurchase = (await import('../models/cardPurchase.js')).default
      const CardPurchaseT = withTenant(CardPurchase, req)
      await CardPurchaseT.findOneAndUpdate(
        { cardCode: code },
        { cardWritten: true }
      )
      
      res.json({ success: true, message: 'Card data written successfully' })
    } else {
      throw new Error('Failed to write card data')
    }
  } catch (e) {
    console.error('Card write error:', e)
    res.status(500).json({ error: e.message || 'Failed to write card' })
  }
})

// Read card data from RFID reader
router.get('/card/read', requireKiosk, async (req, res) => {
  try {
    const { middleware } = await import('../index.js')
    const Peripheral = (await import('../models/peripheral.js')).default
    const PeripheralT = withTenant(Peripheral, req)
    const rfidReader = await PeripheralT.findOne({ type: 'rfid_reader', enabled: true })
    
    if (!rfidReader || !middleware) {
      return res.status(503).json({ error: 'RFID reader not available' })
    }

    // Read card data
    const result = await middleware.readCardData(rfidReader._id)

    if (result.success) {
      res.json({ success: true, cardData: result.cardData })
    } else {
      throw new Error('Failed to read card data')
    }
  } catch (e) {
    console.error('Card read error:', e)
    res.status(500).json({ error: e.message || 'Failed to read card' })
  }
})

// Public: lookup card by code (kiosk will use this to show balance)
router.get('/cards/:code', requireKiosk, async (req, res) => {
  const code = req.params.code
  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const c = await CardT.findOne({ code }).lean()
  if (!c) return res.status(404).json({ error: 'Card not found' })
  res.json(c)
})

// Public: lightweight settings lookup for branding and card purchase keys (no auth)
router.get('/settings/:key', async (req, res) => {
  const key = String(req.params.key || '')
  // Allow branding and cardPurchase settings to be accessed publicly
  if (!key.startsWith('branding.') && !key.startsWith('cardPurchase.') && !key.startsWith('loyaltyCard.')) {
    return res.status(404).json({ error: 'Not found' })
  }
  const SettingT = withTenant(Setting, req)
  const s = await SettingT.findOne({ key }).lean()
  if (!s) return res.status(404).json({ error: 'Setting not found' })
  res.json(s)
})

// Spending using card: deduct amount from card balance and create Sale
router.post('/cards/:code/spend', requireKiosk, async (req, res) => {
  const code = req.params.code
  const { machineId, amount, items, method, batchId } = req.body
  if (!code) return res.status(400).json({ error: 'Missing parameters' })
  if (method && String(method) !== 'card') return res.status(400).json({ error: 'Card spending must use method "card"' })

  // Without this a negative amount *credits* the card: `balance - Number(-50)`.
  const parsed = parseAmount(amount)
  if (!parsed.ok) return res.status(400).json({ error: parsed.error })
  const price = parsed.value

  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const card = await CardT.findOne({ code })
  if (!card) return res.status(404).json({ error: 'Card not found' })

  // Check the machine is free *before* debiting — otherwise a 409 leaves the
  // customer charged for a wash that never starts.
  const MachineT = withTenant(Machine, req)
  if (machineId) {
    const m = await MachineT.findById(machineId)
    if (!m) return res.status(404).json({ error: 'Machine not found' })
    if (m.status === 'working') return res.status(409).json({ error: 'Machine already in use' })
  }

  if (roundMoney(card.balance || 0) < price) return res.status(400).json({ error: 'Insufficient balance' })

  card.balance = roundMoney((card.balance || 0) - price)
  await card.save()

  const SaleT = withTenant(Sale, req)
  const sale = await SaleT.create({ machineId, amount: price, items, method: 'card', batchId, type: 'payment', cardId: card._id, cardCode: card.code })

  // Update machine state if relevant
  if (machineId) {
    await MachineT.findByIdAndUpdate(machineId, { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } })
    const updated = await MachineT.findById(machineId)
    try { await broadcastMachine(updated) } catch (e) { console.error('[pos] broadcastMachine error', e) }
    return res.json({ sale, machine: updated, card })
  }

  res.json({ sale, card })
})

export default router

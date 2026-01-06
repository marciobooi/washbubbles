import express from 'express'
import Machine from '../models/machine.js'
import Sale from '../models/sale.js'
import Setting from '../models/setting.js'
import Price from '../models/price.js'
import { requireKiosk } from '../middleware/auth.js'
import { broadcastMachines, broadcastMachine } from '../wsServer.js'

const router = express.Router()

// POS routes are public (can be configured to use token if required)
const getMachineStatus = async (req, res) => {
  const machines = await Machine.find().sort({ createdAt: 1 })
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
  const price = await Price.findOne({ type, weight: Number(weight) })
  if (!price) return res.status(404).json({ error: 'Price not found for this type/weight' })
  res.json(price)
})

// Kiosk-only machines list: returns richer machine objects and accepts optional `type` query
// This endpoint requires a kiosk API key (`x-api-key` header or `Authorization: ApiKey <key>`).
// Kiosks should use this to fetch machine metadata; status changes (occupy/free) are performed via /pos/sale.
router.get('/machines', requireKiosk, async (req, res) => {
  const typeFilter = req.query.type
  const machines = await Machine.find().sort({ createdAt: 1 })
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
  const { machineId, amount, items, method, inserted, change, type, cardCode, cardId, batchId } = req.body
  if (!machineId || amount == null || !items) return res.status(400).json({ error: 'Missing parameters' })

  // Only accept 'card' or 'cash' as payment methods from clients
  if (method && !['card', 'cash'].includes(String(method))) return res.status(400).json({ error: 'Unsupported payment method' })

  // Ensure machine exists
  const machine = await Machine.findById(machineId)
  if (!machine) return res.status(404).json({ error: 'Machine not found' })

  // Prevent occupying a machine that is already working
  if (machine.status === 'working') {
    return res.status(409).json({ error: 'Machine already in use' })
  }

  // If card specified and method is card, deduct from card balance
  let card = null
  if ((cardId || cardCode) && method === 'card') {
    const Card = (await import('../models/card.js')).default
    card = cardId ? await Card.findById(cardId) : await Card.findOne({ code: cardCode })
    if (!card) return res.status(404).json({ error: 'Card not found' })
    const price = Number(amount)
    if ((card.balance || 0) < price) return res.status(400).json({ error: 'Insufficient balance' })
    card.balance = Number((card.balance || 0) - price)
    await card.save()
  }

  // Compute inserted/change defaults and create sale
  const insertedNum = Number(inserted || 0)
  const changeNum = (change != null) ? Number(change) : Math.max(0, insertedNum - Number(amount || 0))
  const sale = await Sale.create({ machineId, amount: Number(amount), items, method, batchId, inserted: insertedNum, change: changeNum, type: type || 'payment', cardId: card ? card._id : undefined, cardCode: card ? card.code : (cardCode || undefined) })

  // Update machine: increment cycle and mark as occupied after successful payment
  await Machine.findByIdAndUpdate(machineId, { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } })

  const updated = await Machine.findById(machineId)
  // broadcast single updated machine so clients refresh quickly
  try { await broadcastMachine(updated) } catch (e) { console.error('[pos] broadcastMachine error', e) }

  res.json({ sale, machine: updated, card })
})

// Card recharge / top-up (kiosk) — stored as a transaction without a machine reference
// Card recharge / top-up (kiosk) — stored as a transaction and optionally attached to a loyalty card
router.post('/recharge', requireKiosk, async (req, res) => {
  const { amount, items, method, inserted, change, cardCode, cardId, batchId } = req.body
  if (amount == null) return res.status(400).json({ error: 'Missing amount' })

  // Recharges are always card-based in this system
  if (method && String(method) !== 'card') return res.status(400).json({ error: 'Recharges must be performed with method "card"' })

  // Calculate change if inserted amount provided
  const insertedNum = Number(inserted || amount)
  const rechargeAmount = Number(amount)
  const changeAmount = insertedNum > rechargeAmount ? insertedNum - rechargeAmount : 0

  // If card specified, update its balance
  let card = null
  if (cardId || cardCode) {
    const Card = (await import('../models/card.js')).default
    if (cardId) card = await Card.findById(cardId)
    else card = await Card.findOne({ code: cardCode })
    if (!card && cardCode) {
      // create card implicitly when code provided
      card = await Card.create({ code: cardCode, balance: 0 })
    }
    if (card) {
      card.balance = Number((card.balance || 0) + rechargeAmount)
      await card.save()
    }
  }

  // Dispense change if needed
  let changeDispensed = false
  if (changeAmount > 0) {
    try {
      // Get middleware instance and dispense change via hopper
      const { middleware } = await import('../index.js')
      const Peripheral = (await import('../models/peripheral.js')).default
      const hopper = await Peripheral.findOne({ type: 'hopper', enabled: true })
      
      if (hopper && middleware) {
        await middleware.dispenseChange(hopper._id, changeAmount)
        changeDispensed = true
        console.log(`Change dispensed: €${changeAmount.toFixed(2)}`)
      } else {
        console.warn('No hopper available for change dispensing')
      }
    } catch (e) {
      console.error('Failed to dispense change:', e.message)
      // Continue even if change dispensing fails - return error in response
    }
  }

  const sale = await Sale.create({ 
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
  
  res.json({ sale, card, change: changeAmount, changeDispensed })
})

// Card purchase endpoint - handles new card purchases with customer data
router.post('/card/purchase', requireKiosk, async (req, res) => {
  const { inserted, customerName, customerEmail, customerPhone, customerContribuinte, batchId } = req.body
  
  if (!inserted || Number(inserted) <= 0) {
    return res.status(400).json({ error: 'Missing payment amount' })
  }

  try {
    // Get card purchase settings from loyaltyCard config
    const purchasePrice = await Setting.findOne({ key: 'loyaltyCard.cost' })
    const initialCredit = await Setting.findOne({ key: 'loyaltyCard.credit' })
    
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
    
    let cardCode = ''
    let cardExists = true
    
    // Generate unique card code
    while (cardExists) {
      cardCode = Math.floor(1000000000 + Math.random() * 9000000000).toString()
      cardExists = await Card.findOne({ code: cardCode })
    }

    // Step 1: Dispense card from dispenser
    let cardDispensed = false
    try {
      const { middleware } = await import('../index.js')
      const Peripheral = (await import('../models/peripheral.js')).default
      const dispenser = await Peripheral.findOne({ type: 'card_dispenser', enabled: true })
      
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
    const card = await Card.create({
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
    const sale = await Sale.create({
      amount: price,
      items: [{ type: 'card_purchase', amount: price, cardCode }],
      method: 'cash',
      batchId,
      inserted: insertedAmount,
      change: changeAmount,
      type: 'card_purchase'
    })

    // Track card purchase
    const cardPurchase = await CardPurchase.create({
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
        const hopper = await Peripheral.findOne({ type: 'hopper', enabled: true })
        
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

// Mark card as written after RFID write
router.post('/card/mark-written/:code', requireKiosk, async (req, res) => {
  const code = req.params.code
  
  try {
    const CardPurchase = (await import('../models/cardPurchase.js')).default
    
    const purchase = await CardPurchase.findOneAndUpdate(
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
    const card = await Card.findOne({ code })
    
    if (!card) {
      return res.status(404).json({ error: 'Card not found' })
    }

    // Get RFID reader and write data
    const { middleware } = await import('../index.js')
    const Peripheral = (await import('../models/peripheral.js')).default
    const rfidReader = await Peripheral.findOne({ type: 'rfid_reader', enabled: true })
    
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
      await CardPurchase.findOneAndUpdate(
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
    const rfidReader = await Peripheral.findOne({ type: 'rfid_reader', enabled: true })
    
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
  const c = await Card.findOne({ code }).lean()
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
  const s = await Setting.findOne({ key }).lean()
  if (!s) return res.status(404).json({ error: 'Setting not found' })
  res.json(s)
})

// Spending using card: deduct amount from card balance and create Sale
router.post('/cards/:code/spend', requireKiosk, async (req, res) => {
  const code = req.params.code
  const { machineId, amount, items, method, batchId } = req.body
  if (!code || amount == null) return res.status(400).json({ error: 'Missing parameters' })
  const Card = (await import('../models/card.js')).default
  const card = await Card.findOne({ code })
  if (!card) return res.status(404).json({ error: 'Card not found' })

  if (method && String(method) !== 'card') return res.status(400).json({ error: 'Card spending must use method "card"' })

  const price = Number(amount)
  if ((card.balance || 0) < price) return res.status(400).json({ error: 'Insufficient balance' })

  card.balance = Number((card.balance || 0) - price)
  await card.save()

  // Prevent occupying a machine that is already working
  if (machineId) {
    const m = await Machine.findById(machineId)
    if (m && m.status === 'working') return res.status(409).json({ error: 'Machine already in use' })
  }

  const sale = await Sale.create({ machineId, amount: price, items, method: 'card', batchId, type: 'payment', cardId: card._id, cardCode: card.code })

  // Update machine state if relevant
  if (machineId) {
    await Machine.findByIdAndUpdate(machineId, { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } })
    const updated = await Machine.findById(machineId)
    try { await broadcastMachine(updated) } catch (e) { console.error('[pos] broadcastMachine error', e) }
    return res.json({ sale, machine: updated, card })
  }

  res.json({ sale, card })
})

export default router

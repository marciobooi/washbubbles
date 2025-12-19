import express from 'express'
import Machine from '../models/machine.js'
import Sale from '../models/sale.js'
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
  const { machineId, amount, items, method, inserted, change, type, cardCode, cardId } = req.body
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
  const sale = await Sale.create({ machineId, amount: Number(amount), items, method, inserted: insertedNum, change: changeNum, type: type || 'payment', cardId: card ? card._id : undefined, cardCode: card ? card.code : (cardCode || undefined) })

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
  const { amount, items, method, inserted, change, cardCode, cardId } = req.body
  if (amount == null) return res.status(400).json({ error: 'Missing amount' })

  // Recharges are always card-based in this system
  if (method && String(method) !== 'card') return res.status(400).json({ error: 'Recharges must be performed with method "card"' })

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
      card.balance = Number((card.balance || 0) + Number(amount))
      await card.save()
    }
  }

  const sale = await Sale.create({ amount: Number(amount), items, method: method || 'card', inserted: Number(inserted || amount), change: Number(change || 0), type: 'recharge', cardId: card ? card._id : undefined, cardCode: card ? card.code : (cardCode || undefined) })
  res.json({ sale, card })
})

// Public: lookup card by code (kiosk will use this to show balance)
router.get('/cards/:code', requireKiosk, async (req, res) => {
  const code = req.params.code
  const Card = (await import('../models/card.js')).default
  const c = await Card.findOne({ code }).lean()
  if (!c) return res.status(404).json({ error: 'Card not found' })
  res.json(c)
})

// Spending using card: deduct amount from card balance and create Sale
router.post('/cards/:code/spend', requireKiosk, async (req, res) => {
  const code = req.params.code
  const { machineId, amount, items, method } = req.body
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

  const sale = await Sale.create({ machineId, amount: price, items, method: method || 'card', type: 'payment', cardId: card._id, cardCode: card.code })

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

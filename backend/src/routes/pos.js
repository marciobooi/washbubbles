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
  const { machineId, amount, items, method, inserted, change, type } = req.body
  if (!machineId || amount == null || !items) return res.status(400).json({ error: 'Missing parameters' })

  // Ensure machine exists
  const machine = await Machine.findById(machineId)
  if (!machine) return res.status(404).json({ error: 'Machine not found' })

  // Compute inserted/change defaults and create sale
  const insertedNum = Number(inserted || 0)
  const changeNum = (change != null) ? Number(change) : Math.max(0, insertedNum - Number(amount || 0))
  const sale = await Sale.create({ machineId, amount: Number(amount), items, method, inserted: insertedNum, change: changeNum, type: type || 'payment' })

  // Update machine: increment cycle and mark as occupied after successful payment
  await Machine.findByIdAndUpdate(machineId, { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } })

  const updated = await Machine.findById(machineId)
  // broadcast single updated machine so clients refresh quickly
  try { await broadcastMachine(updated) } catch (e) { console.error('[pos] broadcastMachine error', e) }

  res.json({ sale, machine: updated })
})

// Card recharge / top-up (kiosk) — stored as a transaction without a machine reference
router.post('/recharge', requireKiosk, async (req, res) => {
  const { amount, items, method, inserted, change } = req.body
  if (amount == null) return res.status(400).json({ error: 'Missing amount' })
  const sale = await Sale.create({ amount: Number(amount), items, method: method || 'card', inserted: Number(inserted || amount), change: Number(change || 0), type: 'recharge' })
  res.json({ sale })
})

export default router

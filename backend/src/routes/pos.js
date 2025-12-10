import express from 'express'
import Machine from '../models/machine.js'
import Sale from '../models/sale.js'
import { requireKiosk } from '../middleware/auth.js'

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

router.post('/sale', requireKiosk, async (req, res) => {
  const { machineId, amount, items } = req.body
  if (!machineId || !amount || !items) return res.status(400).json({ error: 'Missing parameters' })

  const sale = await Sale.create({ machineId, amount: Number(amount), items })

  // Optionally update machine cycle or status
  await Machine.findByIdAndUpdate(machineId, { $inc: { cycle: 1 } })

  res.json(sale)
})

export default router

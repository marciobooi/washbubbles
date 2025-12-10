import express from 'express'
import { requireAdmin } from '../middleware/auth.js'
import Machine from '../models/machine.js'

const router = express.Router()

// All admin routes require admin JWT
router.use(requireAdmin)

// list machines
router.get('/machines', async (req, res) => {
  const machines = await Machine.find().sort({ createdAt: -1 })
  res.json(machines)
})

// create machine
router.post('/machines', async (req, res) => {
  const { name, status } = req.body
  if (!name) return res.status(400).json({ error: 'Missing name' })
  const machine = await Machine.create({ name, status })
  res.json(machine)
})

export default router

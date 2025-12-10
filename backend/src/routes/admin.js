import express from 'express'
import { requireAdmin } from '../middleware/auth.js'
import Machine from '../models/machine.js'
import User from '../models/user.js'
import crypto from 'crypto'

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

// List users (admin only)
router.get('/users', async (req, res) => {
  const users = await User.find().select('email role apiKey createdAt').lean()
  // mask apiKey
  const masked = users.map((u) => ({ _id: u._id, email: u.email, role: u.role, apiKey: u.apiKey ? u.apiKey.slice(0, 8) + '…' : null, createdAt: u.createdAt }))
  res.json(masked)
})

// Rotate API key for user
router.post('/users/:id/rotate', async (req, res) => {
  const id = req.params.id
  const newKey = crypto.randomBytes(24).toString('hex')
  const user = await User.findByIdAndUpdate(id, { apiKey: newKey }, { new: true })
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ _id: user._id, apiKey: newKey })
})

export default router

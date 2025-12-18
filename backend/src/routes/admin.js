import express from 'express'
import { requireAdmin } from '../middleware/auth.js'
import Machine from '../models/machine.js'
import User from '../models/user.js'
import Sale from '../models/sale.js'
import Setting from '../models/setting.js'
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
  const { name, status, statusText, weight, price, loyaltyPrice, type, icon } = req.body
  if (!name) return res.status(400).json({ error: 'Missing name' })
  if (type && !['wash', 'dry'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  const finalIcon = icon || (type === 'dry' ? '/drymachine/S1.png' : '/washingmashine/L1.png')
  const machine = await Machine.create({ name, status, statusText, weight, price, loyaltyPrice: loyaltyPrice || 0, type: type || 'wash', icon: finalIcon })
  res.json(machine)
})

// List users (admin only)
router.get('/users', async (req, res) => {
  const users = await User.find().select('username role apiKey createdAt').lean()
  // mask apiKey
  const masked = users.map((u) => ({ _id: u._id, username: u.username, role: u.role, apiKey: u.apiKey ? u.apiKey.slice(0, 8) + '…' : null, createdAt: u.createdAt }))
  res.json(masked)
})

// Create user (admin) - simple create without password (recommended to use /auth/register for full flow)
router.post('/users', async (req, res) => {
  const { username, role } = req.body
  if (!username) return res.status(400).json({ error: 'Missing username' })
  const user = await User.create({ username, role: role || 'user' })
  res.json({ _id: user._id, username: user.username, role: user.role })
})

// Rotate API key for user
router.post('/users/:id/rotate', async (req, res) => {
  const id = req.params.id
  const newKey = crypto.randomBytes(24).toString('hex')
  const user = await User.findByIdAndUpdate(id, { apiKey: newKey }, { new: true })
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ _id: user._id, apiKey: newKey })
})

// Admin search endpoint: search users and machines by query (admin only)
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim()
  if (!q || q.length < 1) return res.json({ users: [], machines: [] })
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const users = await User.find({ username: regex }).limit(10).select('username role createdAt').lean()
  const machines = await Machine.find({ name: regex }).limit(10).lean()
  res.json({ users, machines })
})

// Get single machine
router.get('/machines/:id', async (req, res) => {
  const m = await Machine.findById(req.params.id).lean()
  if (!m) return res.status(404).json({ error: 'Machine not found' })
  res.json(m)
})

// Update machine
router.put('/machines/:id', async (req, res) => {
  const { name, status, statusText, weight, price, loyaltyPrice, type, icon } = req.body
  if (type && !['wash', 'dry'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  const finalIcon = icon || (type === 'dry' ? '/drymachine/S1.png' : '/washingmashine/L1.png')
  const m = await Machine.findByIdAndUpdate(req.params.id, { name, status, statusText, weight, price, loyaltyPrice: loyaltyPrice || 0, type, icon: finalIcon }, { new: true })
  if (!m) return res.status(404).json({ error: 'Machine not found' })
  res.json(m)
})

// Delete machine
router.delete('/machines/:id', async (req, res) => {
  await Machine.findByIdAndDelete(req.params.id)
  res.json({ success: true })
})

// User CRUD
router.get('/users/:id', async (req, res) => {
  const u = await User.findById(req.params.id).select('username role apiKey createdAt').lean()
  if (!u) return res.status(404).json({ error: 'User not found' })
  u.apiKey = u.apiKey ? u.apiKey.slice(0, 8) + '…' : null
  res.json(u)
})

router.put('/users/:id', async (req, res) => {
  const { username, role } = req.body
  const u = await User.findByIdAndUpdate(req.params.id, { username, role }, { new: true }).select('username role apiKey createdAt')
  if (!u) return res.status(404).json({ error: 'User not found' })
  u.apiKey = u.apiKey ? u.apiKey.slice(0, 8) + '…' : null
  res.json(u)
})

router.delete('/users/:id', async (req, res) => {
  await User.findByIdAndDelete(req.params.id)
  res.json({ success: true })
})

// Transactions (Sales)
router.get('/transactions', async (req, res) => {
  const tx = await Sale.find().populate('machineId').sort({ createdAt: -1 }).limit(200).lean()
  res.json(tx)
})

router.get('/transactions/:id', async (req, res) => {
  const t = await Sale.findById(req.params.id).populate('machineId').lean()
  if (!t) return res.status(404).json({ error: 'Transaction not found' })
  res.json(t)
})

router.post('/transactions', async (req, res) => {
  const { machineId, amount, items } = req.body
  if (!machineId || !amount) return res.status(400).json({ error: 'Missing fields' })
  const s = await Sale.create({ machineId, amount, items })
  res.json(s)
})

router.delete('/transactions/:id', async (req, res) => {
  await Sale.findByIdAndDelete(req.params.id)
  res.json({ success: true })
})

// Settings (simple key/value store)
router.get('/settings', async (req, res) => {
  const list = await Setting.find().lean()
  res.json(list)
})

router.get('/settings/:key', async (req, res) => {
  const s = await Setting.findOne({ key: req.params.key }).lean()
  if (!s) return res.status(404).json({ error: 'Setting not found' })
  res.json(s)
})

router.post('/settings', async (req, res) => {
  const { key, value } = req.body
  if (!key) return res.status(400).json({ error: 'Missing key' })
  const s = await Setting.findOneAndUpdate({ key }, { value }, { upsert: true, new: true })
  res.json(s)
})

router.delete('/settings/:key', async (req, res) => {
  await Setting.findOneAndDelete({ key: req.params.key })
  res.json({ success: true })
})

export default router

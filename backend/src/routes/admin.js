import express from 'express'
import mongoose from 'mongoose'
import { requireAdmin, requireSuperAdmin, requireStaffRead, requireAnyStaff, requireTechnician } from '../middleware/auth.js'
import MaintenanceTicket from '../models/maintenanceTicket.js'
import Coupon from '../models/coupon.js'
import { sendMail } from '../services/mailer.js'
import Machine from '../models/machine.js'
import User from '../models/user.js'
import Sale from '../models/sale.js'
import Setting from '../models/setting.js'
import Interface from '../models/interface.js'
import Price from '../models/price.js'
import Peripheral from '../models/peripheral.js'
import { withTenant } from '../services/tenant.js'
import { resetSoleTenantCache } from '../middleware/tenant.js'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import sharp from 'sharp'
import Card from '../models/card.js'
import SyncCommand from '../models/syncCommand.js'
import DayClose from '../models/dayClose.js'
import { broadcastMachines, broadcastMachine, listClients, disconnectClient } from '../wsServer.js'
import { logAction } from '../services/auditLog.js'
import { creditCard } from '../services/cardBalance.js'
import AuditLog from '../models/auditLog.js'

const router = express.Router()

// Any dashboard role (ADMIN/SUPERADMIN/STAFF/TECHNICIAN) can reach this
// router at all; individual routes narrow further with requireAdmin,
// requireStaffRead or requireTechnician below.
router.use(requireAnyStaff)

// list machines
router.get('/machines', async (req, res) => {
  const MachineT = withTenant(Machine, req)
  const machines = await MachineT.find().populate('interfaceId', 'name address').sort({ createdAt: -1 })
  res.json(machines)
})

// create machine
router.post('/machines', requireAdmin, async (req, res) => {
  const { name, number, brand, model, serialNumber, status, statusText, weight, type, icon, interfaceId, port, activation, tImp } = req.body
  if (!name) return res.status(400).json({ error: 'Missing name' })
  if (type && !['wash', 'dry'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  if (activation && !['high', 'low'].includes(activation)) return res.status(400).json({ error: 'Invalid activation' })
  
  // Check if interface+port combo is already in use
  if (interfaceId && port) {
    const existing = await withTenant(Machine, req).findOne({ interfaceId, port })
    if (existing) {
      return res.status(400).json({ error: `Porto ${port} desta interface já está em uso pela máquina "${existing.name}"` })
    }
  }
  
  const finalIcon = icon || (type === 'dry' ? '/drymachine/S1.png' : '/washingmashine/L1.png')
  const MachineT = withTenant(Machine, req)
  const machine = await MachineT.create({
    name, number, brand, model, serialNumber,
    status, statusText,
    weight: weight || 0,
    type: type || 'wash',
    icon: finalIcon,
    interfaceId: interfaceId || null,
    port: port || null,
    activation: activation || 'high',
    tImp: type === 'dry' && tImp != null ? Number(tImp) : null
  })
  // new machine created — broadcast full list so clients get the new item
  try { await broadcastMachines() } catch (e) { console.error('[admin] broadcastMachines error', e) }
  logAction(req, 'machine.create', 'Machine', machine._id, { name: machine.name })
  res.json(machine)
})

// List users (admin only)
router.get('/users', requireAdmin, async (req, res) => {
  const UserT = withTenant(User, req)
  const users = await UserT.find().select('username role apiKey createdAt').lean()
  // mask apiKey
  const masked = users.map((u) => ({ _id: u._id, username: u.username, role: u.role, apiKey: u.apiKey ? u.apiKey.slice(0, 8) + '…' : null, createdAt: u.createdAt }))
  res.json(masked)
})

// Create user (admin) - accepts an optional `password` field so admins can set credentials directly
router.post('/users', requireAdmin, async (req, res) => {
  const { username, role, password } = req.body
  if (!username) return res.status(400).json({ error: 'Missing username' })

  // If password is provided, hash it; otherwise generate a random password (and return it)
  let hash
  let temp
  if (password) {
    hash = await bcrypt.hash(password, 10)
  } else {
    // generate a secure random temporary password and hash it
    temp = crypto.randomBytes(8).toString('hex')
    hash = await bcrypt.hash(temp, 10)
  }

  const apiKey = role === 'KIOSK' ? crypto.randomBytes(24).toString('hex') : undefined
  const UserT = withTenant(User, req)
  const user = await UserT.create({ username, role: role || 'user', password: hash, apiKey })

  // Create tenant membership (owner/admin) for created user within this tenant
  try {
    const TenantUser = (await import('../models/tenantUser.js')).default
    await TenantUser.updateOne({ tenantId: req.tenantId, userId: user._id }, { $setOnInsert: { tenantId: req.tenantId, userId: user._id, role: role === 'ADMIN' ? 'ADMIN' : 'MEMBER' } }, { upsert: true })
  } catch (e) { /* ignore membership errors */ }

  const resp = { _id: user._id, username: user.username, role: user.role }
  // If admin provided a password, do not echo it back. If we generated one because admin didn't provide it, return the temp password so admin can share it.
  if (!password && user) resp.tempPassword = temp

  logAction(req, 'user.create', 'User', user._id, { username: user.username, role: user.role })
  res.json(resp)
})

// Rotate API key for user
router.post('/users/:id/rotate', requireAdmin, async (req, res) => {
  const id = req.params.id
  const newKey = crypto.randomBytes(24).toString('hex')
  const UserT = withTenant(User, req)
  const user = await UserT.findByIdAndUpdate(id, { apiKey: newKey }, { new: true })
  if (!user) return res.status(404).json({ error: 'User not found' })
  logAction(req, 'user.rotate_key', 'User', user._id, { username: user.username })
  res.json({ _id: user._id, apiKey: newKey })
})

// Admin search endpoint: search users and machines by query (admin only)
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim()
  if (!q || q.length < 1) return res.json({ users: [], machines: [] })
  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const UserT = withTenant(User, req)
  const MachineT = withTenant(Machine, req)
  const users = await UserT.find({ username: regex }).limit(10).select('username role createdAt').lean()
  const machines = await MachineT.find({ name: regex }).limit(10).lean()
  res.json({ users, machines })
})

// Get single machine
router.get('/machines/:id', async (req, res) => {
  const MachineT = withTenant(Machine, req)
  const m = await MachineT.findById(req.params.id).lean()
  if (!m) return res.status(404).json({ error: 'Machine not found' })
  res.json(m)
})

// Update machine
router.put('/machines/:id', requireAdmin, async (req, res) => {
  const { name, number, brand, model, serialNumber, status, statusText, weight, type, icon, interfaceId, port, activation, tImp } = req.body
  if (type && !['wash', 'dry'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  if (activation && !['high', 'low'].includes(activation)) return res.status(400).json({ error: 'Invalid activation' })
  
  // Check if interface+port combo is already in use by another machine
  if (interfaceId && port) {
    const existing = await withTenant(Machine, req).findOne({ interfaceId, port, _id: { $ne: req.params.id } })
    if (existing) {
      return res.status(400).json({ error: `Porto ${port} desta interface já está em uso pela máquina "${existing.name}"` })
    }
  }
  
  const finalIcon = icon || (type === 'dry' ? '/drymachine/S1.png' : '/washingmashine/L1.png')
  const MachineT = withTenant(Machine, req)
  const m = await MachineT.findByIdAndUpdate(req.params.id, {
    name, number, brand, model, serialNumber,
    status, statusText,
    weight: weight || 0,
    type, icon: finalIcon,
    interfaceId: interfaceId || null,
    port: port || null,
    activation: activation || 'high',
    tImp: type === 'dry' && tImp != null ? Number(tImp) : null
  }, { new: true })
  if (!m) return res.status(404).json({ error: 'Machine not found' })
  // broadcast single updated machine to clients (more efficient)
  try { await broadcastMachine(m) } catch (e) { console.error('[admin] broadcastMachine error', e) }
  logAction(req, 'machine.update', 'Machine', m._id, { name: m.name })
  res.json(m)
})

// Delete machine
router.delete('/machines/:id', requireAdmin, async (req, res) => {
  const MachineT = withTenant(Machine, req)
  const m = await MachineT.findByIdAndDelete(req.params.id)
  // broadcast updated machine list
  try { await broadcastMachines() } catch (e) { console.error('[admin] broadcastMachines error', e) }
  logAction(req, 'machine.delete', 'Machine', req.params.id, { name: m?.name })
  res.json({ success: true })
})

// POST /admin/machines/:id/service — logs a manual maintenance visit and
// resolves the machine's open ticket, if any.
router.post('/machines/:id/service', requireTechnician, async (req, res) => {
  const MachineT = withTenant(Machine, req)
  const machine = await MachineT.findByIdAndUpdate(req.params.id, { lastServicedAt: new Date() }, { new: true })
  if (!machine) return res.status(404).json({ error: 'Machine not found' })

  const TicketT = withTenant(MaintenanceTicket, req)
  await TicketT.updateMany(
    { machineId: machine._id, status: 'open' },
    { status: 'resolved', resolvedBy: req.userModel._id, resolvedAt: new Date() }
  )

  logAction(req, 'machine.service_logged', 'Machine', machine._id, { name: machine.name })
  res.json(machine)
})

// =====================
// 🔧 MAINTENANCE TICKETS
// =====================

router.get('/maintenance', requireTechnician, async (req, res) => {
  const { status } = req.query
  const TicketT = withTenant(MaintenanceTicket, req)
  const query = status ? { status } : { status: 'open' }
  const list = await TicketT.find(query).populate('machineId', 'name number').sort({ createdAt: -1 }).lean()
  res.json(list)
})

router.put('/maintenance/:id', requireTechnician, async (req, res) => {
  const TicketT = withTenant(MaintenanceTicket, req)
  const ticket = await TicketT.findByIdAndUpdate(req.params.id, {
    status: 'resolved',
    resolvedBy: req.userModel._id,
    resolvedAt: new Date()
  }, { new: true })
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
  logAction(req, 'maintenance.resolve', 'MaintenanceTicket', ticket._id, { machineId: ticket.machineId })
  res.json(ticket)
})

// User CRUD
//
// These MUST go through withTenant. With bare `User.findByIdAndUpdate` a tenant-A
// admin could PUT any superadmin's id with a new password and role and take over
// the whole platform from one low-value account.
const ASSIGNABLE_ROLES = ['USER', 'KIOSK', 'ADMIN', 'STAFF', 'TECHNICIAN']

router.get('/users/:id', requireAdmin, async (req, res) => {
  const UserT = withTenant(User, req)
  const u = await UserT.findById(req.params.id).select('username role apiKey createdAt').lean()
  if (!u) return res.status(404).json({ error: 'User not found' })
  u.apiKey = u.apiKey ? u.apiKey.slice(0, 8) + '…' : null
  res.json(u)
})

router.put('/users/:id', requireAdmin, async (req, res) => {
  const { username, role, password } = req.body
  const update = {}
  if (username) update.username = username
  if (role !== undefined) {
    // A tenant admin must not be able to mint a SUPERADMIN; only a superadmin can.
    const allowed = req.userModel?.role === 'SUPERADMIN' ? [...ASSIGNABLE_ROLES, 'SUPERADMIN'] : ASSIGNABLE_ROLES
    if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role' })
    update.role = role
  }
  if (password) {
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' })
    }
    update.password = await bcrypt.hash(password, 10)
  }
  const UserT = withTenant(User, req)
  const u = await UserT.findByIdAndUpdate(req.params.id, update, { new: true }).select('username role apiKey createdAt')
  if (!u) return res.status(404).json({ error: 'User not found' })
  u.apiKey = u.apiKey ? u.apiKey.slice(0, 8) + '…' : null
  logAction(req, role !== undefined ? 'user.role_change' : 'user.update', 'User', u._id, { username: u.username, role: u.role })
  res.json(u)
})

router.delete('/users/:id', requireAdmin, async (req, res) => {
  const UserT = withTenant(User, req)
  // Refuse to delete yourself — an admin locking themselves out of their own
  // tenant needs a superadmin to recover it.
  if (String(req.userModel?._id) === String(req.params.id)) {
    return res.status(400).json({ error: 'You cannot delete your own account' })
  }
  const u = await UserT.findByIdAndDelete(req.params.id)
  if (!u) return res.status(404).json({ error: 'User not found' })
  logAction(req, 'user.delete', 'User', req.params.id, { username: u.username })
  res.json({ success: true })
})

// Transactions (Sales)
router.get('/transactions', requireStaffRead, async (req, res) => {
  const SaleT = withTenant(Sale, req)
  const tx = await SaleT.find().populate('machineId').populate('cardId').sort({ createdAt: -1 }).limit(200).lean()
  res.json(tx)
})

// GET /admin/transactions/export.csv?from=&to=&type= — no row cap (unlike the
// list route above), used for accounting exports. Hand-built CSV: the shape
// is simple enough that a library would be pure overhead.
function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

router.get('/transactions/export.csv', requireStaffRead, async (req, res) => {
  const { from, to, type } = req.query
  const query = {}
  if (type) query.type = type
  if (from || to) {
    query.createdAt = {}
    if (from) query.createdAt.$gte = new Date(from)
    if (to) query.createdAt.$lte = new Date(to)
  }
  const SaleT = withTenant(Sale, req)
  const rows = await SaleT.find(query).populate('machineId').populate('cardId').sort({ createdAt: -1 }).lean()

  const header = ['Data', 'Tipo', 'Método', 'Máquina', 'Cartão', 'Valor', 'Estado']
  const lines = [header.map(csvCell).join(',')]
  for (const t of rows) {
    lines.push([
      new Date(t.createdAt).toISOString(),
      t.type,
      t.method || '',
      t.machineId?.name || '',
      t.cardCode || '',
      Number(t.amount).toFixed(2),
      t.status || 'completed'
    ].map(csvCell).join(','))
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.send(lines.join('\n'))
})

router.get('/transactions/:id', requireStaffRead, async (req, res) => {
  const SaleT = withTenant(Sale, req)
  const t = await SaleT.findById(req.params.id).populate('machineId').populate('cardId').lean()
  if (!t) return res.status(404).json({ error: 'Transaction not found' })
  res.json(t)
})

// POST /admin/transactions/:id/refund — reverses a sale as a real accounting
// operation instead of the old hard-delete. See services/cardBalance.js for
// the atomic credit-back and services/dayClose.js for why the reversal is a
// brand-new Sale row rather than a mutation of a possibly-already-closed one.
router.post('/transactions/:id/refund', requireAdmin, async (req, res) => {
  const reason = String(req.body?.reason || '').trim()
  if (!reason) return res.status(400).json({ error: 'A refund reason is required' })

  const SaleT = withTenant(Sale, req)
  const sale = await SaleT.findById(req.params.id)
  if (!sale) return res.status(404).json({ error: 'Transaction not found' })
  if (sale.type === 'refund') return res.status(400).json({ error: 'Cannot refund a refund' })
  if (sale.status === 'refunded') return res.status(400).json({ error: 'Transaction already refunded' })

  if (sale.cardId) {
    const CardT = withTenant(Card, req)
    // No status guard on creditCard — this must succeed even onto a blocked card.
    await creditCard(CardT, { _id: sale.cardId }, sale.amount)
  }

  const refund = await SaleT.create({
    machineId: sale.machineId || null,
    amount: -sale.amount,
    type: 'refund',
    method: sale.method,
    batchId: `refund-${sale._id}`,
    cardId: sale.cardId || null,
    cardCode: sale.cardCode || null,
    refundOf: sale._id,
    refundReason: reason
    // dayCloseId intentionally left null — it rolls into the next open
    // period the same way every other sale does (services/dayClose.js:141),
    // rather than retroactively touching a closed report's frozen totals.
  })

  sale.status = 'refunded'
  await sale.save()

  logAction(req, 'transaction.refund', 'Sale', sale._id, { amount: sale.amount, reason, refundId: refund._id })
  res.json({ success: true, refund })
})

// Loyalty Cards (admin)
router.get('/cards', requireStaffRead, async (req, res) => {
  const CardT = withTenant(Card, req)
  const list = await CardT.find().sort({ createdAt: -1 }).lean()
  res.json(list)
})

router.get('/cards/:id', requireStaffRead, async (req, res) => {
  const CardT = withTenant(Card, req)
  const c = await CardT.findById(req.params.id).lean()
  if (!c) return res.status(404).json({ error: 'Card not found' })
  res.json(c)
})

router.post('/cards', requireAdmin, async (req, res) => {
  const { code, balance = 0, metadata } = req.body
  if (!code) return res.status(400).json({ error: 'Missing code' })
  const CardT = withTenant(Card, req)
  const existing = await CardT.findOne({ code })
  if (existing) return res.status(400).json({ error: 'Card already exists' })
  const c = await CardT.create({ code, balance: Number(balance || 0), metadata })
  logAction(req, 'card.create', 'Card', c._id, { code: c.code, balance: c.balance })
  res.json(c)
})

router.put('/cards/:id', requireAdmin, async (req, res) => {
  const { balance, metadata } = req.body
  const CardT = withTenant(Card, req)
  const before = await CardT.findById(req.params.id).lean()
  const c = await CardT.findByIdAndUpdate(req.params.id, { balance: balance == null ? undefined : Number(balance), metadata }, { new: true })
  if (!c) return res.status(404).json({ error: 'Card not found' })
  // This path bypasses cardBalance.js's atomic $inc entirely — a direct
  // overwrite, not a delta — so it's the one most worth flagging clearly.
  logAction(req, 'card.balance_override', 'Card', c._id, { code: c.code, before: before?.balance, after: c.balance })
  res.json(c)
})

// GET /admin/cards/:id/history — Full audit trail for a card
router.get('/cards/:id/history', requireStaffRead, async (req, res) => {
  const SaleT = withTenant(Sale, req)
  const history = await SaleT.find({ cardId: req.params.id }).sort({ createdAt: -1 }).lean()
  res.json(history)
})

router.post('/transactions', requireAdmin, async (req, res) => {
  const { machineId, amount, items, type, method, inserted, change } = req.body
  // Allow admin_start transactions with no amount (defaults to 0)
  if (!machineId && type !== 'recharge') return res.status(400).json({ error: 'Missing machineId or invalid type' })
  // For admin_start, allow amount to be omitted and default to 0
  const finalAmount = (amount == null && type === 'admin_start') ? 0 : Number(amount)
  if (finalAmount == null || Number.isNaN(finalAmount)) return res.status(400).json({ error: 'Invalid amount' })
  const SaleT = withTenant(Sale, req)
  const s = await SaleT.create({ machineId, amount: finalAmount, items, type: type || 'payment', method, inserted: Number(inserted || 0), change: Number(change || 0) })
  logAction(req, 'transaction.create', 'Sale', s._id, { amount: finalAmount, type: s.type })
  res.json(s)
})

// Settings (simple key/value store)
router.get('/settings', requireAdmin, async (req, res) => {
  const SettingT = withTenant(Setting, req)
  const list = await SettingT.find().lean()
  res.json(list)
})

// WebSocket client diagnostics (admin only)
router.get('/ws/clients', requireAdmin, async (req, res) => {
  const clients = listClients()
  res.json(clients)
})

router.post('/ws/clients/disconnect', requireAdmin, async (req, res) => {
  const { id } = req.body
  if (!id) return res.status(400).json({ error: 'Missing id' })
  const ok = disconnectClient(id)
  if (!ok) return res.status(404).json({ error: 'Client not found' })
  res.json({ success: true })
})

router.get('/settings/:key', requireAdmin, async (req, res) => {
  const SettingT = withTenant(Setting, req)
  const s = await SettingT.findOne({ key: req.params.key }).lean()
  // Unconfigured is a normal answer, not a 404 — see the matching note on
  // the public /pos/settings/:key route. Every caller already reads
  // `.value`, so this is a drop-in replacement.
  res.json(s || { key: req.params.key, value: null })
})

router.post('/settings', requireAdmin, async (req, res) => {
  const { key, value } = req.body
  if (!key) return res.status(400).json({ error: 'Missing key' })
  const SettingT = withTenant(Setting, req)
  const s = await SettingT.findOneAndUpdate({ key }, { value }, { upsert: true, new: true })
  logAction(req, 'setting.update', 'Setting', key, { value })
  res.json(s)
})

// Upload a logo file and persist the public URL as `branding.logo`
const uploadDirs = [
  path.resolve(process.cwd(), '../public/uploads'),
  path.resolve(process.cwd(), 'public/uploads'),
  path.resolve(process.cwd(), '../../public/uploads'),
]
let uploadDir = null
for (const d of uploadDirs) {
  try {
    fs.mkdirSync(d, { recursive: true })
    uploadDir = d
    break
  } catch (e) {
    // continue
  }
}
if (!uploadDir) uploadDir = uploadDirs[0]

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g,'_')}`),
})

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'))
    }
    cb(null, true)
  }
})

router.post('/settings/logo', requireAdmin, (req, res) => {
  upload.single('logo')(req, res, async function (err) {
    if (err) {
      console.error('Multer error', err)
      return res.status(400).json({ error: err.message })
    }

    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

      const origPath = req.file.path
      const ext = path.extname(req.file.filename).toLowerCase() || '.jpg'
      const base = path.basename(req.file.filename, ext)
      const outName = `${base}-resized${ext}`
      const outPath = path.join(uploadDir, outName)

      // Resize, keep orientation and constrain to 800x800
      await sharp(origPath).rotate().resize({ width: 800, height: 800, fit: 'inside' }).toFile(outPath)

      // If resized file differs, remove original
      if (outPath !== origPath) {
        try { fs.unlinkSync(origPath) } catch (e) { /* ignore */ }
      }

          const url = `/uploads/${outName}`
          const SettingT = withTenant(Setting, req)
          const s = await SettingT.findOneAndUpdate({ key: 'branding.logo' }, { value: url }, { upsert: true, new: true })
          res.json({ url, setting: s })
    } catch (e) {
      // cleanup any uploaded file
      try { if (req.file && req.file.path) fs.unlinkSync(req.file.path) } catch (err) { /* ignore */ }
      console.error('Logo upload error', e)
      res.status(400).json({ error: e && e.message ? e.message : 'Failed to process upload' })
    }
  })
})

// POST /admin/settings/banner-image — same upload pipeline as the logo above,
// sized for a wide carousel banner instead of a square logo. Unlike the logo
// route this doesn't write any Setting itself: a banner image belongs to one
// entry in the `banners` array, not a single key, so the admin UI uploads
// the file first, gets a URL back, and saves the whole array afterward.
router.post('/settings/banner-image', requireAdmin, (req, res) => {
  upload.single('image')(req, res, async function (err) {
    if (err) {
      console.error('Multer error', err)
      return res.status(400).json({ error: err.message })
    }

    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

      const origPath = req.file.path
      const ext = path.extname(req.file.filename).toLowerCase() || '.jpg'
      const base = path.basename(req.file.filename, ext)
      const outName = `${base}-resized${ext}`
      const outPath = path.join(uploadDir, outName)

      // Wide format, matching the banner's own aspect ratio — a logo's
      // 800x800 square would just get cropped weirdly here.
      await sharp(origPath).rotate().resize({ width: 1600, height: 640, fit: 'cover' }).toFile(outPath)

      if (outPath !== origPath) {
        try { fs.unlinkSync(origPath) } catch (e) { /* ignore */ }
      }

      const url = `/uploads/${outName}`
      logAction(req, 'setting.banner_image_upload', 'Setting', 'banners', { url })
      res.json({ url })
    } catch (e) {
      try { if (req.file && req.file.path) fs.unlinkSync(req.file.path) } catch (err) { /* ignore */ }
      console.error('Banner image upload error', e)
      res.status(400).json({ error: e && e.message ? e.message : 'Failed to process upload' })
    }
  })
})

router.delete('/settings/:key', requireAdmin, async (req, res) => {
  await withTenant(Setting, req).findOneAndDelete({ key: req.params.key })
  logAction(req, 'setting.delete', 'Setting', req.params.key)
  res.json({ success: true })
})

// =====================
// Interfaces CRUD
// =====================

// List all interfaces
router.get('/interfaces', async (req, res) => {
  const InterfaceT = withTenant(Interface, req)
  const interfaces = await InterfaceT.find().sort({ createdAt: -1 })
  res.json(interfaces)
})

// Get single interface
router.get('/interfaces/:id', async (req, res) => {
  const InterfaceT = withTenant(Interface, req)
  const iface = await InterfaceT.findById(req.params.id).lean()
  if (!iface) return res.status(404).json({ error: 'Interface not found' })
  res.json(iface)
})

// Create interface
router.post('/interfaces', requireAdmin, async (req, res) => {
  const { name, brand, model, serialNumber, address, ports, tOn, tOff, status } = req.body
  if (!name) return res.status(400).json({ error: 'Missing name' })
  if (!serialNumber) return res.status(400).json({ error: 'Missing serial number' })
  if (address == null) return res.status(400).json({ error: 'Missing address' })
  if (tOn == null) return res.status(400).json({ error: 'Missing t_on' })
  if (tOff == null) return res.status(400).json({ error: 'Missing t_off' })

  // Check for duplicate serial number
  const InterfaceT = withTenant(Interface, req)
  const existing = await InterfaceT.findOne({ serialNumber })
  if (existing) return res.status(400).json({ error: 'Serial number already exists' })
  const iface = await InterfaceT.create({
    name,
    brand: brand || '',
    model: model || '',
    serialNumber,
    address: Number(address),
    ports: ports ? Number(ports) : 2,
    tOn: Number(tOn),
    tOff: Number(tOff),
    status: status || 'inactive',
  })
  logAction(req, 'interface.create', 'Interface', iface._id, { name: iface.name })
  res.json(iface)
})

// ---------------------
// Tenant management (system-level)
// ---------------------

import Tenant from '../models/tenant.js'
import TenantUser from '../models/tenantUser.js'

// List tenants (superadmins only)
router.get('/tenants', requireSuperAdmin, async (req, res) => {
  const list = await Tenant.find().sort({ createdAt: -1 }).lean()
  res.json(list)
})

// Create tenant (superadmins only)
router.post('/tenants', requireSuperAdmin, async (req, res) => {
  const { name, slug } = req.body
  if (!name || !slug) return res.status(400).json({ error: 'Missing name or slug' })
  const existing = await Tenant.findOne({ slug })
  if (existing) return res.status(400).json({ error: 'Tenant slug already exists' })
  const t = await Tenant.create({ name, slug })
  resetSoleTenantCache()
  res.json(t)
})

// Update tenant (superadmins only)
router.put('/tenants/:id', requireSuperAdmin, async (req, res) => {
  const { name } = req.body
  const t = await Tenant.findByIdAndUpdate(req.params.id, { name }, { new: true })
  if (!t) return res.status(404).json({ error: 'Tenant not found' })
  res.json(t)
})

// Assign user to tenant (by userId) with role
// this operation may be permitted to admins as long as they themselves are
// superadmins or belong to the tenant, but for simplicity keep it superadmin-only
router.post('/tenants/:id/users', requireSuperAdmin, async (req, res) => {
  const tenantId = req.params.id
  const { userId, role } = req.body
  if (!userId) return res.status(400).json({ error: 'Missing userId' })
  const u = await User.findById(userId)
  if (!u) return res.status(404).json({ error: 'User not found' })
  const tenant = await Tenant.findById(tenantId)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' })
  const r = role || 'MEMBER'
  const membership = await TenantUser.findOneAndUpdate(
    { tenantId, userId },
    { $set: { role: r } },
    { upsert: true, new: true }
  )
  res.json({ success: true, membership })
})

// =====================
// 🪄 SETUP WIZARD (New Tenant + Admin + Kiosk)
// =====================

/**
 * POST /admin/setup/tenant-complete
 * Orchestrates the creation of a brand new environment in one go.
 */
router.post('/setup/tenant-complete', requireSuperAdmin, async (req, res) => {
  const { tenant, admin, kiosk } = req.body

  if (!tenant?.name || !tenant?.slug) return res.status(400).json({ error: 'Missing tenant info' })
  if (!admin?.username || !admin?.password) return res.status(400).json({ error: 'Missing admin info' })
  if (!kiosk?.username) return res.status(400).json({ error: 'Missing kiosk username' })

  try {
    // 1. Create Tenant
    const existing = await Tenant.findOne({ slug: tenant.slug })
    if (existing) return res.status(400).json({ error: 'Tenant slug already exists' })
    const newTenant = await Tenant.create({ name: tenant.name, slug: tenant.slug })
    resetSoleTenantCache()

    // 2. Create Admin User
    const adminHash = await bcrypt.hash(admin.password, 10)
    const adminUser = await User.create({ 
      username: admin.username, 
      password: adminHash, 
      role: 'ADMIN',
      tenantId: newTenant._id 
    })

    // 3. Create Kiosk User (with API Key)
    const kioskApiKey = crypto.randomBytes(24).toString('hex')
    const kioskUser = await User.create({
      username: kiosk.username,
      password: await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10),
      role: 'KIOSK',
      apiKey: kioskApiKey,
      tenantId: newTenant._id
    })

    // 4. Create Tenant Membership
    const TenantUser = (await import('../models/tenantUser.js')).default
    await TenantUser.create({ tenantId: newTenant._id, userId: adminUser._id, role: 'ADMIN' })
    await TenantUser.create({ tenantId: newTenant._id, userId: kioskUser._id, role: 'KIOSK' })

    res.json({
      success: true,
      tenant: newTenant,
      admin: { id: adminUser._id, username: adminUser.username },
      kiosk: { id: kioskUser._id, username: kioskUser.username, apiKey: kioskApiKey }
    })

  } catch (err) {
    console.error('[Setup] Wizard failed:', err)
    res.status(500).json({ error: 'Setup wizard failed: ' + err.message })
  }
})

// Update interface
router.put('/interfaces/:id', requireAdmin, async (req, res) => {
  const { name, brand, model, serialNumber, address, ports, tOn, tOff, status } = req.body
  const update = {}
  if (name !== undefined) update.name = name
  if (brand !== undefined) update.brand = brand
  if (model !== undefined) update.model = model
  if (serialNumber !== undefined) update.serialNumber = serialNumber
  if (address !== undefined) update.address = Number(address)
  if (ports !== undefined) update.ports = Number(ports)
  if (tOn !== undefined) update.tOn = Number(tOn)
  if (tOff !== undefined) update.tOff = Number(tOff)
  if (status !== undefined) update.status = status

  const iface = await withTenant(Interface, req).findByIdAndUpdate(req.params.id, update, { new: true })
  if (!iface) return res.status(404).json({ error: 'Interface not found' })
  logAction(req, 'interface.update', 'Interface', iface._id, { name: iface.name })
  res.json(iface)
})

// Delete interface
router.delete('/interfaces/:id', requireAdmin, async (req, res) => {
  const iface = await withTenant(Interface, req).findByIdAndDelete(req.params.id)
  logAction(req, 'interface.delete', 'Interface', req.params.id, { name: iface?.name })
  res.json({ success: true })
})

// Toggle interface status (activate/deactivate/fault)
router.post('/interfaces/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body
  if (!['active', 'inactive', 'fault'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be active, inactive, or fault' })
  }
  const iface = await withTenant(Interface, req).findByIdAndUpdate(req.params.id, { status }, { new: true })
  if (!iface) return res.status(404).json({ error: 'Interface not found' })
  logAction(req, 'interface.status_change', 'Interface', iface._id, { status })
  res.json(iface)
})

// ==================== PRICES ====================

// List all prices
router.get('/prices', requireAdmin, async (req, res) => {
  const prices = await withTenant(Price, req).find().sort({ type: 1, weight: 1 })
  res.json(prices)
})

// Get price by type and weight (for machine lookup)
router.get('/prices/lookup', requireAdmin, async (req, res) => {
  const { type, weight } = req.query
  if (!type || !weight) return res.status(400).json({ error: 'Missing type or weight' })
  const price = await withTenant(Price, req).findOne({ type, weight: Number(weight) })
  if (!price) return res.status(404).json({ error: 'Price not found for this type/weight' })
  res.json(price)
})

// Get single price
router.get('/prices/:id', requireAdmin, async (req, res) => {
  const price = await withTenant(Price, req).findById(req.params.id)
  if (!price) return res.status(404).json({ error: 'Price not found' })
  res.json(price)
})

// Create price
router.post('/prices', requireAdmin, async (req, res) => {
  const { type, weight, duration, cashPrice, cardPrice, mobilePrice } = req.body
  if (!type || !['wash', 'dry'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  if (weight == null || weight <= 0) return res.status(400).json({ error: 'Invalid weight' })

  // Check for duplicate type+weight
  const existing = await withTenant(Price, req).findOne({ type, weight: Number(weight) })
  if (existing) return res.status(400).json({ error: `Preço para ${type} ${weight}kg já existe` })

  const price = await withTenant(Price, req).create({
    type,
    weight: Number(weight),
    duration: duration != null ? Number(duration) : null,
    cashPrice: Number(cashPrice) || 0,
    cardPrice: Number(cardPrice) || 0,
    mobilePrice: Number(mobilePrice) || 0,
  })
  logAction(req, 'price.create', 'Price', price._id, { type: price.type, weight: price.weight })
  res.json(price)
})

// Update price
router.put('/prices/:id', requireAdmin, async (req, res) => {
  const { type, weight, duration, cashPrice, cardPrice, mobilePrice } = req.body
  
  // Check if changing type+weight would conflict with existing
  if (type || weight) {
    const current = await withTenant(Price, req).findById(req.params.id)
    if (!current) return res.status(404).json({ error: 'Price not found' })
    
    const newType = type || current.type
    const newWeight = weight != null ? Number(weight) : current.weight
    
    const conflict = await withTenant(Price, req).findOne({ 
      type: newType, 
      weight: newWeight, 
      _id: { $ne: req.params.id } 
    })
    if (conflict) return res.status(400).json({ error: `Preço para ${newType} ${newWeight}kg já existe` })
  }

  const update = {}
  if (type !== undefined) update.type = type
  if (weight !== undefined) update.weight = Number(weight)
  if (duration !== undefined) update.duration = duration != null ? Number(duration) : null
  if (cashPrice !== undefined) update.cashPrice = Number(cashPrice)
  if (cardPrice !== undefined) update.cardPrice = Number(cardPrice)
  if (mobilePrice !== undefined) update.mobilePrice = Number(mobilePrice)

  const price = await withTenant(Price, req).findByIdAndUpdate(req.params.id, update, { new: true })
  if (!price) return res.status(404).json({ error: 'Price not found' })
  logAction(req, 'price.update', 'Price', price._id, { type: price.type, weight: price.weight })
  res.json(price)
})

// Delete price
router.delete('/prices/:id', requireAdmin, async (req, res) => {
  const price = await withTenant(Price, req).findByIdAndDelete(req.params.id)
  logAction(req, 'price.delete', 'Price', req.params.id, { type: price?.type, weight: price?.weight })
  res.json({ success: true })
})

// ==================== COUPONS ====================

router.get('/coupons', requireAdmin, async (req, res) => {
  const list = await withTenant(Coupon, req).find().sort({ createdAt: -1 })
  res.json(list)
})

router.post('/coupons', requireAdmin, async (req, res) => {
  const { code, discountType, discountValue, appliesTo, maxRedemptions, expiresAt, active } = req.body
  if (!code) return res.status(400).json({ error: 'Missing code' })
  if (!['percent', 'fixed'].includes(discountType)) return res.status(400).json({ error: 'Invalid discountType' })
  if (discountValue == null || Number(discountValue) <= 0) return res.status(400).json({ error: 'Invalid discountValue' })

  const CouponT = withTenant(Coupon, req)
  const existing = await CouponT.findOne({ code: String(code).toUpperCase().trim() })
  if (existing) return res.status(400).json({ error: 'Coupon code already exists' })

  const coupon = await CouponT.create({
    code: String(code).toUpperCase().trim(),
    discountType,
    discountValue: Number(discountValue),
    appliesTo: appliesTo || 'both',
    maxRedemptions: maxRedemptions == null || maxRedemptions === '' ? null : Number(maxRedemptions),
    expiresAt: expiresAt || null,
    active: active !== false
  })
  logAction(req, 'coupon.create', 'Coupon', coupon._id, { code: coupon.code })
  res.json(coupon)
})

router.put('/coupons/:id', requireAdmin, async (req, res) => {
  const { discountType, discountValue, appliesTo, maxRedemptions, expiresAt, active } = req.body
  const update = {}
  if (discountType !== undefined) update.discountType = discountType
  if (discountValue !== undefined) update.discountValue = Number(discountValue)
  if (appliesTo !== undefined) update.appliesTo = appliesTo
  if (maxRedemptions !== undefined) update.maxRedemptions = maxRedemptions === '' || maxRedemptions == null ? null : Number(maxRedemptions)
  if (expiresAt !== undefined) update.expiresAt = expiresAt || null
  if (active !== undefined) update.active = active

  const coupon = await withTenant(Coupon, req).findByIdAndUpdate(req.params.id, update, { new: true })
  if (!coupon) return res.status(404).json({ error: 'Coupon not found' })
  logAction(req, 'coupon.update', 'Coupon', coupon._id, { code: coupon.code })
  res.json(coupon)
})

router.delete('/coupons/:id', requireAdmin, async (req, res) => {
  const coupon = await withTenant(Coupon, req).findByIdAndDelete(req.params.id)
  logAction(req, 'coupon.delete', 'Coupon', req.params.id, { code: coupon?.code })
  res.json({ success: true })
})

// ==================== MARKETING ====================

// GET /admin/marketing/opt-in-count — how many customers a broadcast would reach.
router.get('/marketing/opt-in-count', requireAdmin, async (req, res) => {
  const count = await withTenant(Card, req).count({ marketingOptIn: true, email: { $nin: [null, ''] } })
  res.json({ count })
})

// POST /admin/marketing/broadcast — emails every opted-in customer with an
// email on file. Reuses mailer.js directly (same sendMail shape alerts.js
// and the receipt route already use) — no new transport.
router.post('/marketing/broadcast', requireAdmin, async (req, res) => {
  const subject = String(req.body?.subject || '').trim()
  const message = String(req.body?.message || '').trim()
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required' })

  const CardT = withTenant(Card, req)
  const recipients = await CardT.find({ marketingOptIn: true, email: { $nin: [null, ''] } }).select('email').lean()

  let sent = 0
  let failed = 0
  for (const r of recipients) {
    try {
      await sendMail({ to: r.email, subject, text: message })
      sent++
    } catch (e) {
      failed++
      console.error('[Marketing] Failed to send to', r.email, e.message)
    }
  }

  logAction(req, 'marketing.broadcast', 'Card', null, { subject, sent, failed })
  res.json({ success: true, sent, failed })
})

// ===== PERIPHERALS =====

// List peripherals
router.get('/peripherals', async (req, res) => {
  const peripherals = await withTenant(Peripheral, req).find().sort({ type: 1, name: 1 })
  res.json(peripherals)
})

// Create peripheral
router.post('/peripherals', requireAdmin, async (req, res) => {
  const { name, type, enabled, protocol, address, brand, model, serialNumber, status, image } = req.body
  if (!name || !type) return res.status(400).json({ error: 'Missing required fields' })

  const peripheral = await withTenant(Peripheral, req).create({
    name, type, enabled, protocol, address, brand, model, serialNumber, status, image
  })
  logAction(req, 'peripheral.create', 'Peripheral', peripheral._id, { name: peripheral.name, type: peripheral.type })
  res.json(peripheral)
})

// Update peripheral
router.put('/peripherals/:id', requireAdmin, async (req, res) => {
  const { name, type, enabled, protocol, address, brand, model, serialNumber, status, image } = req.body
  
  const update = {}
  if (name !== undefined) update.name = name
  if (type !== undefined) update.type = type
  if (enabled !== undefined) update.enabled = enabled
  if (protocol !== undefined) update.protocol = protocol
  if (address !== undefined) update.address = address
  if (brand !== undefined) update.brand = brand
  if (model !== undefined) update.model = model
  if (serialNumber !== undefined) update.serialNumber = serialNumber
  if (status !== undefined) update.status = status
  if (image !== undefined) update.image = image
  
  const peripheral = await withTenant(Peripheral, req).findByIdAndUpdate(req.params.id, update, { new: true })
  if (!peripheral) return res.status(404).json({ error: 'Peripheral not found' })
  logAction(req, 'peripheral.update', 'Peripheral', peripheral._id, { name: peripheral.name })
  res.json(peripheral)
})

// Delete peripheral
router.delete('/peripherals/:id', requireAdmin, async (req, res) => {
  const peripheral = await withTenant(Peripheral, req).findByIdAndDelete(req.params.id)
  logAction(req, 'peripheral.delete', 'Peripheral', req.params.id, { name: peripheral?.name })
  res.json({ success: true })
})

// =====================
// Day Close / Cash Session
// =====================

// GET /admin/day-close — list previous closes (newest first, limit 90)
router.get('/day-close', requireStaffRead, async (req, res) => {
  const DayClose = (await import('../models/dayClose.js')).default
  const DayCloseT = withTenant(DayClose, req)
  const list = await DayCloseT.find().sort({ createdAt: -1 }).limit(90).lean()
  res.json(list)
})

// GET /admin/day-close/summary — live sales totals + reconciliation data for the current open session
router.get('/day-close/summary', requireStaffRead, async (req, res) => {
  const { getDayCloseSummary } = await import('../services/dayClose.js')
  res.json(await getDayCloseSummary(req))
})

// GET /admin/day-close/:id — single record
router.get('/day-close/:id', requireStaffRead, async (req, res) => {
  const DayClose = (await import('../models/dayClose.js')).default
  const DayCloseT = withTenant(DayClose, req)
  const dc = await DayCloseT.findById(req.params.id).lean()
  if (!dc) return res.status(404).json({ error: 'Cash session record not found' })
  res.json(dc)
})

// POST /admin/day-close — close / reconcile the current cash session.
// Shared with the kiosk's own staff-mode wizard — see routes/pos.js and
// services/dayClose.js, the single implementation both call into.
router.post('/day-close', requireAdmin, async (req, res) => {
  const { createDayClose } = await import('../services/dayClose.js')
  const { status, body } = await createDayClose(req, req.body)
  res.status(status).json(body)
})

// =====================
// 📊 ANALYTICS & BUSINESS INTEL
// =====================

/**
 * GET /admin/analytics/revenue
 * Returns revenue data aggregated by day for the last 30 days
 */
router.get('/analytics/revenue', requireStaffRead, async (req, res) => {
  const SaleT = withTenant(Sale, req)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const stats = await withTenant(Sale, req).aggregate([
    { $match: { 
        tenantId: new mongoose.Types.ObjectId(req.tenantId), 
        createdAt: { $gte: thirtyDaysAgo } 
    } },
    { $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        total: { $sum: "$amount" },
        count: { $sum: 1 },
        cash: { $sum: { $cond: [{ $eq: ["$method", "cash"] }, "$amount", 0] } },
        card: { $sum: { $cond: [{ $eq: ["$method", "card"] }, "$amount", 0] } }
    } },
    { $sort: { _id: 1 } }
  ])
  res.json(stats)
})

// GET /admin/analytics/revenue.csv — same 30-day aggregate, as a download.
router.get('/analytics/revenue.csv', requireStaffRead, async (req, res) => {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const stats = await withTenant(Sale, req).aggregate([
    { $match: { tenantId: new mongoose.Types.ObjectId(req.tenantId), createdAt: { $gte: thirtyDaysAgo } } },
    { $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        total: { $sum: "$amount" },
        cash: { $sum: { $cond: [{ $eq: ["$method", "cash"] }, "$amount", 0] } },
        card: { $sum: { $cond: [{ $eq: ["$method", "card"] }, "$amount", 0] } }
    } },
    { $sort: { _id: 1 } }
  ])
  const lines = [['Data', 'Dinheiro', 'Cartão', 'Total'].map(csvCell).join(',')]
  for (const row of stats) {
    lines.push([row._id, row.cash.toFixed(2), row.card.toFixed(2), row.total.toFixed(2)].map(csvCell).join(','))
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="revenue-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.send(lines.join('\n'))
})

/**
 * GET /admin/analytics/machines
 * Returns usage stats per machine
 */
router.get('/analytics/machines', requireStaffRead, async (req, res) => {
  const SaleT = withTenant(Sale, req)
  const stats = await withTenant(Sale, req).aggregate([
    { $match: { tenantId: new mongoose.Types.ObjectId(req.tenantId), machineId: { $ne: null } } },
    { $group: {
        _id: "$machineId",
        totalRevenue: { $sum: "$amount" },
        usageCount: { $sum: 1 }
    } },
    { $lookup: {
        from: 'machines',
        localField: '_id',
        foreignField: '_id',
        as: 'machineInfo'
    } },
    { $unwind: "$machineInfo" },
    { $sort: { totalRevenue: -1 } }
  ])
  res.json(stats)
})

// =====================
// 🛰️ KIOSK FLEET & REMOTE OPS
// =====================

/**
 * GET /admin/kiosks/health
 * Returns status of all registered kiosks (online, last sync, errors)
 */
router.get('/kiosks/health', requireStaffRead, async (req, res) => {
  const UserT = withTenant(User, req)
  const kiosks = await UserT.find({ role: 'KIOSK' }).select('username apiKey lastSeen').lean()
  const wsClients = listClients()

  const health = kiosks.map(k => {
    const ws = wsClients.find(c => c.username === k.username)
    return {
      id: k._id,
      name: k.username,
      online: !!ws,
      lastSeen: k.lastSeen || null,
      ip: ws ? ws.remote : null,
      status: ws ? 'connected' : 'offline'
    }
  })
  res.json(health)
})

/**
 * POST /admin/kiosks/:id/command
 * Sends a remote maintenance command to a kiosk
 */
router.post('/kiosks/:id/command', requireAdmin, async (req, res) => {
  const { type, payload } = req.body
  if (!['reboot', 'update_config', 'upload_logs', 'screenshot', 'clear_queue', 'sync_now'].includes(type)) {
    return res.status(400).json({ error: 'Invalid command type' })
  }

  // Verify the kiosk belongs to the caller's tenant before queuing anything for
  // it. Without this, a tenant-A admin could reboot or wipe the sync queue of any
  // kiosk on the platform just by knowing its id.
  const UserT = withTenant(User, req)
  const kiosk = await UserT.findById(req.params.id)
  if (!kiosk || kiosk.role !== 'KIOSK') {
    return res.status(404).json({ error: 'Kiosk not found' })
  }

  const SyncCommandT = withTenant(SyncCommand, req)
  const cmd = await SyncCommandT.create({
    kioskId: kiosk._id,
    type,
    payload: payload || {},
    status: 'pending'
  })

  logAction(req, 'kiosk.command', 'User', kiosk._id, { type, kiosk: kiosk.username })
  res.json({ success: true, commandId: cmd._id })
})

// =====================
// 📜 AUDIT LOG
// =====================

// GET /admin/audit-log — recent admin actions, newest first.
router.get('/audit-log', requireAdmin, async (req, res) => {
  const { action } = req.query
  const AuditLogT = withTenant(AuditLog, req)
  const query = action ? { action } : {}
  const list = await AuditLogT.find(query).sort({ createdAt: -1 }).limit(200).lean()
  res.json(list)
})

// =====================
// 💬 WHATSAPP (Baileys)
// =====================

// GET /admin/whatsapp/status — connection state + a QR to scan while pairing.
// Starts the tenant's connection (if `whatsapp.enabled`) as a side effect —
// this is the endpoint the settings-page toggle polls while pairing.
router.get('/whatsapp/status', requireAdmin, async (req, res) => {
  const { getStatus } = await import('../services/whatsapp.js')
  res.json(await getStatus(req.tenantId))
})

// POST /admin/whatsapp/disconnect — logs out and clears local auth state so
// the operator can re-pair a different number.
router.post('/whatsapp/disconnect', requireAdmin, async (req, res) => {
  const { disconnect } = await import('../services/whatsapp.js')
  await disconnect(req.tenantId)
  logAction(req, 'whatsapp.disconnect', 'Tenant', req.tenantId)
  res.json({ success: true })
})

export default router

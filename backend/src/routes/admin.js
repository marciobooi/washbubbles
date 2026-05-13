import express from 'express'
import { requireAdmin, requireSuperAdmin } from '../middleware/auth.js'
import Machine from '../models/machine.js'
import User from '../models/user.js'
import Sale from '../models/sale.js'
import Setting from '../models/setting.js'
import Interface from '../models/interface.js'
import Price from '../models/price.js'
import Peripheral from '../models/peripheral.js'
import { withTenant } from '../services/tenant.js'
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

const router = express.Router()

// All admin routes require admin JWT
router.use(requireAdmin)

// list machines
router.get('/machines', async (req, res) => {
  const MachineT = withTenant(Machine, req)
  const machines = await MachineT.find().populate('interfaceId', 'name address').sort({ createdAt: -1 })
  res.json(machines)
})

// create machine
router.post('/machines', async (req, res) => {
  const { name, number, brand, model, serialNumber, status, statusText, weight, type, icon, interfaceId, port, activation, tImp } = req.body
  if (!name) return res.status(400).json({ error: 'Missing name' })
  if (type && !['wash', 'dry'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  if (activation && !['high', 'low'].includes(activation)) return res.status(400).json({ error: 'Invalid activation' })
  
  // Check if interface+port combo is already in use
  if (interfaceId && port) {
    const existing = await Machine.findOne({ interfaceId, port })
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
  res.json(machine)
})

// List users (admin only)
router.get('/users', async (req, res) => {
  const UserT = withTenant(User, req)
  const users = await UserT.find().select('username role apiKey createdAt').lean()
  // mask apiKey
  const masked = users.map((u) => ({ _id: u._id, username: u.username, role: u.role, apiKey: u.apiKey ? u.apiKey.slice(0, 8) + '…' : null, createdAt: u.createdAt }))
  res.json(masked)
})

// Create user (admin) - accepts an optional `password` field so admins can set credentials directly
router.post('/users', async (req, res) => {
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

  res.json(resp)
})

// Rotate API key for user
router.post('/users/:id/rotate', async (req, res) => {
  const id = req.params.id
  const newKey = crypto.randomBytes(24).toString('hex')
  const UserT = withTenant(User, req)
  const user = await UserT.findByIdAndUpdate(id, { apiKey: newKey }, { new: true })
  if (!user) return res.status(404).json({ error: 'User not found' })
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
router.put('/machines/:id', async (req, res) => {
  const { name, number, brand, model, serialNumber, status, statusText, weight, type, icon, interfaceId, port, activation, tImp } = req.body
  if (type && !['wash', 'dry'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  if (activation && !['high', 'low'].includes(activation)) return res.status(400).json({ error: 'Invalid activation' })
  
  // Check if interface+port combo is already in use by another machine
  if (interfaceId && port) {
    const existing = await Machine.findOne({ interfaceId, port, _id: { $ne: req.params.id } })
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
  res.json(m)
})

// Delete machine
router.delete('/machines/:id', async (req, res) => {
  const MachineT = withTenant(Machine, req)
  await MachineT.findByIdAndDelete(req.params.id)
  // broadcast updated machine list
  try { await broadcastMachines() } catch (e) { console.error('[admin] broadcastMachines error', e) }
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
  const { username, role, password } = req.body
  const update = { username, role }
  if (password) {
    const hash = await bcrypt.hash(password, 10)
    update.password = hash
  }
  const u = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('username role apiKey createdAt')
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
  const SaleT = withTenant(Sale, req)
  const tx = await SaleT.find().populate('machineId').populate('cardId').sort({ createdAt: -1 }).limit(200).lean()
  res.json(tx)
})

router.get('/transactions/:id', async (req, res) => {
  const SaleT = withTenant(Sale, req)
  const t = await SaleT.findById(req.params.id).populate('machineId').populate('cardId').lean()
  if (!t) return res.status(404).json({ error: 'Transaction not found' })
  res.json(t)
})

// Loyalty Cards (admin)
router.get('/cards', async (req, res) => {
  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const list = await CardT.find().sort({ createdAt: -1 }).lean()
  res.json(list)
})

router.get('/cards/:id', async (req, res) => {
  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const c = await CardT.findById(req.params.id).lean()
  if (!c) return res.status(404).json({ error: 'Card not found' })
  res.json(c)
})

router.post('/cards', async (req, res) => {
  const { code, balance = 0, metadata } = req.body
  if (!code) return res.status(400).json({ error: 'Missing code' })
  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const existing = await CardT.findOne({ code })
  if (existing) return res.status(400).json({ error: 'Card already exists' })
  const c = await CardT.create({ code, balance: Number(balance || 0), metadata })
  res.json(c)
})

router.put('/cards/:id', async (req, res) => {
  const { balance, metadata } = req.body
  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const c = await CardT.findByIdAndUpdate(req.params.id, { balance: balance == null ? undefined : Number(balance), metadata }, { new: true })
  if (!c) return res.status(404).json({ error: 'Card not found' })
  res.json(c)
})

// GET /admin/cards/:id/history — Full audit trail for a card
router.get('/cards/:id/history', async (req, res) => {
  const SaleT = withTenant(Sale, req)
  const history = await SaleT.find({ cardId: req.params.id }).sort({ createdAt: -1 }).lean()
  res.json(history)
})

router.post('/transactions', async (req, res) => {
  const { machineId, amount, items, type, method, inserted, change } = req.body
  // Allow admin_start transactions with no amount (defaults to 0)
  if (!machineId && type !== 'recharge') return res.status(400).json({ error: 'Missing machineId or invalid type' })
  // For admin_start, allow amount to be omitted and default to 0
  const finalAmount = (amount == null && type === 'admin_start') ? 0 : Number(amount)
  if (finalAmount == null || Number.isNaN(finalAmount)) return res.status(400).json({ error: 'Invalid amount' })
  const SaleT = withTenant(Sale, req)
  const s = await SaleT.create({ machineId, amount: finalAmount, items, type: type || 'payment', method, inserted: Number(inserted || 0), change: Number(change || 0) })
  res.json(s)
})

router.delete('/transactions/:id', async (req, res) => {
  await Sale.findByIdAndDelete(req.params.id)
  res.json({ success: true })
})

// Settings (simple key/value store)
router.get('/settings', async (req, res) => {
  const SettingT = withTenant(Setting, req)
  const list = await SettingT.find().lean()
  res.json(list)
})

// WebSocket client diagnostics (admin only)
router.get('/ws/clients', async (req, res) => {
  const clients = listClients()
  res.json(clients)
})

router.post('/ws/clients/disconnect', async (req, res) => {
  const { id } = req.body
  if (!id) return res.status(400).json({ error: 'Missing id' })
  const ok = disconnectClient(id)
  if (!ok) return res.status(404).json({ error: 'Client not found' })
  res.json({ success: true })
})

router.get('/settings/:key', async (req, res) => {
  const SettingT = withTenant(Setting, req)
  const s = await SettingT.findOne({ key: req.params.key }).lean()
  if (!s) return res.status(404).json({ error: 'Setting not found' })
  res.json(s)
})

router.post('/settings', async (req, res) => {
  const { key, value } = req.body
  if (!key) return res.status(400).json({ error: 'Missing key' })
  const SettingT = withTenant(Setting, req)
  const s = await SettingT.findOneAndUpdate({ key }, { value }, { upsert: true, new: true })
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

router.post('/settings/logo', (req, res) => {
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

router.delete('/settings/:key', async (req, res) => {
  await Setting.findOneAndDelete({ key: req.params.key })
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
router.post('/interfaces', async (req, res) => {
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
  const r = role || 'MEMBER'
  res.json({ success: true })
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
router.put('/interfaces/:id', async (req, res) => {
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

  const iface = await Interface.findByIdAndUpdate(req.params.id, update, { new: true })
  if (!iface) return res.status(404).json({ error: 'Interface not found' })
  res.json(iface)
})

// Delete interface
router.delete('/interfaces/:id', async (req, res) => {
  await Interface.findByIdAndDelete(req.params.id)
  res.json({ success: true })
})

// Toggle interface status (activate/deactivate/fault)
router.post('/interfaces/:id/status', async (req, res) => {
  const { status } = req.body
  if (!['active', 'inactive', 'fault'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be active, inactive, or fault' })
  }
  const iface = await Interface.findByIdAndUpdate(req.params.id, { status }, { new: true })
  if (!iface) return res.status(404).json({ error: 'Interface not found' })
  res.json(iface)
})

// ==================== PRICES ====================

// List all prices
router.get('/prices', async (req, res) => {
  const prices = await Price.find().sort({ type: 1, weight: 1 })
  res.json(prices)
})

// Get price by type and weight (for machine lookup)
router.get('/prices/lookup', async (req, res) => {
  const { type, weight } = req.query
  if (!type || !weight) return res.status(400).json({ error: 'Missing type or weight' })
  const price = await Price.findOne({ type, weight: Number(weight) })
  if (!price) return res.status(404).json({ error: 'Price not found for this type/weight' })
  res.json(price)
})

// Get single price
router.get('/prices/:id', async (req, res) => {
  const price = await Price.findById(req.params.id)
  if (!price) return res.status(404).json({ error: 'Price not found' })
  res.json(price)
})

// Create price
router.post('/prices', async (req, res) => {
  const { type, weight, duration, cashPrice, cardPrice, mobilePrice } = req.body
  if (!type || !['wash', 'dry'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  if (weight == null || weight <= 0) return res.status(400).json({ error: 'Invalid weight' })

  // Check for duplicate type+weight
  const existing = await Price.findOne({ type, weight: Number(weight) })
  if (existing) return res.status(400).json({ error: `Preço para ${type} ${weight}kg já existe` })

  const price = await Price.create({
    type,
    weight: Number(weight),
    duration: duration != null ? Number(duration) : null,
    cashPrice: Number(cashPrice) || 0,
    cardPrice: Number(cardPrice) || 0,
    mobilePrice: Number(mobilePrice) || 0,
  })
  res.json(price)
})

// Update price
router.put('/prices/:id', async (req, res) => {
  const { type, weight, duration, cashPrice, cardPrice, mobilePrice } = req.body
  
  // Check if changing type+weight would conflict with existing
  if (type || weight) {
    const current = await Price.findById(req.params.id)
    if (!current) return res.status(404).json({ error: 'Price not found' })
    
    const newType = type || current.type
    const newWeight = weight != null ? Number(weight) : current.weight
    
    const conflict = await Price.findOne({ 
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

  const price = await Price.findByIdAndUpdate(req.params.id, update, { new: true })
  if (!price) return res.status(404).json({ error: 'Price not found' })
  res.json(price)
})

// Delete price
router.delete('/prices/:id', async (req, res) => {
  await Price.findByIdAndDelete(req.params.id)
  res.json({ success: true })
})

// ===== PERIPHERALS =====

// List peripherals
router.get('/peripherals', async (req, res) => {
  const peripherals = await Peripheral.find().sort({ type: 1, name: 1 })
  res.json(peripherals)
})

// Create peripheral
router.post('/peripherals', async (req, res) => {
  const { name, type, enabled, protocol, address, brand, model, serialNumber, status, image } = req.body
  if (!name || !type) return res.status(400).json({ error: 'Missing required fields' })
  
  const peripheral = await Peripheral.create({
    name, type, enabled, protocol, address, brand, model, serialNumber, status, image
  })
  res.json(peripheral)
})

// Update peripheral
router.put('/peripherals/:id', async (req, res) => {
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
  
  const peripheral = await Peripheral.findByIdAndUpdate(req.params.id, update, { new: true })
  if (!peripheral) return res.status(404).json({ error: 'Peripheral not found' })
  res.json(peripheral)
})

// Delete peripheral
router.delete('/peripherals/:id', async (req, res) => {
  await Peripheral.findByIdAndDelete(req.params.id)
  res.json({ success: true })
})

// =====================
// Day Close / Cash Session
// =====================

// GET /admin/day-close — list previous closes (newest first, limit 90)
router.get('/day-close', async (req, res) => {
  const DayClose = (await import('../models/dayClose.js')).default
  const DayCloseT = withTenant(DayClose, req)
  const list = await DayCloseT.find().sort({ createdAt: -1 }).limit(90).lean()
  res.json(list)
})

// GET /admin/day-close/summary — live sales totals + reconciliation data for the current open session
router.get('/day-close/summary', async (req, res) => {
  const DayClose = (await import('../models/dayClose.js')).default
  const DayCloseT = withTenant(DayClose, req)
  const SaleT = withTenant(Sale, req)

  // The period starts from the last close (no time-of-day assumption)
  const lastCloseArr = await DayCloseT.find().sort({ createdAt: -1 }).limit(1).lean()
  const lastClose = lastCloseArr[0] || null
  const periodFrom = lastClose ? lastClose.createdAt : new Date(0)
  const openingFloat = lastClose ? Number(lastClose.floatLeft || 0) : 0

  const sales = await SaleT.find({ createdAt: { $gt: periodFrom } }).lean()
  let totalCash = 0
  let totalCard = 0
  let totalChangeDispensed = 0
  for (const s of sales) {
    const amt = Number(s.amount || 0)
    if (s.method === 'cash') totalCash += amt
    else totalCard += amt
    totalChangeDispensed += Number(s.change || 0)
  }
  const tc = Number(totalCash.toFixed(2))
  const expectedCash = Number((openingFloat + tc).toFixed(2))

  res.json({
    periodFrom,
    periodTo: new Date(),
    openingFloat,
    totalCash: tc,
    totalCard: Number(totalCard.toFixed(2)),
    totalSales: Number((tc + totalCard).toFixed(2)),
    expectedCash,
    salesCount: sales.length,
    totalChangeDispensed: Number(totalChangeDispensed.toFixed(2)),
    openingMechanismCoins: lastClose?.coinMechanismInventory || [],
    openingMechanismTotal: lastClose?.coinMechanismTotal || 0,
    openingHopperCoins: lastClose?.hopperCoins || [],
    openingHopperTotal: lastClose?.hopperTotal || 0
  })
})

// GET /admin/day-close/:id — single record
router.get('/day-close/:id', async (req, res) => {
  const DayClose = (await import('../models/dayClose.js')).default
  const DayCloseT = withTenant(DayClose, req)
  const dc = await DayCloseT.findById(req.params.id).lean()
  if (!dc) return res.status(404).json({ error: 'Cash session record not found' })
  res.json(dc)
})

// POST /admin/day-close — close / reconcile the current cash session
router.post('/day-close', async (req, res) => {
  const {
    amountToBank,
    floatLeft,
    countedCash,
    countedDenominations = [],
    coinMechanismInventory = [],
    hopperActualBefore = [],
    hopperCoins = [],
    notes
  } = req.body

  if (amountToBank == null || floatLeft == null) {
    return res.status(400).json({ error: 'amountToBank and floatLeft are required' })
  }

  // Sanitise denomination arrays (recompute totals server-side)
  function cleanDenoms(arr) {
    return (arr || [])
      .filter(d => d && Number(d.value) > 0 && Number(d.count) >= 0)
      .map(d => ({
        value: Number(d.value),
        count: Number(d.count),
        total: Number((Number(d.value) * Number(d.count)).toFixed(2))
      }))
  }

  const countedDenomsClean       = cleanDenoms(countedDenominations)
  const coinMechClean             = cleanDenoms(coinMechanismInventory)
  const hopperActualClean         = cleanDenoms(hopperActualBefore)
  const hopperCoinsClean          = cleanDenoms(hopperCoins)
  const coinMechanismTotal        = Number(coinMechClean.reduce((s, d) => s + d.total, 0).toFixed(2))
  const hopperActualBeforeTotal   = Number(hopperActualClean.reduce((s, d) => s + d.total, 0).toFixed(2))
  const hopperTotal               = Number(hopperCoinsClean.reduce((s, d) => s + d.total, 0).toFixed(2))

  // Fetch authoritative sales totals from DB
  const DayClose = (await import('../models/dayClose.js')).default
  const DayCloseT = withTenant(DayClose, req)
  const SaleT = withTenant(Sale, req)

  const lastCloseArr = await DayCloseT.find().sort({ createdAt: -1 }).limit(1).lean()
  const lastClose = lastCloseArr[0] || null
  const periodFrom = lastClose ? lastClose.createdAt : new Date(0)
  const openingFloat = lastClose ? Number(lastClose.floatLeft || 0) : 0
  const periodTo = new Date()

  const sales = await SaleT.find({ createdAt: { $gt: periodFrom, $lte: periodTo } }).lean()
  let totalCash = 0; let totalCard = 0; let totalChangeDisp = 0
  for (const s of sales) {
    const amt = Number(s.amount || 0)
    if (s.method === 'cash') totalCash += amt
    else totalCard += amt
    totalChangeDisp += Number(s.change || 0)
  }
  const tc = Number(totalCash.toFixed(2))
  const tk = Number(totalCard.toFixed(2))
  const expectedCash = Number((openingFloat + tc).toFixed(2))
  const totalChangeDispensed = Number(totalChangeDisp.toFixed(2))

  // If countedCash wasn't provided, derive it from denomination sum
  const actualCountedCash = countedCash != null
    ? Number(Number(countedCash).toFixed(2))
    : Number(countedDenomsClean.reduce((s, d) => s + d.total, 0).toFixed(2))

  const discrepancy = Number((actualCountedCash - expectedCash).toFixed(2))

  const dc = await DayCloseT.create({
    openingFloat,
    expectedCash,
    countedCash: actualCountedCash,
    discrepancy,
    countedDenominations: countedDenomsClean,
    amountToBank: Number(Number(amountToBank).toFixed(2)),
    floatLeft: Number(Number(floatLeft).toFixed(2)),
    coinMechanismInventory: coinMechClean,
    coinMechanismTotal,
    openingMechanismCoins: lastClose?.coinMechanismInventory || [],
    openingHopperCoins: lastClose?.hopperCoins || [],
    totalChangeDispensed,
    hopperActualBefore: hopperActualClean,
    hopperActualBeforeTotal,
    hopperCoins: hopperCoinsClean,
    hopperTotal,
    notes: String(notes || '').slice(0, 500),
    totalCash: tc,
    totalCard: tk,
    totalSales: Number((tc + tk).toFixed(2)),
    closedBy: req.user?._id,
    closedByUsername: req.user?.username || '',
    periodFrom,
    periodTo
  })

  res.json(dc)
})

// =====================
// 📊 ANALYTICS & BUSINESS INTEL
// =====================

/**
 * GET /admin/analytics/revenue
 * Returns revenue data aggregated by day for the last 30 days
 */
router.get('/analytics/revenue', async (req, res) => {
  const SaleT = withTenant(Sale, req)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const stats = await Sale.aggregate([
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

/**
 * GET /admin/analytics/machines
 * Returns usage stats per machine
 */
router.get('/analytics/machines', async (req, res) => {
  const SaleT = withTenant(Sale, req)
  const stats = await Sale.aggregate([
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
router.get('/kiosks/health', async (req, res) => {
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
router.post('/kiosks/:id/command', async (req, res) => {
  const { type, payload } = req.body
  if (!['reboot', 'update_config', 'upload_logs', 'screenshot', 'clear_queue', 'sync_now'].includes(type)) {
    return res.status(400).json({ error: 'Invalid command type' })
  }

  const SyncCommandT = withTenant(SyncCommand, req)
  const cmd = await SyncCommandT.create({
    kioskId: req.params.id,
    type,
    payload: payload || {},
    status: 'pending'
  })

  res.json({ success: true, commandId: cmd._id })
})

export default router

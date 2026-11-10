import { getEmailBrand } from '../services/emailBrand.js'
import express from 'express'
import mongoose from 'mongoose'
import { requireAdmin, requireSuperAdmin, requireStaffRead, requireAnyStaff, requireTechnician, requireMachineOperator, requireDashboardUser } from '../middleware/auth.js'
import MaintenanceTicket from '../models/maintenanceTicket.js'
import Coupon from '../models/coupon.js'
import { sendMail } from '../services/mailer.js'
import { renderEmailHtml, escapeHtmlMultiline } from '../services/emailTemplate.js'
import Machine from '../models/machine.js'
import User from '../models/user.js'
import Sale from '../models/sale.js'
import Setting from '../models/setting.js'
import Interface from '../models/interface.js'
import Price from '../models/price.js'
import Peripheral from '../models/peripheral.js'
import { withTenant } from '../services/tenant.js'
import { resetSoleTenantCache } from '../middleware/tenant.js'
import { normalizeHost } from '../services/tenantDomains.js'
import { usernameTaken } from '../services/ensureIndexes.js'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import sharp from 'sharp'
import Card from '../models/card.js'
import SyncCommand from '../models/syncCommand.js'
import { roundMoney, parseAmount } from '../utils/money.js'
import DayClose from '../models/dayClose.js'
import { broadcastMachines, broadcastMachine, listClients, disconnectClient } from '../wsServer.js'
import { logAction } from '../services/auditLog.js'
import { translateLandingSoon, translateLanding, getTranslations, getStatus } from '../services/landingTranslate.js'
import { translateLegalSoon, getLegalStatus } from '../services/legalTranslate.js'
import { translateBannersSoon } from '../services/bannerTranslate.js'
import { translatorEnabled } from '../services/translator.js'
import { bumpLandingVersion } from '../services/landingCache.js'
import { loadGlossary, sanitizeGlossary, GLOSSARY_KEY } from '../services/landingGlossary.js'
import { creditCard, balanceUpdate } from '../services/cardBalance.js'
import AuditLog from '../models/auditLog.js'

const router = express.Router()

// An :id that is not a database id is simply "not found" (it used to reach the database and come back as a 500).
// /flows/:id also takes a flow's own id, so it is left alone.
router.param('id', (req, res, next, id) => {
  if (req.path.startsWith('/flows/') || mongoose.isValidObjectId(id)) return next()
  res.status(404).json({ error: 'Not found' })
})

// Any dashboard role (ADMIN/SUPERADMIN/STAFF/TECHNICIAN) can reach this
// router at all; individual routes narrow further with requireAdmin,
// requireStaffRead or requireTechnician below.
router.use(requireDashboardUser)
// ...but an OPERATOR reaches ONLY the machine list and the manual start / release of a machine: every other route answers 403 for them.
const OPERATOR_ALLOWED = (req) => (req.method === 'GET' && (req.path === '/machines' || req.path === '/shop-status')) || (req.method === 'POST' && /^\/machines\/[^/]+\/(start|end)$/.test(req.path))
router.use((req, res, next) => {
  if (req.userModel?.role === 'OPERATOR' && !OPERATOR_ALLOWED(req)) return res.status(403).json({ error: 'Forbidden' })
  next()
})

// A change to what the shop must follow (machines, prices, settings, interfaces, peripherals) is
// made here on the central server. Tell the shop to pull it NOW instead of waiting for its
// 5-minute pull. No-op on a server that has the hardware itself, and never more than one
// pending request per kiosk.
const SHOP_CONFIG_PATHS = /^\/(machines|prices|settings|interfaces|peripherals)(\/|$)/
router.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
  res.on('finish', () => {
    if (res.statusCode >= 300 || !SHOP_CONFIG_PATHS.test(req.path) || /\/(start|end|service)$/.test(req.path)) return
    ;(async () => {
      const { default: coinMachine } = await import('../services/coinMachine.js')
      if (coinMachine.running || !req.tenantId) return
      const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('_id').lean()
      for (const k of kiosks) {
        const waiting = await SyncCommand.exists({ tenantId: req.tenantId, kioskId: k._id, type: 'sync_now', status: 'pending' })
        if (!waiting) await SyncCommand.create({ tenantId: req.tenantId, kioskId: k._id, type: 'sync_now', payload: {} })
      }
    })().catch((e) => console.error('[admin] could not queue the shop sync', e.message))
  })
  next()
})

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
    // Only an operator's "Offline" takes a machine out of service; anything else brings it back.
    ...(status !== undefined ? { outOfService: status === 'offline' } : {}),
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
  // A shop's own administrators never see (or touch) the platform's superadmins.
  const users = await UserT.find(req.userModel?.role === 'SUPERADMIN' ? {} : { role: { $ne: 'SUPERADMIN' } }).select('username role apiKey apiKeyNext createdAt').lean()
  // mask apiKey; a staged (not yet used) new key is only flagged, never shown
  const masked = users.map((u) => ({ _id: u._id, username: u.username, role: u.role, apiKey: u.apiKey ? u.apiKey.slice(0, 8) + '…' : null, pendingKey: Boolean(u.apiKeyNext), createdAt: u.createdAt }))
  res.json(masked)
})

// Create user (admin) - accepts an optional `password` field so admins can set credentials directly
router.post('/users', requireAdmin, async (req, res) => {
  const { username, role, password } = req.body
  if (!username) return res.status(400).json({ error: 'Missing username' })
  if (password && (typeof password !== 'string' || password.length < 8)) return res.status(400).json({ error: 'Password must be at least 8 characters' })

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

  // A user name identifies ONE person in the whole system (every shop), capitals ignored.
  if (await usernameTaken(User, username)) return res.status(409).json({ error: 'Já existe um utilizador com esse nome' })
  // Same rule as when changing a role: only a superadmin can create a superadmin.
  const newRole = role || 'USER'
  const allowedRoles = req.userModel?.role === 'SUPERADMIN' ? [...ASSIGNABLE_ROLES, 'SUPERADMIN'] : ASSIGNABLE_ROLES
  if (!allowedRoles.includes(newRole)) return res.status(400).json({ error: 'Invalid role' })
  const apiKey = newRole === 'KIOSK' ? crypto.randomBytes(24).toString('hex') : undefined
  const UserT = withTenant(User, req)
  let user
  try {
    user = await UserT.create({ username, role: newRole, password: hash, apiKey })
  } catch (err) {
    // A name that is already taken (or an invalid role) is an answer for the admin, not a call that never returns.
    if (err?.code === 11000) return res.status(409).json({ error: 'Já existe um utilizador com esse nome' })
    if (err?.name === 'ValidationError') return res.status(400).json({ error: err.message })
    throw err
  }

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

// The kiosk user is a system account: it has an API key and no password, and the shop's software holds that key. It is listed
// in the admin but cannot be changed, re-keyed or deleted from here (any of those would cut the shop off from the server).
async function refuseIfKiosk(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return false
  const u = await withTenant(User, req).findById(req.params.id).select('role').lean()
  if (u?.role === 'KIOSK') {
    res.status(403).json({ error: 'O utilizador do quiosque é um utilizador de sistema e não pode ser alterado aqui', code: 'kiosk-protected' })
    return true
  }
  return false
}

// Rotate API key for user. For the kiosk user the new key is STAGED (the old one keeps working until the new one is first used,
// see services/apiKeys.js) and returned once, in groups of four, to be typed at the kiosk (staff menu, with the PIN).
// What a non-superadmin may not even see: the platform's superadmins (answered as "not found").
const hideSuperadmins = (req) => (req.userModel?.role === 'SUPERADMIN' ? {} : { role: { $ne: 'SUPERADMIN' } })

router.post('/users/:id/rotate', requireAdmin, async (req, res) => {
  if (mongoose.isValidObjectId(req.params.id)) {
    const target = await withTenant(User, req).findOne({ _id: req.params.id, ...hideSuperadmins(req) }).select('role username').lean()
    if (target?.role === 'KIOSK') {
      const { stageNewKey, groupKey } = await import('../services/apiKeys.js')
      const key = await stageNewKey(req.tenantId, req.params.id)
      logAction(req, 'user.rotate_kiosk_key', 'User', req.params.id, { username: target.username, note: 'staged: the old key keeps working until the new one is used' })
      return res.json({ _id: req.params.id, staged: true, apiKey: groupKey(key) })
    }
  }
  const id = req.params.id
  const newKey = crypto.randomBytes(24).toString('hex')
  const UserT = withTenant(User, req)
  const user = await UserT.findOneAndUpdate({ _id: id, ...hideSuperadmins(req) }, { apiKey: newKey }, { new: true })
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
  const users = await UserT.find({ username: regex, ...hideSuperadmins(req) }).limit(10).select('username role createdAt').lean()
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
  
  const MachineT = withTenant(Machine, req)
  const before = await MachineT.findById(req.params.id).select('outOfService serviceStatus').lean()
  // Only the fields that were SENT are changed. The Offline / Avariar buttons send just
  // { status, statusText }; writing every field blanked the machine's interface, port and weight.
  const has = (k) => Object.prototype.hasOwnProperty.call(req.body, k)
  const set = {}
  for (const k of ['name', 'number', 'brand', 'model', 'serialNumber', 'status', 'statusText']) if (has(k)) set[k] = req.body[k]
  if (has('status')) { // the operator's "Offline" / "Avariada" take it out of service; anything else brings it back
    set.outOfService = status === 'offline' || status === 'fault'
    set.serviceStatus = set.outOfService ? status : null
  }
  if (has('weight')) set.weight = weight || 0
  if (has('type')) set.type = type
  if (has('icon') || has('type')) set.icon = icon || (type === 'dry' ? '/drymachine/S1.png' : '/washingmashine/L1.png')
  if (has('interfaceId')) set.interfaceId = interfaceId || null
  if (has('port')) set.port = port || null
  if (has('activation')) set.activation = activation || 'high'
  if (has('tImp') || has('type')) set.tImp = type === 'dry' && tImp != null ? Number(tImp) : null
  const m = await MachineT.findByIdAndUpdate(req.params.id, { $set: set }, { new: true })
  if (!m) return res.status(404).json({ error: 'Machine not found' })
  // broadcast single updated machine to clients (more efficient)
  try { await broadcastMachine(m) } catch (e) { console.error('[admin] broadcastMachine error', e) }
  logAction(req, 'machine.update', 'Machine', m._id, { name: m.name })
  // Out of service changed on the central server: tell the shop now instead of waiting for the next pull.
  if (before && (Boolean(before.outOfService) !== Boolean(m.outOfService) || (before.serviceStatus || null) !== (m.serviceStatus || null))) {
    try {
      const { default: coinMachine } = await import('../services/coinMachine.js')
      if (!coinMachine.running) {
        const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('_id').lean()
        const SyncCommandT = withTenant(SyncCommand, req)
        for (const k of kiosks) {
          await SyncCommandT.create({ kioskId: k._id, type: 'set_service', payload: { machineId: String(m._id), outOfService: Boolean(m.outOfService), status: m.serviceStatus || (m.outOfService ? 'offline' : 'free') } })
        }
      }
    } catch (e) { console.error('[admin] could not queue the out-of-service command', e.message) }
  }
  res.json(m)
})

// Delete machine
router.delete('/machines/:id', requireAdmin, async (req, res) => {
  const MachineT = withTenant(Machine, req)
  const m = await MachineT.findByIdAndDelete(req.params.id)
  if (!m) return res.status(404).json({ error: 'Machine not found' })
  // broadcast updated machine list
  try { await broadcastMachines() } catch (e) { console.error('[admin] broadcastMachines error', e) }
  logAction(req, 'machine.delete', 'Machine', req.params.id, { name: m?.name })
  res.json({ success: true })
})

// POST /admin/machines/:id/start and /end — start or release a machine with no payment.
// On a server that has the hardware (the shop PC) it happens right here. On the central
// server, which has none, it is queued as a remote command that the shop picks up within a
// few seconds (services/remoteCommands.js) and reports back on.
// A shop is online if it contacted the central server in the last 45 s (it polls every 5 s).
const SHOP_ONLINE_MS = 45_000
const shopOnline = (lastSeen) => Boolean(lastSeen) && Date.now() - new Date(lastSeen).getTime() < SHOP_ONLINE_MS

// GET /admin/shop-status — is the shop talking to us right now? (drives the banner on the operations page)
router.get('/shop-status', requireMachineOperator, async (req, res) => {
  const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('lastSeen').lean()
  const last = kiosks.map((k) => k.lastSeen).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null
  res.json({ known: kiosks.length > 0, online: kiosks.some((k) => shopOnline(k.lastSeen)), lastSeen: last, offlineSeconds: last ? Math.round((Date.now() - new Date(last).getTime()) / 1000) : null })
})

async function machineAdminAction(req, res, kind) {
  // Dryers: how many cycles (blocks) to start. Whole number 1..8; the shop clamps again to its own limit.
  const blocks = Math.min(8, Math.max(1, Math.floor(Number(req.body?.blocks)) || 1))
  const MachineT = withTenant(Machine, req)
  const machine = await MachineT.findById(req.params.id)
  if (!machine) return res.status(404).json({ error: 'Machine not found' })
  const { default: coinMachine } = await import('../services/coinMachine.js')

  if (coinMachine.running) {
    try {
      const result = kind === 'start' ? await coinMachine.adminStartMachine(machine._id, blocks) : await coinMachine.adminEndMachine(machine._id)
      logAction(req, `machine.admin_${kind}`, 'Machine', machine._id, { name: machine.name, ...(kind === 'start' ? { blocks } : {}) })
      if (kind === 'start') {
        await withTenant(Sale, req).create({ machineId: machine._id, amount: 0, type: 'admin_start', method: 'cash' }).catch(() => {})
      }
      return res.json({ ...result, queued: false })
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }
  }

  const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('_id lastSeen').lean()
  if (kiosks.length === 0) return res.status(409).json({ error: 'No shop kiosk is registered for this tenant' })
  // The shop asks for commands every few seconds. If it has not for a while it is offline, and a command
  // would only expire (older than 2 min it is refused on purpose): say so now instead of pretending it was sent.
  if (!kiosks.some((k) => shopOnline(k.lastSeen))) {
    return res.status(409).json({ error: 'A loja está sem ligação à internet neste momento, por isso não recebe o pedido. Tente de novo quando voltar (o quiosque na loja continua a funcionar com dinheiro).', code: 'shop-offline' })
  }
  const SyncCommandT = withTenant(SyncCommand, req)
  // A double click (seen live: two start orders 60 ms apart) is one order: the one already on its way is answered again.
  const type = kind === 'start' ? 'start_machine' : 'end_machine'
  const twin = await SyncCommandT.find({ type, 'payload.machineId': String(machine._id), createdAt: { $gt: new Date(Date.now() - 15_000) } }).select('_id').lean()
  if (twin.length) return res.json({ success: true, queued: true, commandIds: twin.map((c) => c._id), duplicate: true })
  const cmds = []
  for (const k of kiosks) {
    cmds.push(await SyncCommandT.create({ kioskId: k._id, type, payload: kind === 'start' ? { machineId: String(machine._id), blocks } : { machineId: String(machine._id) } }))
  }
  logAction(req, `machine.admin_${kind}_requested`, 'Machine', machine._id, { name: machine.name })
  res.json({ success: true, queued: true, commandIds: cmds.map((c) => c._id) })
}
router.post('/machines/:id/start', requireMachineOperator, (req, res, next) => machineAdminAction(req, res, 'start').catch(next))
router.post('/machines/:id/end', requireMachineOperator, (req, res, next) => machineAdminAction(req, res, 'end').catch(next))

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
const ASSIGNABLE_ROLES = ['USER', 'KIOSK', 'ADMIN', 'STAFF', 'TECHNICIAN', 'OPERATOR']

router.get('/users/:id', requireAdmin, async (req, res) => {
  const UserT = withTenant(User, req)
  const u = await UserT.findById(req.params.id).select('username role apiKey createdAt').lean()
  if (!u) return res.status(404).json({ error: 'User not found' })
  u.apiKey = u.apiKey ? u.apiKey.slice(0, 8) + '…' : null
  res.json(u)
})

router.put('/users/:id', requireAdmin, async (req, res) => {
  if (await refuseIfKiosk(req, res)) return
  const { username, role, password } = req.body
  const update = {}
  if (username) {
    if (await usernameTaken(User, username, req.params.id)) return res.status(409).json({ error: 'Já existe um utilizador com esse nome' })
    update.username = username
  }
  if (role !== undefined) {
    // A tenant admin must not be able to mint a SUPERADMIN; only a superadmin can.
    const allowed = req.userModel?.role === 'SUPERADMIN' ? [...ASSIGNABLE_ROLES, 'SUPERADMIN'] : ASSIGNABLE_ROLES
    if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role' })
    update.role = role
  }
  if (password) {
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }
    update.password = await bcrypt.hash(password, 10)
    update.passwordChangedAt = new Date()
  }
  const UserT = withTenant(User, req)
  const u = await UserT.findOneAndUpdate({ _id: req.params.id, ...hideSuperadmins(req) }, update, { new: true }).select('username role apiKey createdAt')
  if (!u) return res.status(404).json({ error: 'User not found' })
  u.apiKey = u.apiKey ? u.apiKey.slice(0, 8) + '…' : null
  logAction(req, role !== undefined ? 'user.role_change' : 'user.update', 'User', u._id, { username: u.username, role: u.role })
  res.json(u)
})

router.delete('/users/:id', requireAdmin, async (req, res) => {
  if (await refuseIfKiosk(req, res)) return
  const UserT = withTenant(User, req)
  // Refuse to delete yourself — an admin locking themselves out of their own
  // tenant needs a superadmin to recover it.
  if (String(req.userModel?._id) === String(req.params.id)) {
    return res.status(400).json({ error: 'You cannot delete your own account' })
  }
  const u = await UserT.findOneAndDelete({ _id: req.params.id, ...hideSuperadmins(req) })
  if (!u) return res.status(404).json({ error: 'User not found' })
  logAction(req, 'user.delete', 'User', req.params.id, { username: u.username })
  res.json({ success: true })
})

// Transactions (Sales)
// Optional ?from= & ?to= (ISO instants) limit it to a period, so an older day is never cut off by the row cap.
router.get('/transactions', requireStaffRead, async (req, res) => {
  const SaleT = withTenant(Sale, req)
  const q = {}
  const from = req.query.from ? new Date(String(req.query.from)) : null
  const to = req.query.to ? new Date(String(req.query.to)) : null
  if ((from && !Number.isNaN(+from)) || (to && !Number.isNaN(+to))) {
    q.createdAt = {}
    if (from && !Number.isNaN(+from)) q.createdAt.$gte = from
    if (to && !Number.isNaN(+to)) q.createdAt.$lte = to
  }
  const tx = await SaleT.find(q).populate('machineId').populate('cardId').sort({ createdAt: -1 }).limit(q.createdAt ? 2000 : 500).lean()
  res.json(tx)
})

// GET /admin/transactions/export.csv?from=&to=&type= — no row cap (unlike the
// list route above), used for accounting exports. Hand-built CSV: the shape
// is simple enough that a library would be pure overhead.
function csvCell(v) {
  let s = v == null ? '' : String(v)
  // A text that a spreadsheet would run as a formula (a card holder named "=HYPERLINK(...)") is made plain text. Numbers stay numbers.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+([.,]\d+)?$/.test(s)) s = "'" + s
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
// Optional body: amount (a PART of the sale, default all of it) and payout:true (cash sales only: the hopper pays that amount to the
// customer now). On the shop PC the hopper is used directly; on the central server the shop PC is asked and must answer within seconds
// (nothing is queued for later: money must not come out when nobody is looking).
const refundsInFlight = new Set()
async function payOutForRefund(req, amount, sale) {
  const { default: coinMachine } = await import('../services/coinMachine.js')
  if (coinMachine.running) return coinMachine.payOutCash(amount, { reason: 'refund' })
  const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('_id').lean()
  if (kiosks.length !== 1) { const e = new Error(kiosks.length ? 'Há mais de um quiosque: pague o reembolso no PC da loja' : 'Nenhum quiosque registado para esta loja'); e.status = 409; throw e }
  const SyncCommandT = withTenant(SyncCommand, req)
  const cmd = await SyncCommandT.create({ kioskId: kiosks[0]._id, type: 'pay_out', payload: { amount, saleId: String(sale._id) } })
  const waitMs = Number(process.env.REFUND_PAYOUT_WAIT_MS) >= 0 ? Number(process.env.REFUND_PAYOUT_WAIT_MS) : 30_000
  const graceMs = Number(process.env.REFUND_PAYOUT_GRACE_MS) >= 0 ? Number(process.env.REFUND_PAYOUT_GRACE_MS) : 15_000
  const pollMs = Number(process.env.REFUND_PAYOUT_POLL_MS) > 0 ? Number(process.env.REFUND_PAYOUT_POLL_MS) : 1000
  const until = Date.now() + waitMs
  let cancelled = false
  for (;;) {
    const c = await SyncCommandT.findById(cmd._id).lean()
    if (c?.status === 'done') return c.result || { success: true, dispensed: amount, remaining: 0 }
    if (c?.status === 'failed') { const e = new Error(c.error || 'A loja recusou o pagamento'); e.status = 502; e.nothingPaid = true; throw e }
    if (Date.now() >= until && !cancelled) {
      // Not picked up in time: withdraw it so it can never run later. If the shop already took it, give it a little more time.
      const gone = await SyncCommandT.findOneAndUpdate({ _id: cmd._id, status: 'pending' }, { status: 'failed', error: 'Sem resposta da loja' })
      if (gone) { const e = new Error('O PC da loja não respondeu. Nada foi pago nem registado.'); e.status = 504; e.nothingPaid = true; throw e }
      cancelled = true
    }
    if (cancelled && Date.now() >= until + graceMs) return { success: false, dispensed: 0, remaining: amount, unconfirmed: true, error: 'A loja não confirmou o pagamento' }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

router.post('/transactions/:id/refund', requireAdmin, async (req, res) => {
  const reason = String(req.body?.reason || '').trim()
  if (!reason) return res.status(400).json({ error: 'A refund reason is required' })

  const SaleT = withTenant(Sale, req)
  const sale = await SaleT.findById(req.params.id)
  if (!sale) return res.status(404).json({ error: 'Transaction not found' })
  if (sale.type === 'refund') return res.status(400).json({ error: 'Cannot refund a refund' })
  if (sale.status === 'refunded') return res.status(400).json({ error: 'Transaction already refunded' })

  // What earlier (partial) refunds already gave back: a sale can be refunded in parts, never beyond its amount.
  const earlier = await SaleT.find({ refundOf: sale._id, type: 'refund' }).select('amount').lean()
  const alreadyRefunded = roundMoney(earlier.reduce((sum, r) => sum + Math.abs(Number(r.amount) || 0), 0))
  const left = roundMoney(sale.amount - alreadyRefunded)
  if (!(left > 0)) return res.status(400).json({ error: 'Transaction already refunded' })

  // How much: all that is left of the sale, or a part of it.
  let amount = left
  const given = req.body?.amount
  if (given !== undefined && given !== null && given !== '') {
    const p = parseAmount(String(given).replace(',', '.'))
    if (!p.ok) return res.status(400).json({ error: 'Valor inválido' })
    if (p.value > left + 0.001) return res.status(400).json({ error: alreadyRefunded > 0 ? `Já foram reembolsados ${alreadyRefunded.toFixed(2)} € desta venda: só restam ${left.toFixed(2)} €` : `O valor não pode ser maior que a venda (${sale.amount.toFixed(2)} €)` })
    amount = p.value
  }
  const payout = req.body?.payout === true
  if (payout && sale.method !== 'cash') return res.status(400).json({ error: 'Só as vendas em dinheiro podem ser pagas pelo hopper' })
  // A sale that PUT money on a card (a recharge, the balance that came with a new card) is undone by taking that balance back off
  // the card. A sale PAID with a card is undone by giving the balance back. (Crediting in both cases gave the customer the money twice.)
  const loadedCard = Boolean(sale.cardId) && ['recharge', 'card_purchase', 'gift_card'].includes(sale.type)
  // of a new card's price only the balance that came with it is on the card; of a gift card nothing was paid at all
  const loadedCredit = sale.type === 'recharge' ? sale.amount : roundMoney(Number(sale.metadata?.initialCredit) || 0)
  const takeBack = loadedCard ? roundMoney(Math.max(0, Math.min(amount, loadedCredit - alreadyRefunded))) : 0
  if (refundsInFlight.has(String(sale._id))) return res.status(409).json({ error: 'Este reembolso já está a ser processado' })
  refundsInFlight.add(String(sale._id))
  try {

  const CardT = withTenant(Card, req)
  // on the central server the shop's own card must follow (the shop PC has no SYNC_SERVER_URL set to itself)
  const tellShop = async (delta) => {
    if (!process.env.SYNC_SERVER_URL) await CardT.findByIdAndUpdate(sale.cardId, { $push: { shopAdjustments: { $each: [{ opId: String(new mongoose.Types.ObjectId()), delta, reason: 'refund', at: new Date() }], $slice: -50 } } })
  }

  // Balance that the sale loaded comes off the card BEFORE any money goes out: what was already spent cannot be refunded.
  if (takeBack > 0) {
    // plain atomic update (not debitCard): a blocked card must still give its balance back
    const took = await CardT.findOneAndUpdate({ _id: sale.cardId, balance: { $gte: takeBack - 0.005 } }, balanceUpdate(-takeBack), { new: true })
    if (!took) {
      const c = await CardT.findById(sale.cardId).select('balance').lean()
      return res.status(409).json({ error: `O cartão só tem ${Number(c?.balance || 0).toFixed(2)} € de saldo: o resto já foi gasto. Reembolse no máximo esse valor.` })
    }
  }
  const giveBack = async () => { if (takeBack > 0) await creditCard(CardT, { _id: sale.cardId }, takeBack) }

  // The cash goes out FIRST: when the hopper pays nothing, nothing is recorded and the admin can try again.
  let paid = null
  if (payout) {
    try {
      paid = await payOutForRefund(req, amount, sale)
    } catch (e) {
      await giveBack()
      return res.status(e.status || 500).json({ error: e.message })
    }
    if (!(paid.dispensed > 0) && !paid.unconfirmed) {
      await giveBack()
      return res.status(409).json({ error: `O hopper não conseguiu pagar${paid.error ? ` (${paid.error})` : ''}. Nada foi registado.`, payout: paid })
    }
  }

  if (takeBack > 0) await tellShop(-takeBack)
  if (sale.cardId && !loadedCard) {
    // No status guard on creditCard — this must succeed even onto a blocked card.
    await creditCard(CardT, { _id: sale.cardId }, amount)
    await tellShop(amount)
  }

  const owed = paid ? roundMoney(Math.max(0, amount - (Number(paid.dispensed) || 0))) : 0
  const note = paid ? ` [pago pelo hopper: ${(Number(paid.dispensed) || 0).toFixed(2)} €${owed > 0 ? `; EM FALTA ${owed.toFixed(2)} €${paid.unconfirmed ? ' (sem confirmação da loja)' : ''}` : ''}]` : ''
  const refund = await SaleT.create({
    machineId: sale.machineId || null,
    amount: -amount,
    type: 'refund',
    method: sale.method,
    batchId: `refund-${sale._id}`,
    cardId: sale.cardId || null,
    cardCode: sale.cardCode || null,
    refundOf: sale._id,
    refundReason: reason + note
    // dayCloseId intentionally left null — it rolls into the next open
    // period the same way every other sale does (services/dayClose.js:141),
    // rather than retroactively touching a closed report's frozen totals.
  })

  // a part refunded leaves the sale open for the rest; only the whole amount closes it
  if (roundMoney(alreadyRefunded + amount) >= roundMoney(sale.amount) - 0.001) {
    sale.status = 'refunded'
    await sale.save()
  }

  logAction(req, 'transaction.refund', 'Sale', sale._id, { amount, saleAmount: sale.amount, alreadyRefunded, cardDebited: takeBack, reason, refundId: refund._id, payout: paid ? { dispensed: paid.dispensed, owed, unconfirmed: !!paid.unconfirmed } : null })
  if (owed > 0) {
    try {
      const { sendAlertForTenant } = await import('../services/alerts.js')
      await sendAlertForTenant(req.tenantId, 'Reembolso: falta pagar dinheiro ao cliente', `Reembolso de ${amount.toFixed(2)} €: o hopper pagou ${(Number(paid.dispensed) || 0).toFixed(2)} € e FALTAM ${owed.toFixed(2)} €${paid.unconfirmed ? ' (a loja não confirmou o pagamento: confirme o que saiu do hopper)' : ''}. Pague a diferença em mão ao cliente.`)
    } catch (e) { console.error('[admin] could not send the refund shortfall alert:', e.message) }
  }
  res.json({ success: true, refund, payout: paid ? { requested: amount, dispensed: paid.dispensed, owed, unconfirmed: !!paid.unconfirmed } : null })
  } finally { refundsInFlight.delete(String(sale._id)) }
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
  const start = Math.round(Number(balance || 0) * 100) / 100
  if (!Number.isFinite(start) || start < 0 || start > 1000) return res.status(400).json({ error: 'Saldo inválido (0 a 1000 €)' })
  const c = await CardT.create({ code: String(code), balance: start, metadata })
  logAction(req, 'card.create', 'Card', c._id, { code: c.code, balance: c.balance })
  res.json(c)
})

router.put('/cards/:id', requireAdmin, async (req, res) => {
  const { balance, metadata } = req.body
  const CardT = withTenant(Card, req)
  const before = await CardT.findById(req.params.id).lean()
  if (!before) return res.status(404).json({ error: 'Card not found' })
  // The holder's details (the edit form sends them together with the balance): cleaned, length-limited, e-mail checked.
  const cut = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n)
  const wanted = balance == null || balance === '' ? undefined : Math.round(Number(balance) * 100) / 100
  if (wanted !== undefined && (!Number.isFinite(wanted) || wanted < 0 || wanted > 1000)) return res.status(400).json({ error: 'Saldo inválido (0 a 1000 €)' })
  const update = { balance: wanted, metadata }
  for (const [field, max] of [['name', 80], ['email', 120], ['phone', 30], ['contribuinte', 20]]) {
    if (req.body[field] !== undefined) update[field] = cut(req.body[field], max)
  }
  if (update.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.email)) return res.status(400).json({ error: 'Email inválido' })
  const set = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined))
  if (['name', 'email', 'phone', 'contribuinte'].some((f) => set[f] !== undefined && set[f] !== (before[f] || ''))) set.profileEditedAt = new Date()
  const upd = { $set: set }
  if (set.balance !== undefined && !process.env.SYNC_SERVER_URL) {
    // central server: the shop applies the DIFFERENCE (see Card.shopAdjustments)
    const d = Math.round((set.balance - (before.balance || 0)) * 100) / 100
    if (Math.abs(d) >= 0.005) upd.$push = { shopAdjustments: { $each: [{ opId: String(new mongoose.Types.ObjectId()), delta: d, reason: 'admin', at: new Date() }], $slice: -50 } }
  }
  const c = await CardT.findByIdAndUpdate(req.params.id, upd, { new: true })
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

// What the page shows before this shop has saved anything: the editor starts from it (a new shop gets a neutral page, never FreshBubbles' facts)
router.get('/landing/defaults', requireAdmin, async (req, res) => {
  const { landingBaseFor } = await import('../services/landingBase.js')
  const { base, neutral } = await landingBaseFor(req.tenantId)
  res.json({ neutral, content: base })
})

// Translations of the public page (freshbubbles.pt/en, /fr, /de, /es) — see services/landingTranslate.js
router.get('/landing/translations', requireAdmin, async (req, res) => {
  const [translations, status] = await Promise.all([getTranslations(req.tenantId), getStatus(req.tenantId)])
  const langs = Object.fromEntries(Object.entries(translations).map(([l, v]) => [l, { at: v.at, sourceHash: v.sourceHash }]))
  res.json({ enabled: translatorEnabled(), status, langs })
})
// Legal texts: the admin writes Portuguese only; saving them (setting legal.info, below) starts the automatic
// translation into en/fr/de/es in the background. These two endpoints let the page show progress or ask again.
router.get('/legal/status', requireAdmin, async (req, res) => {
  res.json(await getLegalStatus(req.tenantId))
})
router.post('/legal/translate', requireAdmin, async (req, res) => {
  const started = translateLegalSoon(req.tenantId)
  if (!started) return res.status(503).json({ error: 'O tradutor automático não está configurado neste servidor' })
  logAction(req, 'legal.translate_requested', 'Setting', 'legal.info', {})
  res.json({ started: true })
})

router.post('/landing/translate', requireAdmin, async (req, res) => {
  if (!translatorEnabled()) return res.status(409).json({ error: 'Automatic translation is not configured on this server (TRANSLATE_URL)' })
  translateLanding(req.tenantId).catch((err) => console.warn('[landing-translate]', err.message))
  logAction(req, 'landing.translate_requested', 'Setting', 'landingPage.content', {})
  res.status(202).json({ success: true })
})

// The small dictionary behind the page's translations (services/landingGlossary.js). Saving it translates again.
router.get('/landing/glossary', requireAdmin, async (req, res) => {
  const g = await loadGlossary(Setting, req.tenantId)
  res.json({ entries: g.entries, isDefault: g.isDefault })
})
router.put('/landing/glossary', requireAdmin, async (req, res) => {
  let entries
  try { entries = sanitizeGlossary(req.body && req.body.entries) } catch (err) { return res.status(400).json({ error: err.message }) }
  await Setting.findOneAndUpdate({ tenantId: req.tenantId, key: GLOSSARY_KEY }, { $set: { value: entries } }, { upsert: true })
  logAction(req, 'landing.glossary_saved', 'Setting', GLOSSARY_KEY, { entries: entries.length })
  translateLandingSoon(req.tenantId)
  res.json({ success: true, entries, isDefault: false })
})
router.delete('/landing/glossary', requireAdmin, async (req, res) => {
  await Setting.deleteOne({ tenantId: req.tenantId, key: GLOSSARY_KEY })
  logAction(req, 'landing.glossary_reset', 'Setting', GLOSSARY_KEY, {})
  translateLandingSoon(req.tenantId)
  const g = await loadGlossary(Setting, req.tenantId)
  res.json({ success: true, entries: g.entries, isDefault: true })
})

// Settings (simple key/value store)
router.get('/settings', requireAdmin, async (req, res) => {
  const SettingT = withTenant(Setting, req)
  // sync.* are this shop's private settings (a key waiting for the connection): never listed. Secrets are listed as set / not set,
  // never with their value (the screen that edits one reads it on its own, see GET /settings/:key).
  const SECRET_SETTINGS = new Set(['adminPin', 'payments.mbway.apiKey', 'shopmail.account'])
  const list = (await SettingT.find().lean())
    .filter((s) => !String(s.key).startsWith('sync.'))
    .map((s) => (SECRET_SETTINGS.has(s.key) ? { ...s, value: s.value ? '••••••' : s.value } : s))
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
  if (req.params.key === 'shopmail.account') return res.json({ key: req.params.key, value: null }) // see /shop-mail
  if (String(req.params.key).startsWith('sync.')) return res.json({ key: req.params.key, value: null })
  if (req.params.key === 'adminPin') {
    // Never the PIN or its hash: only whether one is set (the screen shows 'PIN definido').
    const row = await withTenant(Setting, req).findOne({ key: 'adminPin' }).lean()
    const { pinAge, PIN_SET_AT } = await import('../services/staffPin.js')
    const at = row?.value ? (await withTenant(Setting, req).findOne({ key: PIN_SET_AT }).lean())?.value : null
    return res.json({ key: 'adminPin', value: null, isSet: Boolean(row?.value), ...pinAge(at) })
  }
  const SettingT = withTenant(Setting, req)
  const s = await SettingT.findOne({ key: req.params.key }).lean()
  // Unconfigured is a normal answer, not a 404 — see the matching note on
  // the public /pos/settings/:key route. Every caller already reads
  // `.value`, so this is a drop-in replacement.
  res.json(s || { key: req.params.key, value: null })
})

// ---- Fluxos: every customer action as one log with its steps (models/flow.js) ---------------------------------------------------------
router.get('/flows', requireStaffRead, async (req, res) => {
  const FlowModel = (await import('../models/flow.js')).default
  const q = req.query || {}
  const filter = {}
  const from = q.from ? new Date(String(q.from)) : null
  const to = q.to ? new Date(String(q.to)) : null
  if (from && !Number.isNaN(from.getTime())) filter.startedAt = { ...(filter.startedAt || {}), $gte: from }
  if (to && !Number.isNaN(to.getTime())) filter.startedAt = { ...(filter.startedAt || {}), $lte: to }
  if (q.kind) filter.kind = { $in: String(q.kind).split(',').slice(0, 8) }
  if (q.status) filter.status = { $in: String(q.status).split(',').slice(0, 4) }
  if (q.method) filter.method = String(q.method).slice(0, 12)
  if (q.problems === '1' || q.problems === 'true') filter.problems = { $gt: 0 }
  if (q.machine) filter.machines = String(q.machine).slice(0, 60)
  if (q.q) {
    const rx = new RegExp(String(q.q).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [{ title: rx }, { machines: rx }, { cardCode: rx }, { 'steps.text': rx }]
  }
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200)
  const page = Math.max(parseInt(q.page, 10) || 0, 0)
  const FlowT = withTenant(FlowModel, req)
  const [rows, total] = await Promise.all([
    FlowT.find(filter).sort({ startedAt: -1 }).skip(page * limit).limit(limit).select('-steps').lean(),
    FlowT.count(filter),
  ])
  res.json({ total, page, limit, flows: rows })
})

router.get('/flows/:id', requireStaffRead, async (req, res) => {
  const FlowModel = (await import('../models/flow.js')).default
  const f = await withTenant(FlowModel, req).findOne(mongoose.isValidObjectId(req.params.id) ? { _id: req.params.id } : { flowId: String(req.params.id) }).lean()
  if (!f) return res.status(404).json({ error: 'Flow not found' })
  res.json(f)
})

// The shop's own e-mail identity (support address, optional own mailbox): services/shopMail.js
router.get('/shop-mail', requireAdmin, async (req, res) => {
  const { getShopMailPublic } = await import('../services/shopMail.js')
  res.json(await getShopMailPublic(req.tenantId))
})
router.put('/shop-mail', requireAdmin, async (req, res) => {
  const { saveShopMail, getShopMailPublic } = await import('../services/shopMail.js')
  try { await saveShopMail(req.tenantId, req.body || {}) } catch (err) { if (err.status) return res.status(err.status).json({ error: err.message }); throw err }
  const a = req.body?.account
  logAction(req, 'shopmail.update', 'Setting', 'shopmail', { supportEmail: req.body?.supportEmail, account: a ? { ...a, pass: a.pass ? '••••••' : undefined } : undefined })
  res.json(await getShopMailPublic(req.tenantId))
})
// Sends a test message to the support address through the shop's current setup, and says what happened.
router.post('/shop-mail/test', requireAdmin, async (req, res) => {
  const { getShopMail } = await import('../services/shopMail.js')
  const sm = await getShopMail(req.tenantId)
  const to = String(req.body?.to || sm.supportEmail || '').trim()
  if (!to) return res.status(400).json({ error: 'Defina primeiro o email de suporte' })
  try {
    await sendMail({ tenantId: req.tenantId, to, subject: 'Teste de email', text: 'Este é um email de teste: a configuração de email da loja está a funcionar.', html: renderEmailHtml({ title: 'Teste de email', bodyHtml: '<p>Este é um email de teste: a configuração de email da loja está a funcionar.</p>', brand: await getEmailBrand(req.tenantId) }) })
    res.json({ ok: true, to, viaOwnMailbox: !!sm.account })
  } catch (err) { res.status(502).json({ error: 'Não foi possível enviar: ' + (err.message || 'erro do servidor de email') }) }
})

router.post('/settings', requireAdmin, async (req, res) => {
  const { key, value } = req.body
  if (!key || typeof key !== 'string' || key.length > 100) return res.status(400).json({ error: 'Missing key' })
  // sync.* is the link between the shop and the central server (keys, pending key changes): written by the server itself, never from this form.
  if (key.startsWith('sync.')) return res.status(400).json({ error: 'Esta definição não pode ser alterada aqui' })
  if (key === 'adminPin.setAt') return res.status(400).json({ error: 'Esta definição não pode ser alterada aqui' }) // written with the PIN itself
  if (key === 'shopmail.account') return res.status(400).json({ error: 'Use /shop-mail' }) // the password must be encrypted on its way in
  // Seconds before unspent cash is paid back from the hopper; 0 = never. A bad value here
  // would either keep a customer's money forever or pay it out at once, so refuse it.
  if (key === 'creditRefundSeconds') {
    const n = Number(value)
    if (value === '' || value === null || !Number.isInteger(n) || n < 0 || n > 3600) {
      return res.status(400).json({ error: 'creditRefundSeconds must be a whole number of seconds from 0 to 3600' })
    }
  }
  // The staff PIN is stored as a hash (never the digits); an empty value removes it.
  let toStore = value
  if (key === 'adminPin') {
    const { PIN_FORMAT, hashPin, verifyPin, PIN_SET_AT } = await import('../services/staffPin.js')
    if (value === null || value === '' || value === undefined) toStore = null
    else if (!PIN_FORMAT.test(String(value))) return res.status(400).json({ error: 'O PIN deve ter entre 4 e 8 dígitos' })
    else {
      // a new PIN is a different PIN: saving the same digits again would only reset the week
      const cur = await withTenant(Setting, req).findOne({ key: 'adminPin' }).lean()
      if (cur?.value && await verifyPin(cur.value, String(value))) return res.status(400).json({ error: 'Escolha um PIN diferente do actual' })
      toStore = await hashPin(String(value))
    }
    // the day it was made goes with it (services/staffPin.js: a PIN lasts a week)
    await withTenant(Setting, req).findOneAndUpdate({ key: PIN_SET_AT }, { value: toStore ? new Date().toISOString() : null }, { upsert: true })
  }
  const SettingT = withTenant(Setting, req)
  const s = await SettingT.findOneAndUpdate({ key }, { value: toStore }, { upsert: true, new: true })
  // Secrets never go into the audit trail: it records that they changed, not what they are.
  logAction(req, 'setting.update', 'Setting', key, { value: (key === 'adminPin' || key === 'payments.mbway.apiKey') ? (value ? '••••••' : null) : value })
  if (key === 'landingPage.content') {
    // The public page also exists in other languages: refresh them from what was just saved.
    // Runs in the background — the save does not wait for, or depend on, the translation service.
    bumpLandingVersion() // the Portuguese page shows the new text at once
    translateLandingSoon(req.tenantId)
  }
  if (key === 'banners') {
    // The slides are written in Portuguese; translate them in the background for the other kiosk languages.
    translateBannersSoon(req.tenantId)
  }
  if (key === 'legal.info') {
    // The texts are written in Portuguese; translate them in the background (the save does not wait).
    translateLegalSoon(req.tenantId)
  }
  if (key === 'creditRefundSeconds') {
    // On the shop PC the running kiosk uses it from now on (no restart). On the central server
    // there is no hardware; the shop picks it up with its next pull (services/downlink.js).
    const { default: coinMachine } = await import('../services/coinMachine.js')
    if (coinMachine.settings) coinMachine.settings.creditRefundSeconds = Number(value)
  }
  // The hardware middleware caches these two at boot (a live coin/bill event
  // is on the hot path — not worth a DB round-trip per insert) — without this,
  // an edited mapping wouldn't take effect until the backend restarted.
  if (key === 'coinEqTable' || key === 'billEqTable') {
    const middleware = (await import('../services/middleware.js')).default
    middleware.loadEquivalenceTables().catch(() => { /* best-effort — falls back to taking effect on next restart */ })
  }
  res.json(s)
})

// Upload a logo file and persist the public URL as `branding.logo`
const uploadDirs = [
  path.resolve(process.cwd(), '../public/uploads'),
  path.resolve(process.cwd(), 'public/uploads'),
  path.resolve(process.cwd(), '../../public/uploads'),
]
// Exported so index.js can serve this exact directory at /uploads — local
// dev's own resolved path (repo-root public/uploads) is already covered by
// Vite serving its publicDir, but the Docker/cloud deployment (two separate
// containers, no shared filesystem) and the shop-kiosk single-process build
// both need the backend to serve what it just wrote; neither did before.
export let uploadDir = null
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
      // Always WebP, regardless of what was uploaded — notably smaller than
      // JPEG/PNG at the same visual quality, and one output format means one
      // code path instead of per-format quirks.
      const outName = `${base}-resized.webp`
      const outPath = path.join(uploadDir, outName)

      await sharp(origPath).rotate().resize({ width: 800, height: 800, fit: 'inside' }).webp({ quality: 82 }).toFile(outPath)

      // Output is always a different file (new extension) — remove the
      // original upload regardless.
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
      // Always WebP — see the logo upload's own comment on why.
      const outName = `${base}-resized.webp`
      const outPath = path.join(uploadDir, outName)

      // Wide format, matching the banner's own aspect ratio — a logo's
      // 800x800 square would just get cropped weirdly here.
      await sharp(origPath).rotate().resize({ width: 1600, height: 640, fit: 'cover' }).webp({ quality: 82 }).toFile(outPath)

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

// "a, b" or ["a", "b"] -> clean host names; anything that is not a plausible address is refused (never silently dropped)
function parseDomains(input) {
  if (input === undefined || input === null || input === '') return { list: [] }
  const raw = Array.isArray(input) ? input : String(input).split(/[\s,;]+/)
  const list = []
  for (const r of raw.map((x) => String(x).trim()).filter(Boolean)) {
    const h = normalizeHost(r)
    if (!h) return { error: `Endereço inválido: «${r}»` }
    if (!list.includes(h)) list.push(h)
  }
  return { list }
}

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
  const parsed = parseDomains(req.body.domains)
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  try {
    const t = await Tenant.create({ name, slug, domains: parsed.list })
    resetSoleTenantCache()
    res.json(t)
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: 'Um destes endereços já pertence a outra loja' })
    throw err
  }
})

// Update tenant (superadmins only)
router.put('/tenants/:id', requireSuperAdmin, async (req, res) => {
  const { name } = req.body
  const update = {}
  if (name) update.name = name
  if (req.body.domains !== undefined) {
    const parsed = parseDomains(req.body.domains)
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    update.domains = parsed.list
    // An address belongs to ONE shop (also checked here, not only by the database index, to answer with a clear message)
    if (parsed.list.length && await Tenant.exists({ _id: { $ne: req.params.id }, domains: { $in: parsed.list } })) {
      return res.status(409).json({ error: 'Um destes endereços já pertence a outra loja' })
    }
  }
  try {
    const t = await Tenant.findByIdAndUpdate(req.params.id, update, { new: true })
    if (!t) return res.status(404).json({ error: 'Tenant not found' })
    resetSoleTenantCache() // site addresses are cached for a short time
    logAction(req, 'tenant.update', 'Tenant', t._id, { name: t.name, domains: t.domains })
    res.json(t)
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: 'Um destes endereços já pertence a outra loja' })
    throw err
  }
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
    for (const name of [admin.username, kiosk.username]) {
      if (await usernameTaken(User, name)) return res.status(409).json({ error: `Já existe um utilizador com o nome «${name}»` })
    }
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
  if (!iface) return res.status(404).json({ error: 'Interface not found' })
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
  if (!price) return res.status(404).json({ error: 'Price not found' })
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
  if (!coupon) return res.status(404).json({ error: 'Coupon not found' })
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

  const bodyHtml = `<p>${escapeHtmlMultiline(message)}</p>`
  const html = renderEmailHtml({ title: subject, bodyHtml, brand: await getEmailBrand(req.tenantId) })

  let sent = 0
  let failed = 0
  for (const r of recipients) {
    try {
      await sendMail({ to: r.email, subject, text: message, html, tenantId: req.tenantId })
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
  if (!peripheral) return res.status(404).json({ error: 'Peripheral not found' })
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

// POST /admin/hopper/refill — coins brought from outside into the hopper (stock +, booked as float).
router.post('/hopper/refill', requireAdmin, async (req, res) => {
  const { refillHopper } = await import('../services/hopperRefill.js')
  const { status, body } = await refillHopper(req, req.body || {})
  if (status === 200) logAction(req, 'hopper.refill', 'Peripheral', null, { coins: req.body?.coins })
  res.status(status).json(body)
})

// POST /admin/hopper/empty — pay out everything the hopper holds (coins drop into the tray: a container must be under it).
// On the shop PC it runs right here; on the central server, which has no hardware, it is queued for the shop (picked up within
// ~5 s, see services/remoteCommands.js) and the page follows it through GET /admin/commands/:id.
router.post('/hopper/empty', requireAdmin, async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirme o esvaziamento' })
  const { default: coinMachine } = await import('../services/coinMachine.js')
  if (coinMachine.running) {
    const r = await coinMachine.emptyHopper()
    logAction(req, 'hopper.empty', 'Peripheral', null, { dispensed: r.dispensed, error: r.error })
    return res.json({ queued: false, ...r })
  }
  const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('_id').lean()
  if (kiosks.length === 0) return res.status(409).json({ error: 'Nenhum quiosque registado para esta loja' })
  const SyncCommandT = withTenant(SyncCommand, req)
  const cmds = []
  for (const k of kiosks) cmds.push(await SyncCommandT.create({ kioskId: k._id, type: 'empty_hopper', payload: {} }))
  logAction(req, 'hopper.empty_requested', 'Peripheral', null, {})
  res.json({ queued: true, commandIds: cmds.map((c) => c._id) })
})

// POST /admin/cards/gift — a card for a customer, for free; credit default 0. On the shop PC it runs here; on the central server it is
// queued for the shop (like Iniciar), which ejects the card: present it at the reader to activate it.
router.post('/cards/gift', requireAdmin, async (req, res) => {
  const credit = Number(req.body?.credit ?? 0)
  const info = { credit, customerName: req.body?.customerName, customerEmail: req.body?.customerEmail, customerPhone: req.body?.customerPhone, customerContribuinte: req.body?.customerContribuinte, by: `admin ${req.userModel?.username || ''}`.trim() }
  const { default: coinMachine } = await import('../services/coinMachine.js')
  if (coinMachine.running) {
    try {
      const { issueGiftCard } = await import('../services/giftCard.js')
      return res.json({ queued: false, ...(await issueGiftCard(req, coinMachine, info)) })
    } catch (e) { return res.status(e.status || 500).json({ error: e.message }) }
  }
  const { maxGiftCredit } = await import('../services/giftCard.js')
  if (!(credit >= 0) || credit > maxGiftCredit()) return res.status(400).json({ error: `Crédito inválido (0 a ${maxGiftCredit()} €)` })
  const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('_id lastSeen').lean()
  if (kiosks.length === 0) return res.status(409).json({ error: 'Nenhum quiosque registado para esta loja' })
  if (!kiosks.some((k) => shopOnline(k.lastSeen))) return res.status(409).json({ error: 'A loja está sem ligação à internet neste momento. Tente de novo quando voltar.', code: 'shop-offline' })
  const SyncCommandT = withTenant(SyncCommand, req)
  const cmds = []
  for (const k of kiosks) cmds.push(await SyncCommandT.create({ kioskId: k._id, type: 'gift_card', payload: info }))
  logAction(req, 'card.gift_requested', 'Card', null, { credit })
  res.json({ queued: true, commandIds: cmds.map((c) => c._id) })
})

// POST /admin/hardware/reinit — put the readers (notes, coins, hopper, cards) back in order without restarting the PC. On the shop PC it
// runs here; on the central server it is queued for the shop.
router.post('/hardware/reinit', requireAdmin, async (req, res) => {
  const { default: coinMachine } = await import('../services/coinMachine.js')
  if (coinMachine.running) {
    try {
      const r = await coinMachine.reinitHardware('admin')
      logAction(req, 'hardware.reinit', 'Peripheral', null, r)
      return res.json({ queued: false, ...r })
    } catch (e) { return res.status(409).json({ error: e.message }) }
  }
  const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('_id').lean()
  if (kiosks.length === 0) return res.status(409).json({ error: 'Nenhum quiosque registado para esta loja' })
  const SyncCommandT = withTenant(SyncCommand, req)
  const cmds = []
  for (const k of kiosks) cmds.push(await SyncCommandT.create({ kioskId: k._id, type: 'reinit_hardware', payload: {} }))
  logAction(req, 'hardware.reinit_requested', 'Peripheral', null, {})
  res.json({ queued: true, commandIds: cmds.map((c) => c._id) })
})

// GET /admin/hardware/health — is the controller answering? (only meaningful on the shop PC)
router.get('/hardware/health', requireAdmin, async (req, res) => {
  const { default: coinMachine } = await import('../services/coinMachine.js')
  res.json(coinMachine.running ? coinMachine.controllerHealth() : { running: false })
})

// POST /admin/hardware/reset-link — ask the bridge for a brand-new session with the controller (when it stops answering). Not blocked by a
// customer: it only reconnects, nothing is sent to the machines. On the central server it is queued for the shop.
router.post('/hardware/reset-link', requireAdmin, async (req, res) => {
  const { default: coinMachine } = await import('../services/coinMachine.js')
  if (coinMachine.running) {
    try {
      const r = await coinMachine.resetControllerLink('admin')
      logAction(req, 'hardware.link_reset', 'Peripheral', null, r)
      return res.json({ queued: false, ...r })
    } catch (e) { return res.status(409).json({ error: e.message }) }
  }
  const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('_id').lean()
  if (kiosks.length === 0) return res.status(409).json({ error: 'Nenhum quiosque registado para esta loja' })
  const SyncCommandT = withTenant(SyncCommand, req)
  const cmds = []
  for (const k of kiosks) cmds.push(await SyncCommandT.create({ kioskId: k._id, type: 'reset_link', payload: {} }))
  logAction(req, 'hardware.link_reset_requested', 'Peripheral', null, {})
  res.json({ queued: true, commandIds: cmds.map((c) => c._id) })
})

// POST /admin/credit/keep — the cash inserted and not spent STAYS in the machine (not paid back, not kept as credit). Only when the operator
// presses it; everything else refunds as usual. On the central server it is queued for the shop.
router.post('/credit/keep', requireAdmin, async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirme' })
  const { default: coinMachine } = await import('../services/coinMachine.js')
  if (coinMachine.running) {
    try {
      const r = await coinMachine.keepCredit({ by: 'admin' })
      logAction(req, 'credit.kept', 'Sale', null, r)
      return res.json({ queued: false, ...r })
    } catch (e) { return res.status(409).json({ error: e.message }) }
  }
  const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('_id').lean()
  if (kiosks.length === 0) return res.status(409).json({ error: 'Nenhum quiosque registado para esta loja' })
  const SyncCommandT = withTenant(SyncCommand, req)
  const cmds = []
  for (const k of kiosks) cmds.push(await SyncCommandT.create({ kioskId: k._id, type: 'keep_credit', payload: {} }))
  logAction(req, 'credit.keep_requested', 'Sale', null, {})
  res.json({ queued: true, commandIds: cmds.map((c) => c._id) })
})

// POST /admin/cards/blank-reader — wipe the card that is in the reader (name, tax id, balance) and forget it. On the shop PC it runs
// here; on the central server it is queued for the shop, like Esvaziar hopper. EXPERIMENTAL: see Middleware.blankCardViaGateway.
router.post('/cards/blank-reader', requireAdmin, async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirme' })
  const { default: coinMachine } = await import('../services/coinMachine.js')
  if (coinMachine.running) {
    try {
      const r = await coinMachine.blankCardAtReader()
      logAction(req, 'card.blanked', 'Card', null, r)
      return res.json({ queued: false, ...r })
    } catch (e) { return res.status(409).json({ error: e.message }) }
  }
  const kiosks = await User.find({ tenantId: req.tenantId, role: 'KIOSK' }).select('_id').lean()
  if (kiosks.length === 0) return res.status(409).json({ error: 'Nenhum quiosque registado para esta loja' })
  const SyncCommandT = withTenant(SyncCommand, req)
  const cmds = []
  for (const k of kiosks) cmds.push(await SyncCommandT.create({ kioskId: k._id, type: 'blank_card', payload: {} }))
  logAction(req, 'card.blank_requested', 'Card', null, {})
  res.json({ queued: true, commandIds: cmds.map((c) => c._id) })
})

// GET /admin/commands/:id — state and result of a command queued for the shop.
router.get('/commands/:id', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' })
  const c = await withTenant(SyncCommand, req).findById(req.params.id).lean()
  if (!c) return res.status(404).json({ error: 'Command not found' })
  res.json({ status: c.status, error: c.error, result: c.result, type: c.type })
})

// POST /admin/day-close/adjust-float — add cash straight to the float (e.g.
// seeding a starting till), without it counting as bankable sales money.
router.post('/day-close/adjust-float', requireAdmin, async (req, res) => {
  const { createFloatAdjustment } = await import('../services/dayClose.js')
  const { status, body } = await createFloatAdjustment(req, req.body)
  if (status === 200) logAction(req, 'daycose.float_adjustment', 'DayClose', body._id, { amount: req.body?.amount })
  res.status(status).json(body)
})

// POST /admin/day-close/:id/email — email a Z-report summary of one close.
router.post('/day-close/:id/email', requireStaffRead, async (req, res) => {
  const { emailDayCloseReceipt } = await import('../services/dayClose.js')
  const { status, body } = await emailDayCloseReceipt(req, req.params.id, req.body?.email)
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
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: 'Europe/Lisbon' } }, // the shop's day, not UTC's
        // Same rule as the day close: money counts when it comes in. What is spent from a card was counted when the card was loaded.
        total: { $sum: { $cond: [{ $eq: ["$method", "card"] }, 0, "$amount"] } },
        mbway: { $sum: { $cond: [{ $eq: ["$method", "mbway"] }, "$amount", 0] } },
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
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: 'Europe/Lisbon' } }, // the shop's day, not UTC's
        // Same rule as the day close: money counts when it comes in. What is spent from a card was counted when the card was loaded.
        total: { $sum: { $cond: [{ $eq: ["$method", "card"] }, 0, "$amount"] } },
        mbway: { $sum: { $cond: [{ $eq: ["$method", "mbway"] }, "$amount", 0] } },
        cash: { $sum: { $cond: [{ $eq: ["$method", "cash"] }, "$amount", 0] } },
        card: { $sum: { $cond: [{ $eq: ["$method", "card"] }, "$amount", 0] } }
    } },
    { $sort: { _id: 1 } }
  ])
  const lines = [['Data', 'Dinheiro', 'MB WAY', 'Total recebido', 'Gasto de cartões (já contado na recarga)'].map(csvCell).join(',')]
  for (const row of stats) {
    lines.push([row._id, row.cash.toFixed(2), row.mbway.toFixed(2), row.total.toFixed(2), row.card.toFixed(2)].map(csvCell).join(','))
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

// --- Central sync (offline queue) -------------------------------------------
// The site keeps working with no internet; sales, card balances and day-closes
// wait in a durable queue and are pushed to the central server when it is
// reachable (services/uplink.js). These let the operator see and nudge it.
async function getUplink() {
  const { default: coinMachine } = await import('../services/coinMachine.js')
  return coinMachine.uplink || null
}

router.get('/sync/status', requireAdmin, async (req, res) => {
  const uplink = await getUplink()
  if (!uplink) return res.json({ enabled: false, pending: 0, dead: 0, online: null })
  res.json(await uplink.status())
})

// Send everything due right now (instead of waiting for the next 30 s tick).
router.post('/sync/flush', requireAdmin, async (req, res) => {
  const uplink = await getUplink()
  if (!uplink || !uplink.enabled) return res.status(409).json({ error: 'Central sync is not configured' })
  uplink.nextTryAt = 0
  res.json({ result: await uplink.flush(), status: await uplink.status() })
})

// Records the server rejected ten times: try them again (after fixing the cause).
router.post('/sync/retry-dead', requireAdmin, async (req, res) => {
  const uplink = await getUplink()
  if (!uplink || !uplink.enabled) return res.status(409).json({ error: 'Central sync is not configured' })
  res.json(await uplink.retryDead())
})

export default router

/**
 * The superadmin's view of all shops: status at a glance, creating a shop in one go, re-sending the customer's e-mail,
 * checking the site address's DNS, suspending a shop. Everything here is SUPERADMIN-only and audited.
 */
import express from 'express'
import Tenant from '../models/tenant.js'
import User from '../models/user.js'
import Machine from '../models/machine.js'
import Sale from '../models/sale.js'
import Setting from '../models/setting.js'
import Price from '../models/price.js'
import { requireSuperAdmin } from '../middleware/auth.js'
import { logAction } from '../services/auditLog.js'
import { stageNewKey, groupKey, newKioskKey } from '../services/apiKeys.js'
import { buildInstaller, installerFileName } from '../services/installerFile.js'
import { DEFAULT_SITE_URL } from '../views/landing.js'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { usernameTaken } from '../services/ensureIndexes.js'
import { createStore, sendWelcomeEmail, checkDns, dnsRecords, serverIp } from '../services/storeProvisioning.js'
import { resetSoleTenantCache } from '../middleware/tenant.js'
import { resetDomainCache, parseDomains, withWww } from '../services/tenantDomains.js'
import { resetTenantStatusCache } from '../services/tenantStatus.js'

const router = express.Router()
router.use(requireSuperAdmin)

const ONLINE_MS = 5 * 60_000
/** Midnight of today in Lisbon, as an instant. */
function lisbonMidnight() {
  const now = new Date()
  const lis = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Lisbon' }))
  const mid = new Date(lis); mid.setHours(0, 0, 0, 0)
  return new Date(now.getTime() - (lis.getTime() - mid.getTime()))
}

/** The checklist of a new shop: what it still has to define before it can sell. */
export async function startChecklist(tenantId) {
  const [machines, prices, pin, email] = await Promise.all([
    Machine.countDocuments({ tenantId }), Price.countDocuments({ tenantId }),
    Setting.exists({ tenantId, key: 'adminPin' }), Setting.exists({ tenantId, key: 'alerts.email' }),
  ])
  return [
    { key: 'prices', label: 'Definir os preços', done: prices > 0 },
    { key: 'machines', label: 'Criar as máquinas', done: machines > 0 },
    { key: 'pin', label: 'Definir o PIN do staff', done: !!pin },
    { key: 'alerts', label: 'Definir o email de alertas', done: !!email },
  ]
}

router.get('/overview', async (req, res) => {
  const since = lisbonMidnight()
  const tenants = await Tenant.find().sort({ createdAt: 1 }).lean()
  const out = []
  for (const t of tenants) {
    const [machines, users, kiosk, rev, checklist] = await Promise.all([
      Machine.countDocuments({ tenantId: t._id }),
      User.countDocuments({ tenantId: t._id }),
      User.findOne({ tenantId: t._id, role: 'KIOSK' }).sort({ lastSeen: -1 }).select('username lastSeen').lean(),
      Sale.aggregate([{ $match: { tenantId: t._id, createdAt: { $gte: since }, type: { $in: ['payment', 'recharge', 'card_purchase'] } } }, { $group: { _id: null, total: { $sum: '$amount' }, n: { $sum: 1 } } }]),
      startChecklist(t._id),
    ])
    const seen = kiosk && kiosk.lastSeen ? new Date(kiosk.lastSeen) : null
    out.push({
      _id: t._id, name: t.name, slug: t.slug, domains: t.domains || [], status: t.status || 'active', customerEmail: t.customerEmail || '',
      domainState: t.domainState || { state: 'none' }, welcomeEmail: t.welcomeEmail || {}, createdAt: t.createdAt,
      machines, users, hasKiosk: !!kiosk, kioskLastSeen: seen, kioskOnline: !!seen && Date.now() - seen.getTime() < ONLINE_MS,
      todayRevenue: rev[0] ? Math.round(rev[0].total * 100) / 100 : 0, todaySales: rev[0] ? rev[0].n : 0,
      checklist,
    })
  }
  res.json({ serverIp: serverIp(), stores: out })
})

router.post('/', async (req, res) => {
  try {
    const { tenant, admin, emailError } = await createStore(req.body || {})
    logAction(req, 'tenant.create', 'Tenant', tenant._id, { name: tenant.name, domains: tenant.domains, customerEmail: tenant.customerEmail ? '•••' : '' })
    res.status(201).json({ tenant, admin: { id: admin._id, username: admin.username }, emailSent: !!tenant.welcomeEmail?.sentAt, emailError, dns: dnsRecords(tenant.domains || []) })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    if (err?.code === 11000) return res.status(409).json({ error: 'Já existe uma loja ou utilizador com estes dados' })
    throw err
  }
})

router.post('/:id/resend-welcome', async (req, res) => {
  const t = await Tenant.findById(req.params.id)
  if (!t) return res.status(404).json({ error: 'Loja não encontrada' })
  if (!t.customerEmail) return res.status(400).json({ error: 'Esta loja não tem email do cliente' })
  const admin = await User.findOne({ tenantId: t._id, role: 'ADMIN' }).sort({ createdAt: 1 })
  if (!admin) return res.status(400).json({ error: 'Esta loja não tem administrador' })
  try { await sendWelcomeEmail(t, admin) } catch (err) {
    t.welcomeEmail = { sentAt: null, error: err.message || 'falhou' }; await t.save()
    return res.status(502).json({ error: 'Não foi possível enviar o email: ' + (err.message || 'erro do servidor de email') })
  }
  logAction(req, 'tenant.resend_welcome', 'Tenant', t._id, {})
  res.json({ ok: true })
})

/**
 * "Gerar instalação do posto": the file for the customer. Makes the shop's kiosk user if it has none and STAGES a new key
 * (an existing PC keeps working until the new one connects for the first time). The key is only inside the file, shown once.
 */
router.post('/:id/installation', async (req, res) => {
  const t = await Tenant.findById(req.params.id)
  if (!t) return res.status(404).json({ error: 'Loja não encontrada' })
  const hw = req.body?.hardware || {}
  const ip = (v, d) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(String(v || '').trim()) ? String(v).trim() : d)
  const port = Number(hw.controllerPort)
  let kiosk = await User.findOne({ tenantId: t._id, role: 'KIOSK' }).sort({ createdAt: 1 })
  let key
  if (!kiosk) {
    let name = `posto-${t.slug}`.slice(0, 40)
    for (let i = 2; await usernameTaken(User, name); i++) name = `posto-${t.slug}-${i}`.slice(0, 40)
    key = newKioskKey()
    kiosk = await User.create({ tenantId: t._id, username: name, role: 'KIOSK', password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10), apiKey: null, apiKeyNext: key, apiKeyNextAt: new Date() })
  } else {
    key = await stageNewKey(t._id, kiosk._id)
  }
  const file = buildInstaller({
    shopName: t.name, slug: t.slug, tenantId: String(t._id),
    serverUrl: `${DEFAULT_SITE_URL}/api`, key, supportEmail: process.env.SUPPORT_EMAIL || '',
    hardware: { pcIp: ip(hw.pcIp, '192.168.2.190'), controllerHost: ip(hw.controllerHost, '192.168.2.201'), controllerPort: port > 0 && port < 65536 ? port : 16852 },
  })
  logAction(req, 'tenant.installation_generated', 'Tenant', t._id, { kiosk: kiosk.username, note: 'new kiosk key staged; shown only inside the file' })
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${installerFileName(t.slug)}"`)
  res.setHeader('Cache-Control', 'no-store')
  res.send(file)
})

router.get('/:id/dns', async (req, res) => {
  const t = await Tenant.findById(req.params.id).lean()
  if (!t) return res.status(404).json({ error: 'Loja não encontrada' })
  const result = await checkDns(t.domains || [])
  const allOk = result.length > 0 && result.every((r) => r.ok)
  if (t.domainState?.state === 'pending_dns' || t.domainState?.state === 'failed') {
    await Tenant.updateOne({ _id: t._id }, { $set: { 'domainState.checkedAt': new Date(), 'domainState.message': allOk ? 'DNS certo, a aguardar certificado' : (result.find((r) => !r.ok)?.problem || ''), 'domainState.state': allOk ? 'pending_cert' : 'pending_dns' } })
  }
  res.json({ serverIp: serverIp(), records: dnsRecords(t.domains || []), result, allOk })
})

router.put('/:id/domains', async (req, res) => {
  const parsed = parseDomains(req.body?.domains)
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  const list = [...new Set(parsed.list.flatMap((h) => withWww(h)))]
  if (list.length && await Tenant.exists({ _id: { $ne: req.params.id }, domains: { $in: list } })) return res.status(409).json({ error: 'Um destes endereços já pertence a outra loja' })
  const t = await Tenant.findByIdAndUpdate(req.params.id, { $set: { domains: list, 'domainState.state': list.length ? 'pending_dns' : 'none', 'domainState.requestedAt': list.length ? new Date() : null, 'domainState.message': '' } }, { new: true })
  if (!t) return res.status(404).json({ error: 'Loja não encontrada' })
  resetSoleTenantCache(); resetDomainCache()
  logAction(req, 'tenant.domains', 'Tenant', t._id, { domains: list })
  res.json(t)
})

router.put('/:id/status', async (req, res) => {
  const status = req.body?.status
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Estado inválido' })
  if (status === 'suspended' && String(req.params.id) === String(req.tenantId)) return res.status(400).json({ error: 'Não pode suspender a loja em que está a trabalhar' })
  const t = await Tenant.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true })
  if (!t) return res.status(404).json({ error: 'Loja não encontrada' })
  resetSoleTenantCache(); resetDomainCache(); resetTenantStatusCache()
  logAction(req, 'tenant.status', 'Tenant', t._id, { status })
  res.json(t)
})

export default router

/**
 * What a shop's PC asks the central server for while installing and updating itself (kiosk key required):
 *   GET  /installer/version  the version of the program the server is running
 *   GET  /installer/bundle   the program itself (a zip made at deploy time, see scripts/hetzner-autodeploy.sh)
 *   POST /installer/report   how the installation went (kept in the shop's audit trail)
 */
import express from 'express'
import fs from 'fs'
import path from 'path'
import { requireKiosk } from '../middleware/auth.js'
import AuditLog from '../models/auditLog.js'
import User from '../models/user.js'
import rateLimit from 'express-rate-limit'
import { limitKey } from '../middleware/limitKey.js'
import { normalizeKey } from '../services/apiKeys.js'

const router = express.Router()
const releaseDir = () => process.env.RELEASE_DIR || '/release'

/**
 * Which shop does this key belong to? Used by a shop PC that is locked to its shop (SHOP_TENANT_ID) before it accepts a new key.
 * Looks the key up WITHOUT using it (a staged key is not promoted by asking), so a mistyped key cannot cut anybody off.
 */
const whoamiLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: limitKey, message: { error: 'Too many attempts' } })
router.get('/whoami', whoamiLimiter, async (req, res) => {
  const raw = String(req.headers.authorization || '').replace(/^ApiKey\s+/i, '')
  const key = normalizeKey(raw)
  if (!key) return res.status(401).json({ error: 'Missing key' })
  const u = await User.findOne({ role: 'KIOSK', $or: [{ apiKey: raw }, { apiKey: key }, { apiKeyNext: key }] }).select('tenantId').lean()
  if (!u) return res.status(401).json({ error: 'Invalid key' })
  res.json({ tenantId: String(u.tenantId) })
})

router.get('/version', requireKiosk, (req, res) => {
  let version = ''
  try { version = fs.readFileSync(path.join(releaseDir(), 'version.txt'), 'utf8').trim() } catch { /* no release published */ }
  if (!version) return res.status(503).json({ error: 'Nenhuma versão publicada' })
  res.json({ version })
})

router.get('/bundle', requireKiosk, (req, res) => {
  const file = path.join(releaseDir(), 'app.zip')
  if (!fs.existsSync(file)) return res.status(503).json({ error: 'Nenhuma versão publicada' })
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Length', fs.statSync(file).size)
  res.setHeader('Cache-Control', 'no-store')
  fs.createReadStream(file).pipe(res)
})

router.post('/report', requireKiosk, async (req, res) => {
  const b = req.body || {}
  await AuditLog.create({
    tenantId: req.tenantId, actorUsername: req.userModel.username,
    action: b.ok ? 'installer.ok' : 'installer.failed', targetType: 'User', targetId: String(req.userModel._id),
    details: { message: String(b.message || '').slice(0, 500), machine: String(b.machine || '').slice(0, 80), version: String(b.version || '').slice(0, 60), log: String(b.log || '').slice(-8000) },
  })
  res.json({ ok: true })
})

export default router

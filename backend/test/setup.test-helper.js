import mongoose from 'mongoose'
import '../src/services/asyncRoutes.js' // as in src/index.js: a rejected async handler answers 500 instead of hanging
import bcrypt from 'bcryptjs'
import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret'
// Machine activations are spaced out on real hardware; tests do not wait for that pause.
process.env.ACTIVATION_GAP_MS = process.env.ACTIVATION_GAP_MS || '0'
// The login is limited to 6 tries per quarter hour per address; the whole test run shares one address.
process.env.LOGIN_LIMIT_OFF = 'true'

/**
 * Mint a token directly, the same way POST /api/auth/login does — for tests
 * that just need an authenticated context and aren't testing login itself.
 *
 * /auth/login is rate-limited to 6/15min per IP, and that limiter is a
 * module-level singleton shared across every test file in one `npm test`
 * run (see backend.test.js's own note on this). With several test files each
 * wanting a token, real HTTP logins add up fast and 429 the whole suite —
 * this sidesteps that entirely for the common "just give me a token" case.
 */
export function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role, username: user.username }, process.env.JWT_SECRET, { expiresIn: '8h' })
}

// Requires a reachable MongoDB (same as running the app itself — no
// downloaded-binary in-memory server, which is unreliable across
// architectures/CI). Defaults to a separate local test database so it never
// touches real dev data.
const TEST_MONGODB_URL = process.env.MONGODB_TEST_URL || 'mongodb://localhost:27017/washstore_test'

// readyState-guarded so two test files can each call start/stop around their
// own suite without fighting over one shared mongoose connection — a second
// connect() while already connected (or a disconnect() while already
// disconnected) is otherwise a no-op that still resolves, but leaves the
// connection in a state where a same-tick query can silently miss.
export async function startTestDb() {
  if (mongoose.connection.readyState === 1) return
  await mongoose.connect(TEST_MONGODB_URL)
}

export async function stopTestDb() {
  if (mongoose.connection.readyState !== 1) return
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}

export async function clearTestDb() {
  const collections = mongoose.connection.collections
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({})
  }
}

// Minimal app mirroring index.js's route wiring, without booting the
// hardware-agent server, coin machine, or a real HTTP listener.
export async function buildTestApp() {
  const { resolveTenant } = await import('../src/middleware/tenant.js')
  const authRoutes = (await import('../src/routes/auth.js')).default
  const adminRoutes = (await import('../src/routes/admin.js')).default
  const posRoutes = (await import('../src/routes/pos.js')).default
  const gatewaysRoutes = (await import('../src/routes/gateways.js')).default
  const syncRoutes = (await import('../src/routes/sync.js')).default
  const wifiRoutes = (await import('../src/routes/wifi.js')).default
  const mbwayLinkRoutes = await import('../src/routes/mbwayLink.js')

  const app = express()
  app.disable('x-powered-by') // as in src/index.js
  app.use(cors())
  app.use(express.json())
  app.use((await import('../src/middleware/noOperators.js')).noOperators) // as in src/index.js
  app.use(resolveTenant)
  app.use('/api/auth', authRoutes)
  app.use('/api/installer', (await import('../src/routes/installer.js')).default)
  app.use('/api/admin/stores', (await import('../src/routes/stores.js')).default)
  app.use('/api/admin', adminRoutes)
  app.use('/api/pos', posRoutes)
  app.use('/api', posRoutes)
  app.use('/api/gateways', gatewaysRoutes)
  app.use('/api/sync', syncRoutes)
  app.use('/api/middleware', (await import('../src/routes/middleware.js')).default)
  app.use('/api/wifi', wifiRoutes)
  app.use('/api/mbway-link', mbwayLinkRoutes.shopRouter)
  app.use(mbwayLinkRoutes.publicRouter)
  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' })) // as in src/index.js
  // Mirrors index.js: without this an async throw would kill the test process
  // instead of surfacing as a 500.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    res.status(err.status || 500).json({ error: 'Internal server error' })
  })
  return app
}

export async function seedTenantAndUsers() {
  const Tenant = (await import('../src/models/tenant.js')).default
  const User = (await import('../src/models/user.js')).default

  const tenant = await Tenant.create({ name: 'Test Tenant', slug: 'test-tenant' })

  const adminHash = await bcrypt.hash('admin1234', 10)
  const admin = await User.create({
    username: 'admin', email: 'admin@test.local', password: adminHash,
    role: 'SUPERADMIN', tenantId: tenant._id,
  })

  const kioskHash = await bcrypt.hash('kiosk1234', 10)
  const kiosk = await User.create({
    username: 'kiosk', email: 'kiosk@test.local', password: kioskHash,
    role: 'KIOSK', apiKey: 'test-kiosk-api-key', tenantId: tenant._id,
  })

  return { tenant, admin, kiosk }
}

import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import express from 'express'
import cors from 'cors'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret'

// Requires a reachable MongoDB (same as running the app itself — no
// downloaded-binary in-memory server, which is unreliable across
// architectures/CI). Defaults to a separate local test database so it never
// touches real dev data.
const TEST_MONGODB_URL = process.env.MONGODB_TEST_URL || 'mongodb://localhost:27017/washstore_test'

export async function startTestDb() {
  await mongoose.connect(TEST_MONGODB_URL)
}

export async function stopTestDb() {
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

  const app = express()
  app.use(cors())
  app.use(express.json())
  app.use(resolveTenant)
  app.use('/api/auth', authRoutes)
  app.use('/api/admin', adminRoutes)
  app.use('/api/pos', posRoutes)
  app.use('/api', posRoutes)
  app.get('/api/health', (req, res) => res.json({ ok: true }))
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

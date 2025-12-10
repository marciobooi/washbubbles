const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const path = require('path')

async function loadModels() {
  require(path.join(__dirname, '..', 'dist')) // in case someone built; not necessary here
}

async function main() {
  const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/washstore'
  await mongoose.connect(MONGODB_URL)

  // Dynamically load models
  const User = require('../src/models/user.js').default
  const Machine = require('../src/models/machine.js').default

  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234'
  const kioskPassword = process.env.KIOSK_PASSWORD || 'kiosk1234'
  const kioskApiKey = process.env.KIOSK_API_KEY || require('crypto').randomBytes(24).toString('hex')
  const adminHash = await bcrypt.hash(adminPassword, 10)
  const kioskHash = await bcrypt.hash(kioskPassword, 10)

  // ensure admin user exists (upsert style)
  await User.updateOne({ email: 'admin@washstore.local' }, { $set: { email: 'admin@washstore.local', password: adminHash, role: 'ADMIN' } }, { upsert: true })
  // ensure kiosk user exists (upsert style)
  await User.updateOne({ email: 'kiosk@washstore.local' }, { $set: { email: 'kiosk@washstore.local', password: kioskHash, role: 'KIOSK', apiKey: kioskApiKey } }, { upsert: true })

  // Insert sample machines if none exist
  const count = await Machine.countDocuments()
  if (count === 0) {
    await Machine.create([{ name: 'Machine A' }, { name: 'Machine B' }])
  }

  console.log('Seed complete - admin user: admin@washstore.local (password: ' + adminPassword + ')')
  console.log('Seed complete - kiosk user: kiosk@washstore.local (password: ' + kioskPassword + ')')
  console.log('Kiosk API key: ' + kioskApiKey)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

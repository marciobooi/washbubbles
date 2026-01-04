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
  const Setting = require('../src/models/setting.js').default

  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234'
  const kioskPassword = process.env.KIOSK_PASSWORD || 'kiosk1234'
  const kioskApiKey = process.env.KIOSK_API_KEY || require('crypto').randomBytes(24).toString('hex')
  const adminHash = await bcrypt.hash(adminPassword, 10)
  const kioskHash = await bcrypt.hash(kioskPassword, 10)

  // ensure admin user exists (upsert style)
  await User.updateOne({ $or: [{ username: 'admin' }, { email: 'admin@washstore.local' }] }, { $set: { username: 'admin', email: 'admin@washstore.local', password: adminHash, role: 'ADMIN' } }, { upsert: true })
  // ensure kiosk user exists (upsert style)
  await User.updateOne({ $or: [{ username: 'kiosk' }, { email: 'kiosk@washstore.local' }] }, { $set: { username: 'kiosk', email: 'kiosk@washstore.local', password: kioskHash, role: 'KIOSK', apiKey: kioskApiKey } }, { upsert: true })

  // Insert sample machines if none exist
  const count = await Machine.countDocuments()
  if (count === 0) {
    await Machine.create([{ name: 'Machine A' }, { name: 'Machine B' }])
  }

  // Insert default settings for coin/bill equivalence tables and bonuses
  await Setting.updateOne(
    { key: 'coinEqTable' },
    { 
      $setOnInsert: { 
        key: 'coinEqTable', 
        value: [
          { key: '0x01', value: 0.05 },
          { key: '0x02', value: 0.10 },
          { key: '0x03', value: 0.20 },
          { key: '0x04', value: 0.50 },
          { key: '0x05', value: 1.00 },
          { key: '0x06', value: 2.00 }
        ] 
      } 
    },
    { upsert: true }
  )

  await Setting.updateOne(
    { key: 'billEqTable' },
    { 
      $setOnInsert: { 
        key: 'billEqTable', 
        value: [
          { key: '0x10', value: 5 },
          { key: '0x11', value: 10 },
          { key: '0x12', value: 20 }
        ] 
      } 
    },
    { upsert: true }
  )

  await Setting.updateOne(
    { key: 'rechargeCoinBonus' },
    { $setOnInsert: { key: 'rechargeCoinBonus', value: 0 } },
    { upsert: true }
  )

  await Setting.updateOne(
    { key: 'rechargeBillBonus' },
    { $setOnInsert: { key: 'rechargeBillBonus', value: 0 } },
    { upsert: true }
  )

  await Setting.updateOne(
    { key: 'autoCharge' },
    { $setOnInsert: { key: 'autoCharge', value: false } },
    { upsert: true }
  )

  console.log('Seed complete - admin user: admin (password: ' + adminPassword + ')')
  console.log('Seed complete - kiosk user: kiosk (password: ' + kioskPassword + ')')
  console.log('Kiosk API key: ' + kioskApiKey)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

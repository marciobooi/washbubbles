const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const path = require('path')

async function loadModels() {
  require(path.join(__dirname, '..', 'dist')) // in case someone built; not necessary here
}

// Equivalence tables. Codes are matched as exact strings.
//  - Direct serial ccTalk: the byte in "0x.." hex form.
//  - Shop low-level controller (LOWLEVEL_* set): the controller's own decimal codes,
//    i.e. the tables hard-coded in the legacy kiosk (coins 3-8, bills sent as their
//    euro value). Seeding hex here would credit the WRONG coin ("3" -> 0x03 = 0.20).
const useController = process.env.LOWLEVEL_ENABLED === 'true' || !!process.env.LOWLEVEL_HOST
const DEFAULT_COIN_TABLE = useController
  ? [
      { key: '3', value: 0.05 }, { key: '4', value: 0.10 }, { key: '5', value: 0.20 },
      { key: '6', value: 0.50 }, { key: '7', value: 1.00 }, { key: '8', value: 2.00 },
    ]
  : [
      { key: '0x01', value: 0.05 }, { key: '0x02', value: 0.10 }, { key: '0x03', value: 0.20 },
      { key: '0x04', value: 0.50 }, { key: '0x05', value: 1.00 }, { key: '0x06', value: 2.00 },
    ]
const DEFAULT_BILL_TABLE = useController
  ? [{ key: '5', value: 5 }, { key: '10', value: 10 }, { key: '20', value: 20 }, { key: '50', value: 50 }]
  : [{ key: '0x10', value: 5 }, { key: '0x11', value: 10 }, { key: '0x12', value: 20 }]

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

  // create/get default tenant
  const Tenant = require('../src/models/tenant.js').default
  const TenantUser = require('../src/models/tenantUser.js').default
  let defaultTenant = await Tenant.findOne({ slug: 'default' })
  if (!defaultTenant) defaultTenant = await Tenant.create({ name: 'Default Tenant', slug: 'default' })

  // ensure admin user exists (upsert style) and assign to tenant
  // give seeded admin super‑admin privileges so it can create tenants
  await User.updateOne(
    { $or: [{ username: 'admin' }, { email: 'admin@washstore.local' }] },
    { $set: { username: 'admin', email: 'admin@washstore.local', password: adminHash, role: 'SUPERADMIN', tenantId: defaultTenant._id } },
    { upsert: true }
  )
  // ensure kiosk user exists (upsert style) and assign to tenant
  await User.updateOne(
    { $or: [{ username: 'kiosk' }, { email: 'kiosk@washstore.local' }] },
    { $set: { username: 'kiosk', email: 'kiosk@washstore.local', password: kioskHash, role: 'KIOSK', apiKey: kioskApiKey, tenantId: defaultTenant._id } },
    { upsert: true }
  )

  // ensure tenant memberships exist
  const adminUser = await User.findOne({ username: 'admin' })
  const kioskUser = await User.findOne({ username: 'kiosk' })
  if (adminUser) await TenantUser.updateOne({ tenantId: defaultTenant._id, userId: adminUser._id }, { $setOnInsert: { tenantId: defaultTenant._id, userId: adminUser._id, role: 'OWNER' } }, { upsert: true })
  if (kioskUser) await TenantUser.updateOne({ tenantId: defaultTenant._id, userId: kioskUser._id }, { $setOnInsert: { tenantId: defaultTenant._id, userId: kioskUser._id, role: 'MEMBER' } }, { upsert: true })

  // Insert sample machines if none exist
  const count = await Machine.countDocuments()
  if (count === 0) {
    await Machine.create([{ name: 'Machine A', tenantId: defaultTenant._id }, { name: 'Machine B', tenantId: defaultTenant._id }])
  }

  // Insert default settings for coin/bill equivalence tables and bonuses
  await Setting.updateOne(
    { tenantId: defaultTenant._id, key: 'coinEqTable' },
    { 
      $setOnInsert: { tenantId: defaultTenant._id, key: 'coinEqTable', value: DEFAULT_COIN_TABLE } 
    },
    { upsert: true }
  )

  await Setting.updateOne(
    { tenantId: defaultTenant._id, key: 'billEqTable' },
    { $setOnInsert: { tenantId: defaultTenant._id, key: 'billEqTable', value: DEFAULT_BILL_TABLE } },
    { upsert: true }
  )

  await Setting.updateOne({ tenantId: defaultTenant._id, key: 'rechargeCoinBonus' }, { $setOnInsert: { tenantId: defaultTenant._id, key: 'rechargeCoinBonus', value: 0 } }, { upsert: true })
  await Setting.updateOne({ tenantId: defaultTenant._id, key: 'rechargeBillBonus' }, { $setOnInsert: { tenantId: defaultTenant._id, key: 'rechargeBillBonus', value: 0 } }, { upsert: true })
  await Setting.updateOne({ tenantId: defaultTenant._id, key: 'autoCharge' }, { $setOnInsert: { tenantId: defaultTenant._id, key: 'autoCharge', value: false } }, { upsert: true })
  await Setting.updateOne({ tenantId: defaultTenant._id, key: 'hopperCoinValue' }, { $setOnInsert: { tenantId: defaultTenant._id, key: 'hopperCoinValue', value: 1 } }, { upsert: true })
  await Setting.updateOne({ tenantId: defaultTenant._id, key: 'hopperMaxDispenseCoins' }, { $setOnInsert: { tenantId: defaultTenant._id, key: 'hopperMaxDispenseCoins', value: 50 } }, { upsert: true })

  console.log('Seed complete - admin user: admin (password: ' + adminPassword + ')')
  console.log('Seed complete - kiosk user: kiosk (password: ' + kioskPassword + ')')
  console.log('Kiosk API key: ' + kioskApiKey)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/*
  Migration helper to backfill existing documents into a default tenant.
  Usage: NODE_ENV=production node migrateToTenants.cjs
  Make sure MONGODB_URL is set in environment.
*/
const mongoose = require('mongoose')
const path = require('path')

async function main() {
  const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/washstore'
  await mongoose.connect(MONGODB_URL)
  const Tenant = require('../src/models/tenant.js').default
  const User = require('../src/models/user.js').default
  const Machine = require('../src/models/machine.js').default
  const Card = require('../src/models/card.js').default
  const CardPurchase = require('../src/models/cardPurchase.js').default
  const Interface = require('../src/models/interface.js').default
  const Peripheral = require('../src/models/peripheral.js').default
  const Price = require('../src/models/price.js').default
  const Sale = require('../src/models/sale.js').default
  const Setting = require('../src/models/setting.js').default
  const TenantUser = require('../src/models/tenantUser.js').default

  let tenant = await Tenant.findOne({ slug: 'default' })
  if (!tenant) tenant = await Tenant.create({ name: 'Default Tenant', slug: 'default' })
  const tId = tenant._id

  console.log('Assigning tenantId to existing collections for tenant:', tId)

  const models = [User, Machine, Card, CardPurchase, Interface, Peripheral, Price, Sale, Setting]
  for (const M of models) {
    try {
      const res = await M.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId: tId } })
      console.log(`${M.modelName}: matched=${res.matchedCount || res.n || 0} modified=${res.modifiedCount || res.nModified || 0}`)
    } catch (e) {
      console.warn(`Failed to update ${M.modelName}:`, e.message)
    }
  }

  // Ensure at least one TenantUser exists for the first admin user if present
  const admin = await User.findOne({ role: 'ADMIN', tenantId: tId })
  if (admin) {
    await TenantUser.updateOne({ tenantId: tId, userId: admin._id }, { $setOnInsert: { tenantId: tId, userId: admin._id, role: 'OWNER' } }, { upsert: true })
  }

  console.log('Migration complete')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })

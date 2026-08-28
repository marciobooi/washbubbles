const mongoose = require('mongoose')

async function main() {
  const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/washstore'
  await mongoose.connect(MONGODB_URL)
  const db = mongoose.connection.db

  console.log('Connected to', MONGODB_URL)

  // Fix users index: ensure tenantId+apiKey unique only when apiKey exists
  try {
    const users = db.collection('users')
    const idxs = await users.indexes()
    for (const idx of idxs) {
      if (idx.key && ((idx.key.tenantId === 1 && idx.key.apiKey === 1) || (idx.key.apiKey === 1 && !idx.key.tenantId))) {
        console.log('Dropping users index:', idx.name)
        try { await users.dropIndex(idx.name) } catch (e) { console.warn('dropIndex failed', e.message) }
      }
    }
    console.log('Creating partial unique index on users(tenantId, apiKey)')
    // Use $type: 'string' to ensure apiKey is a string (avoids null/value collisions)
    await users.createIndex({ tenantId: 1, apiKey: 1 }, { unique: true, partialFilterExpression: { apiKey: { $type: 'string' } } })
  } catch (e) { console.error('Failed to fix users indexes', e); }

  // Fix machines index: ensure tenantId+number unique only when number exists
  try {
    const machines = db.collection('machines')
    const idxs = await machines.indexes()
    for (const idx of idxs) {
      if (idx.key && idx.key.tenantId === 1 && idx.key.number === 1) {
        console.log('Dropping machines index:', idx.name)
        try { await machines.dropIndex(idx.name) } catch (e) { console.warn('dropIndex failed', e.message) }
      }
    }
    console.log('Creating partial unique index on machines(tenantId, number)')
    await machines.createIndex({ tenantId: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $exists: true } } })
  } catch (e) { console.error('Failed to fix machines indexes', e); }

  // Fix settings index: ensure tenant-scoped unique key
  try {
    const settings = db.collection('settings')
    const idxs = await settings.indexes()
    for (const idx of idxs) {
      if (idx.key && idx.key.key === 1 && !idx.key.tenantId) {
        console.log('Dropping settings legacy index:', idx.name)
        try { await settings.dropIndex(idx.name) } catch (e) { console.warn('dropIndex failed', e.message) }
      }
    }
    console.log('Creating unique index on settings(tenantId, key)')
    await settings.createIndex({ tenantId: 1, key: 1 }, { unique: true })
  } catch (e) { console.error('Failed to fix settings indexes', e); }

  console.log('Index fixes complete')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })

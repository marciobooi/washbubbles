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

  const password = process.env.ADMIN_PASSWORD || 'admin1234'
  const hash = await bcrypt.hash(password, 10)

  // ensure admin user exists (upsert style)
  await User.updateOne(
    { email: 'admin@washstore.local' },
    { $set: { email: 'admin@washstore.local', password: hash, role: 'ADMIN' } },
    { upsert: true }
  )

  // Insert sample machines if none exist
  const count = await Machine.countDocuments()
  if (count === 0) {
    await Machine.create([{ name: 'Machine A' }, { name: 'Machine B' }])
  }

  console.log('Seed complete - admin user: admin@washstore.local')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

// Load a daily copy (services/dailyBackup.js) into a database.
//   node scripts/restore-backup.mjs <file.json.gz> <mongodb url> [--drop]
// Refuses a database that already has rows unless --drop is given (then each collection in the file is emptied first).
// Stop the backend before restoring over the live database.
import fs from 'fs'
import zlib from 'zlib'
import readline from 'readline'
import mongoose from 'mongoose'

const [file, url] = process.argv.slice(2)
const drop = process.argv.includes('--drop')
if (!file || !url) { console.error('usage: node scripts/restore-backup.mjs <file.json.gz> <mongodb url> [--drop]'); process.exit(2) }
const { EJSON } = mongoose.mongo.BSON

await mongoose.connect(url)
const db = mongoose.connection.db
const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity })
const seen = new Set()
const batch = new Map()
let docs = 0
let end = null
const flush = async (name) => { const rows = batch.get(name); if (rows?.length) { await db.collection(name).insertMany(rows); batch.set(name, []) } }
try {
  for await (const line of rl) {
    if (!line) continue
    const o = EJSON.parse(line, { relaxed: false })
    if (o.end) { end = o; continue }
    if (!o.c) continue
    if (!seen.has(o.c)) {
      seen.add(o.c)
      const n = await db.collection(o.c).estimatedDocumentCount()
      if (n && !drop) throw new Error(`"${o.c}" already has ${n} rows: use an empty database, or --drop to replace what is there`)
      if (n) await db.collection(o.c).deleteMany({})
      batch.set(o.c, [])
    }
    batch.get(o.c).push(o.d); docs++
    if (batch.get(o.c).length >= 500) await flush(o.c)
  }
  for (const name of seen) await flush(name)
  if (!end || Number(end.docs) !== docs) throw new Error(`the file is cut short or does not add up (${docs} rows read, ${end?.docs ?? '?'} expected)`)
  console.log(`restored ${docs} rows into ${seen.size} collections`)
} catch (e) {
  console.error('FAILED: ' + e.message)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}

/**
 * Daily copy of the data, at 23:00 (Lisbon time), kept in two places: the shop PC and the central server.
 *
 *   shop PC         backups/shop-YYYYMMDD.json.gz      everything in the shop's own database
 *                   backups/central-YYYYMMDD.json.gz   what the central server holds for this shop
 *   central server  $BACKUP_DIR/<shop id>/ the same two files
 *
 * The shop PC drives it (startDailyBackup): it writes its copy, sends it to the central server (POST /sync/backup/shop, in parts) and
 * fetches the central one (GET /sync/backup/central). A copy is read back and counted before it is trusted, and only then are the
 * ones older than a week deleted (KEEP_DAYS = 7 of each). A PC that was off at 23:00 does it when it next starts.
 * The central server never hands a shop anything but that shop's own rows.
 *
 * File format: gzip, one JSON document per line (MongoDB Extended JSON, so dates and ids survive): a header, the rows as
 * {"c": collection, "d": document}, and a last line with the number of rows. scripts/restore-backup.mjs loads one back.
 */
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import readline from 'readline'
import { once } from 'events'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'

const { EJSON } = mongoose.mongo.BSON
const PART_BYTES = 4 * 1024 * 1024 // the web server in front of the central API takes 10 MB a request
export const MAX_PART_BYTES = 6 * 1024 * 1024
export const MAX_PARTS = 200
const RETRY_MS = 30 * 60 * 1000

export const backupDir = () => process.env.BACKUP_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'backups')

/** The 23:00 (Lisbon) that last went by, as YYYYMMDD: the name of the copy that should exist now. */
export function dueKey(now = new Date()) {
  const lisbon = (d) => d.toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).split(' ')
  const [day, time] = lisbon(now)
  const d = time >= '23:00:00' ? day : lisbon(new Date(now.getTime() - 24 * 3600 * 1000))[0]
  return d.replaceAll('-', '')
}

/** Write a copy to `file`: the whole database, or (tenantId) only one shop's rows. Returns { docs, bytes }. */
export async function writeDump(file, { tenantId = null } = {}) {
  const db = mongoose.connection.db
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.')).sort()
  const id = tenantId ? new mongoose.Types.ObjectId(String(tenantId)) : null
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const part = file + '.part'
  const gz = zlib.createGzip()
  const out = fs.createWriteStream(part)
  gz.pipe(out)
  const line = async (text) => { if (!gz.write(text + '\n')) await once(gz, 'drain') }
  const put = (obj) => line(EJSON.stringify(obj, { relaxed: false })) // a row: types kept exactly
  const meta = (obj) => line(JSON.stringify(obj))                      // the first and last lines: plain JSON
  let docs = 0
  try {
    await meta({ backup: 1, at: new Date().toISOString(), scope: id ? 'tenant' : 'all', tenantId: id ? String(id) : null })
    for (const name of names) {
      // one shop only: its own row in `tenants`, and the rows that carry its id (a collection with no tenantId gives nothing)
      const filter = !id ? {} : name === 'tenants' ? { _id: id } : { tenantId: id }
      for await (const doc of db.collection(name).find(filter)) { await put({ c: name, d: doc }); docs++ }
    }
    await meta({ end: 1, docs })
    gz.end()
    await once(out, 'finish')
  } catch (e) {
    gz.destroy(); out.destroy(); fs.rmSync(part, { force: true })
    throw e
  }
  fs.renameSync(part, file)
  return { docs, bytes: fs.statSync(file).size }
}

/** Read a copy back and count it. Throws when it is cut short or does not add up. Returns { docs, collections, header }. */
export async function verifyDump(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity })
  let header = null
  let end = null
  let docs = 0
  const collections = {}
  for await (const line of rl) {
    if (!line) continue
    const o = JSON.parse(line)
    if (o.backup) header = o
    else if (o.end) end = o
    else if (o.c) { docs++; collections[o.c] = (collections[o.c] || 0) + 1 }
  }
  if (!header) throw new Error('not a backup file (no header)')
  if (!end) throw new Error('backup file is cut short (no last line)')
  if (Number(end.docs) !== docs) throw new Error(`backup file does not add up (${docs} rows, ${end.docs} expected)`)
  return { docs, collections, header }
}

/** Keep the last KEEP_DAYS copies with this prefix (the newest is `keep`) and delete the older ones. Only called after `keep` was verified. */
export const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS) || 7
export function pruneOlder(dir, prefix, keep) {
  const mine = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f !== path.basename(keep))
  const whole = mine.filter((f) => f.endsWith('.json.gz')).sort().reverse() // the date is in the name: newest first
  const gone = [...whole.slice(KEEP_DAYS - 1), ...mine.filter((f) => f.endsWith('.json.gz.part'))] // and any half-written leftover
  for (const f of gone) fs.rmSync(path.join(dir, f), { force: true })
  return gone.length
}

/** Today's copy, reused when a retry finds it already made and good. */
async function ensureDump(file, opts) {
  if (fs.existsSync(file)) { try { const v = await verifyDump(file); return { docs: v.docs, bytes: fs.statSync(file).size } } catch { fs.rmSync(file, { force: true }) } }
  const r = await writeDump(file, opts)
  const v = await verifyDump(file)
  if (v.docs !== r.docs) throw new Error('the copy read back differs from what was written')
  return r
}

/** What the shop PC does once a day. `url`/`apiKey` are the central server's; without them only the local copy is made. */
export async function runShopBackup({ key = dueKey(), dir = backupDir(), url = '', apiKey = '', fetchFn = fetch } = {}) {
  const result = { key, shop: null, sent: null, central: null }
  const shopFile = path.join(dir, `shop-${key}.json.gz`)
  result.shop = await ensureDump(shopFile)
  pruneOlder(dir, 'shop-', shopFile)
  if (!url || !apiKey) return result

  const headers = { Authorization: `ApiKey ${apiKey}` }
  const buf = fs.readFileSync(shopFile)
  const parts = Math.max(1, Math.ceil(buf.length / PART_BYTES))
  for (let i = 0; i < parts; i++) {
    const res = await fetchFn(`${url}/sync/backup/shop?stamp=${key}&part=${i}&parts=${parts}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: buf.subarray(i * PART_BYTES, (i + 1) * PART_BYTES),
      signal: AbortSignal.timeout(120000),
    })
    if (!res.ok) throw new Error(`sending the shop copy: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 150)}`)
    if (i === parts - 1) result.sent = await res.json().catch(() => ({}))
  }

  const res = await fetchFn(`${url}/sync/backup/central?stamp=${key}`, { headers, signal: AbortSignal.timeout(300000) })
  if (!res.ok) throw new Error(`fetching the central copy: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 150)}`)
  const centralFile = path.join(dir, `central-${key}.json.gz`)
  fs.writeFileSync(centralFile + '.part', Buffer.from(await res.arrayBuffer()))
  const v = await verifyDump(centralFile + '.part')
  fs.renameSync(centralFile + '.part', centralFile)
  pruneOlder(dir, 'central-', centralFile)
  result.central = { docs: v.docs, bytes: fs.statSync(centralFile).size }
  return result
}

// ── the central server's side (routes/sync.js) ──

const tenantDir = (tenantId) => path.join(backupDir(), String(tenantId).replace(/[^a-f0-9]/gi, ''))
const uploads = new Map() // `${tenant}:${stamp}` -> next part expected

/** One part of a shop's copy has arrived. On the last one the file is checked, kept, and the previous one removed. */
export async function receiveShopPart({ tenantId, stamp, part, parts, body }) {
  const dir = tenantDir(tenantId)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `shop-${stamp}.json.gz`)
  const k = `${tenantId}:${stamp}`
  if (part === 0) fs.writeFileSync(file + '.part', body)
  else {
    if (uploads.get(k) !== part) { const e = new Error('part out of order: start again from part 0'); e.status = 409; throw e }
    fs.appendFileSync(file + '.part', body)
  }
  if (part < parts - 1) { uploads.set(k, part + 1); return { ok: true, part } }
  uploads.delete(k)
  let v
  try { v = await verifyDump(file + '.part') } catch (e) { fs.rmSync(file + '.part', { force: true }); e.status = 400; throw e }
  fs.renameSync(file + '.part', file)
  pruneOlder(dir, 'shop-', file)
  return { ok: true, docs: v.docs, bytes: fs.statSync(file).size }
}

/** The central server's copy of ONE shop: written, checked, the previous one removed. Returns the file to send. */
export async function makeCentralCopy({ tenantId, stamp }) {
  const dir = tenantDir(tenantId)
  const file = path.join(dir, `central-${stamp}.json.gz`)
  fs.rmSync(file, { force: true }) // asked again the same day: a fresh one
  await ensureDump(file, { tenantId })
  pruneOlder(dir, 'central-', file)
  return file
}

// ── the shop PC's clock ──

const stateFile = () => path.join(backupDir(), 'last.json')
const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) } catch { return {} } }
let timer = null
let running = false
let lastTry = 0
let alertedFor = null

/** One look at the clock (every few minutes): make the copy that is due, once; on failure try again half an hour later. */
export async function tick(coin, deps = {}) {
  const now = deps.now ? deps.now() : new Date()
  const key = dueKey(now)
  if (running || readState().key === key) return 'done'
  if (now.getTime() - lastTry < RETRY_MS && !deps.force) return 'waiting'
  running = true
  lastTry = now.getTime()
  try {
    const up = coin?.uplink
    const linked = Boolean(up?.enabled ?? (up?.url && up?.apiKey))
    const result = await (deps.run || runShopBackup)({ key, url: linked ? up.url : '', apiKey: linked ? up.apiKey : '' })
    fs.mkdirSync(backupDir(), { recursive: true })
    fs.writeFileSync(stateFile(), JSON.stringify({ ...result, at: now.toISOString() }))
    console.log(`[Backup] ${key}: shop ${result.shop?.docs} rows (${result.shop?.bytes} bytes)${result.central ? `, central ${result.central.docs} rows (${result.central.bytes} bytes), both kept here and on the central server` : ', kept on this PC only (no central server configured)'}`)
    coin?.auditSystem?.('backup.done', result)?.catch?.(() => {})
    return 'ok'
  } catch (e) {
    console.error(`[Backup] ${key} failed (trying again in 30 minutes): ${e.message}`)
    if (alertedFor !== key && coin?.tenantId) {
      alertedFor = key
      import('./alerts.js').then(({ sendAlertForTenant }) => sendAlertForTenant(coin.tenantId, 'Cópia de segurança falhou', `A cópia diária (${key}) não ficou completa: ${e.message}. O sistema volta a tentar de 30 em 30 minutos; a cópia anterior não foi apagada.`)).catch(() => {})
    }
    return 'failed'
  } finally { running = false }
}

export function startDailyBackup(coin) {
  if (timer || process.env.DAILY_BACKUP === 'false') return
  timer = setInterval(() => { tick(coin).catch((e) => console.error('[Backup]', e.message)) }, 5 * 60 * 1000)
  timer.unref?.()
  setTimeout(() => { tick(coin).catch((e) => console.error('[Backup]', e.message)) }, 90 * 1000).unref?.() // a PC that was off at 23:00
}
export function _reset() { lastTry = 0; alertedFor = null; running = false; uploads.clear() }

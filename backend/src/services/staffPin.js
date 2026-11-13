/**
 * The staff PIN is stored as a bcrypt hash, never as the digits themselves (the database, a backup or the audit trail must not
 * hold a code that unlocks cash handling on the kiosk). A PIN saved before this change is still plain digits: it keeps working
 * and is turned into a hash by `migrateAdminPins` at start-up (and whenever it is saved again).
 */
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export const PIN_FORMAT = /^\d{4,8}$/
export const isHashedPin = (v) => typeof v === 'string' && /^\$2[aby]\$\d{2}\$/.test(v)
export const hashPin = (pin) => bcrypt.hash(String(pin), 10)

/**
 * The staff PIN is renewed every MONDAY: a PIN made before the last Monday 00:00 (shop time, Europe/Lisbon) has expired, so one that
 * leaked, or that a former employee knows, stops working by itself. After that the kiosk answers "PIN expirado" and asks for a new one
 * (the person at the kiosk types it twice: see renewExpiredPin), or one can be made in the admin. The moment it was made is the
 * setting `adminPin.setAt`, written with the PIN and sent to the shop PC with the other settings.
 */
export const PIN_SET_AT = 'adminPin.setAt'
export const PIN_SET_VIA = 'adminPin.setVia' // where it was last changed: 'admin' or 'kiosk' (the digits are never kept, so this is all the admin can see)
const SHOP_TZ = 'Europe/Lisbon'
const DAY_MS = 24 * 3600 * 1000
function shopParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: SHOP_TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}
/** The instant of 00:00 in the shop (Lisbon) on a civil date. */
function shopMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d)
  const p = shopParts(new Date(guess))
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - guess // Lisbon is ahead of UTC by 0 or 1 hour
  return new Date(guess - offset)
}
/** The Monday 00:00 (shop time) that ends the week `made` belongs to. */
function nextMonday(made) {
  const p = shopParts(made)
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() // 0 = Sunday
  const ahead = ((8 - dow) % 7) || 7
  const n = new Date(Date.UTC(p.y, p.m - 1, p.d + ahead))
  return shopMidnight(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate())
}
export function pinAge(setAt, now = new Date()) {
  const made = setAt ? new Date(setAt) : null
  if (!made || Number.isNaN(made.getTime())) return { setAt: null, expiresAt: null, expired: false, daysLeft: null } // no date yet: start-up writes one
  const expiresAt = nextMonday(made)
  const left = expiresAt.getTime() - now.getTime()
  return { setAt: made.toISOString(), expiresAt: expiresAt.toISOString(), expired: left <= 0, daysLeft: Math.max(0, Math.ceil(left / DAY_MS)) }
}

/** A PIN that has no date (made before PINs expired) gets today's: its week starts now. Returns how many were dated. */
export async function datePins(SettingModel) {
  const pins = await SettingModel.find({ key: 'adminPin', value: { $nin: [null, ''] } }).select('tenantId').lean()
  let n = 0
  for (const p of pins) {
    const r = await SettingModel.updateOne({ tenantId: p.tenantId, key: PIN_SET_AT }, { $setOnInsert: { value: new Date().toISOString() } }, { upsert: true })
    if (r.upsertedCount) n++
  }
  return n
}

// The last PINs, kept only as hashes (never the digits): a new PIN may not repeat any of the last 3 used (the current one included).
export const PIN_HISTORY = 'adminPin.history'
export const PIN_NO_REPEAT = 3
export async function pinIsRecent(SettingT, newPin) {
  const cur = (await SettingT.findOne({ key: 'adminPin' }).lean())?.value
  const hist = (await SettingT.findOne({ key: PIN_HISTORY }).lean())?.value
  const hashes = [cur, ...(Array.isArray(hist) ? hist : [])].filter(Boolean).slice(0, PIN_NO_REPEAT)
  for (const h of hashes) if (await verifyPin(h, String(newPin))) return true
  return false
}
/** Call before the stored PIN is replaced: its hash goes to the front of the history. */
export async function rememberPin(SettingT, oldHash) {
  if (!oldHash) return
  const hist = (await SettingT.findOne({ key: PIN_HISTORY }).lean())?.value
  await SettingT.findOneAndUpdate({ key: PIN_HISTORY }, { value: [oldHash, ...(Array.isArray(hist) ? hist : [])].slice(0, PIN_NO_REPEAT + 2) }, { upsert: true })
}

/** Does `pin` match what is stored (a hash, or an old plain value)? */
export async function verifyPin(stored, pin) {
  const expected = stored == null ? '' : String(stored)
  if (!expected || typeof pin !== 'string' || !pin) return false
  if (isHashedPin(expected)) return bcrypt.compare(pin, expected)
  const a = Buffer.from(expected)
  const b = Buffer.from(pin)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Hash every plain PIN still in the settings. Returns how many were converted. */
export async function migrateAdminPins(SettingModel) {
  const rows = await SettingModel.find({ key: 'adminPin' }).lean()
  let n = 0
  for (const r of rows) {
    if (typeof r.value === 'string' && PIN_FORMAT.test(r.value)) {
      await SettingModel.updateOne({ _id: r._id }, { $set: { value: await hashPin(r.value) } })
      n++
    }
  }
  return n
}

/**
 * A new PIN made at the kiosk (or relayed from it to the central server) once the old one has expired. The old PIN has to be given and
 * right, so a kiosk key alone cannot make a PIN; it is only allowed while the old one IS expired (a valid one is changed in the admin);
 * the new one must be 4 to 8 digits and different from the old. `write: false` only checks.
 * @returns {{ok:true}|{ok:false, status:number, code:string, error:string}}
 */
export async function renewExpiredPin(SettingT, oldPin, newPin, { write = true } = {}) {
  const row = await SettingT.findOne({ key: 'adminPin' }).lean()
  const stored = row ? String(row.value ?? '') : ''
  if (!stored) return { ok: false, status: 409, code: 'no-pin', error: 'Não há PIN configurado' }
  if (!(await verifyPin(stored, String(oldPin || '')))) return { ok: false, status: 401, code: 'invalid-pin', error: 'PIN atual inválido' }
  const age = pinAge((await SettingT.findOne({ key: PIN_SET_AT }).lean())?.value)
  if (!age.expired) return { ok: false, status: 409, code: 'pin-valid', error: 'O PIN ainda é válido' }
  if (!PIN_FORMAT.test(String(newPin || ''))) return { ok: false, status: 400, code: 'bad-format', error: 'O PIN deve ter entre 4 e 8 dígitos' }
  if (await pinIsRecent(SettingT, newPin)) return { ok: false, status: 400, code: 'same-pin', error: 'Escolha um PIN que não seja um dos últimos 3' }
  if (write) {
    await rememberPin(SettingT, row.value)
    await SettingT.findOneAndUpdate({ key: 'adminPin' }, { value: await hashPin(String(newPin)) }, { upsert: true })
    await SettingT.findOneAndUpdate({ key: PIN_SET_AT }, { value: new Date().toISOString() }, { upsert: true })
    await SettingT.findOneAndUpdate({ key: PIN_SET_VIA }, { value: 'kiosk' }, { upsert: true })
  }
  return { ok: true }
}

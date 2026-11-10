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
 * The staff PIN lasts a week: after that the kiosk answers "PIN expirado" and a new one has to be made in the admin (a PIN that
 * leaked, or that a former employee knows, stops working by itself). The day it was made is the setting `adminPin.setAt`,
 * written with the PIN and sent to the shop PC with the other settings.
 */
export const PIN_SET_AT = 'adminPin.setAt'
export const PIN_MAX_AGE_DAYS = Number(process.env.STAFF_PIN_MAX_AGE_DAYS) || 7
export function pinAge(setAt, now = new Date()) {
  const made = setAt ? new Date(setAt) : null
  if (!made || Number.isNaN(made.getTime())) return { setAt: null, expiresAt: null, expired: false, daysLeft: null } // no date yet: start-up writes one
  const expiresAt = new Date(made.getTime() + PIN_MAX_AGE_DAYS * 24 * 3600 * 1000)
  const left = expiresAt.getTime() - now.getTime()
  return { setAt: made.toISOString(), expiresAt: expiresAt.toISOString(), expired: left <= 0, daysLeft: Math.max(0, Math.ceil(left / (24 * 3600 * 1000))) }
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

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

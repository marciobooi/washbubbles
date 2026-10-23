/**
 * Kiosk API keys: rotating one without cutting the shop off.
 *
 * Replacing a key at once would lock the shop out of the central server until someone typed the new key at the kiosk. Instead
 * a rotation STAGES the new key (`apiKeyNext`): the old key keeps working, and the first request that arrives with the new
 * key makes it THE key (the old one stops working from that moment). The shop can be updated whenever it suits, and a key
 * that never gets used simply stays pending (it can be replaced by generating another).
 *
 * New keys are 24 hex characters shown in groups of four (a1b2-c3d4-...): 96 random bits, short enough to type on the
 * kiosk's on-screen keyboard.
 */
import crypto from 'crypto'
import User from '../models/user.js'
import AuditLog from '../models/auditLog.js'

export const normalizeKey = (k) => String(k || '').trim().replace(/[\s-]/g, '').toLowerCase()
export const groupKey = (k) => String(k).replace(/(.{4})(?=.)/g, '$1-')
export const newKioskKey = () => crypto.randomBytes(12).toString('hex')

/** The user for an API key. A staged key that is used for the first time is promoted on the spot. */
export async function findUserByApiKey(apiKey) {
  const key = normalizeKey(apiKey) || String(apiKey || '')
  if (!key) return null
  let user = await User.findOne({ apiKey: String(apiKey) }) // the exact string first: keys issued before this feature are 48 hex
  if (!user && key !== String(apiKey)) user = await User.findOne({ apiKey: key })
  if (user) return user
  user = await User.findOne({ apiKeyNext: key })
  if (!user) return null
  const r = await User.updateOne({ _id: user._id, apiKeyNext: key }, { $set: { apiKey: key, apiKeyNext: null, apiKeyNextAt: null } })
  if (r.modifiedCount) {
    AuditLog.create({ tenantId: user.tenantId, actorUsername: user.username, action: 'kiosk.key_promoted', targetType: 'User', targetId: String(user._id), details: { note: 'the new kiosk key was used for the first time: the old key no longer works' } }).catch(() => {})
  }
  return User.findById(user._id)
}

/** Stage a new key for a user. Returns the key (to show ONCE). */
export async function stageNewKey(tenantId, userId) {
  const key = newKioskKey()
  await User.updateOne({ _id: userId, tenantId }, { $set: { apiKeyNext: key, apiKeyNextAt: new Date() } })
  return key
}

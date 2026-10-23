/**
 * "Only one process does this job at a time", across processes and servers: a lease kept in the database. The holder renews it
 * each run; if the holder dies the lease simply expires after `ttlMs` and another process takes over.
 */
import crypto from 'crypto'
import mongoose from 'mongoose'
import PlatformSetting from '../models/platformSetting.js'

const me = crypto.randomBytes(6).toString('hex')

export async function acquire(name, ttlMs) {
  if (mongoose.connection.readyState !== 1) return false
  const key = `lease:${name}`
  const now = Date.now()
  const value = { holder: me, until: now + ttlMs }
  try {
    const r = await PlatformSetting.findOneAndUpdate(
      { key, $or: [{ 'value.until': { $lt: now } }, { 'value.holder': me }] },
      { $set: { value, updatedAt: new Date() } },
      { new: true },
    )
    if (r) return true
    // no lease yet: create it (a concurrent creator loses on the unique key)
    await PlatformSetting.create({ key, value })
    return true
  } catch (err) {
    if (err?.code === 11000) return false // somebody else holds it
    throw err
  }
}

/** Run `fn` only when this process holds the lease for `name`. */
export async function runAsLeader(name, ttlMs, fn) {
  if (!(await acquire(name, ttlMs))) return false
  await fn()
  return true
}

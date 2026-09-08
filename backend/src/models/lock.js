import mongoose from 'mongoose'

const { Schema } = mongoose

/**
 * Generic per-tenant mutex for critical sections that a read-then-write check
 * cannot safely serialize on its own (e.g. two admins closing the cash session
 * at the same moment). Single-document atomic updates are always available in
 * MongoDB, even without a replica set, so this needs no transaction support.
 *
 * A lock older than `STALE_MS` is treated as abandoned — a crashed request
 * must not permanently block every future close for that tenant.
 */
const lockSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: { type: String, required: true },
  lockedAt: { type: Date, default: null },
})

lockSchema.index({ tenantId: 1, name: 1 }, { unique: true })

const Lock = mongoose.model('Lock', lockSchema)

const STALE_MS = 30000

/**
 * Try to acquire `name` for `tenantId`. Returns true if acquired, false if
 * someone else currently holds it. Always release with `releaseLock`.
 */
export async function acquireLock(tenantId, name) {
  const staleBefore = new Date(Date.now() - STALE_MS)
  const doc = await Lock.findOneAndUpdate(
    {
      tenantId,
      name,
      $or: [{ lockedAt: null }, { lockedAt: { $lt: staleBefore } }],
    },
    { $set: { lockedAt: new Date() } },
    { upsert: true, new: true }
  ).catch((err) => {
    // A duplicate-key error here means two callers raced the upsert itself;
    // whichever lost did not acquire the lock — that is a normal outcome, not
    // a fault.
    if (err.code === 11000) return null
    throw err
  })
  return !!doc
}

export async function releaseLock(tenantId, name) {
  await Lock.updateOne({ tenantId, name }, { $set: { lockedAt: null } })
}

export default { acquireLock, releaseLock }

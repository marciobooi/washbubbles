import mongoose from 'mongoose'

const { Schema } = mongoose

/**
 * Durable queue of records waiting to be pushed to the central server.
 *
 * Written the moment a sale / card change / day-close happens, in the SAME local
 * database as the record itself, so a power cut or a week without internet loses
 * nothing: on restart the worker simply carries on (services/uplink.js).
 *
 * Sales and day-closes are queued once each. A card is queued as "latest balance":
 * a newer change replaces the still-pending entry, so a customer who tops up and
 * spends ten times offline produces one card update, not ten.
 */
const syncOutboxSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  entityType: { type: String, enum: ['sale', 'card', 'day_close', 'flow', 'coupon'], required: true },
  entityId: { type: String, required: true }, // sale/day-close _id, or the card code
  payload: { type: Schema.Types.Mixed, required: true },
  // Bumped every time a pending entry is refreshed, so a push that was in flight
  // when a newer state arrived is not mistaken for having sent that newer state.
  rev: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'sent', 'dead'], default: 'pending' },
  // Real failures only (the server said no). Being offline never counts.
  attempts: { type: Number, default: 0 },
  lastError: { type: String, default: '' },
  nextAttemptAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  sentAt: { type: Date, default: null },
})

// The worker's query: oldest due pending entries first.
syncOutboxSchema.index({ tenantId: 1, status: 1, nextAttemptAt: 1, createdAt: 1 })

// At most ONE pending entry per record — this is what lets a card be replaced by
// its latest balance, and makes queueing a sale twice harmless.
syncOutboxSchema.index(
  { tenantId: 1, entityType: 1, entityId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
)

export default mongoose.model('SyncOutbox', syncOutboxSchema)

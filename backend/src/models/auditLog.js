import mongoose from 'mongoose'
import modelEvents from '../services/modelEvents.js'

const { Schema } = mongoose

// A record of who did what to the tenant's config/money-adjacent data.
// Written fire-and-forget by services/auditLog.js — never required for a
// request to succeed, only for someone to be able to answer "who did this"
// after the fact.
const auditLogSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorUsername: { type: String, default: '' },
  action: { type: String, required: true }, // e.g. 'price.update', 'transaction.refund'
  targetType: { type: String, default: '' }, // e.g. 'Price', 'Sale', 'User'
  targetId: { type: String, default: '' },
  details: { type: Schema.Types.Mixed, default: null },
  // CENTRAL: the id this entry has on the shop PC it came from (makes the shop's pushes idempotent)
  shopLocalId: { type: String, default: undefined },
  createdAt: { type: Date, default: Date.now }
})

auditLogSchema.index({ tenantId: 1, createdAt: -1 })
auditLogSchema.index({ tenantId: 1, shopLocalId: 1 }, { unique: true, partialFilterExpression: { shopLocalId: { $type: 'string' } } })
// what the shop writes is sent to the central server too (an entry that CAME from a shop is not sent back)
auditLogSchema.post('save', function (doc) { if (!doc.shopLocalId) modelEvents.emit('audit:created', doc) })

export default mongoose.model('AuditLog', auditLogSchema)

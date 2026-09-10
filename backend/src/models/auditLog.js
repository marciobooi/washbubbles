import mongoose from 'mongoose'

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
  createdAt: { type: Date, default: Date.now }
})

auditLogSchema.index({ tenantId: 1, createdAt: -1 })

export default mongoose.model('AuditLog', auditLogSchema)

import mongoose from 'mongoose'

const { Schema } = mongoose

const saleSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  // machineId is optional because some transactions (card recharges, admin events) do not relate to a machine
  machineId: { type: Schema.Types.ObjectId, ref: 'Machine' },
  amount: { type: Number, required: true },
  items: { type: Schema.Types.Mixed },
  // Transaction type: payment, recharge, card_purchase, admin_start, etc.
  type: { type: String, enum: ['payment', 'recharge', 'card_purchase', 'admin_start', 'other'], default: 'payment' },
  // Payment method (card, cash, kiosk)
  method: { type: String },
  // Optional batch id to group multi-sale payments into one logical transaction
  batchId: { type: String },
  // Loyalty card reference (if any)
  cardId: { type: Schema.Types.ObjectId, ref: 'Card' },
  cardCode: { type: String },
  // Amount the user inserted (for cash payments) and change given back
  inserted: { type: Number, default: 0 },
  change: { type: Number, default: 0 },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
})

// common query patterns: per-tenant date queries
saleSchema.index({ tenantId: 1, createdAt: -1 })

// `/sync/push/sale` dedupes on metadata.localId on EVERY push from EVERY kiosk.
// With no index that is a full collection scan per sale — on a year of sales it
// is the slowest thing the server does. Partial, because only synced sales have it.
saleSchema.index(
  { tenantId: 1, 'metadata.localId': 1 },
  { partialFilterExpression: { 'metadata.localId': { $type: 'string' } } }
)

// Card transaction history (`/pos/cards/:code/history`) was a collection scan.
saleSchema.index({ tenantId: 1, cardCode: 1, createdAt: -1 })

export default mongoose.model('Sale', saleSchema)

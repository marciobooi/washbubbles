import mongoose from 'mongoose'
import modelEvents from '../services/modelEvents.js'

const { Schema } = mongoose

const saleSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  // machineId is optional because some transactions (card recharges, admin events) do not relate to a machine
  machineId: { type: Schema.Types.ObjectId, ref: 'Machine' },
  amount: { type: Number, required: true },
  items: { type: Schema.Types.Mixed },
  // Transaction type: payment, recharge, card_purchase, gift_card (a free card handed out by staff), admin_start, etc.
  type: { type: String, enum: ['payment', 'recharge', 'card_purchase', 'gift_card', 'admin_start', 'other', 'refund'], default: 'payment' },
  // Payment method (card, cash, kiosk)
  method: { type: String },
  // 'refunded' is set on the ORIGINAL sale once a refund has been issued for
  // it — informational only, never mutated on an already-closed sale (see
  // dayCloseId below). The reversal itself is a separate `type: 'refund'` row.
  status: { type: String, enum: ['completed', 'refunded'], default: 'completed' },
  // Set on a `type: 'refund'` row to point back at the sale it reverses.
  refundOf: { type: Schema.Types.ObjectId, ref: 'Sale', default: null },
  refundReason: { type: String, default: '' },
  // Optional batch id to group multi-sale payments into one logical transaction
  batchId: { type: String },
  // Loyalty card reference (if any)
  cardId: { type: Schema.Types.ObjectId, ref: 'Card' },
  cardCode: { type: String },
  // Amount the user inserted (for cash payments) and change given back
  inserted: { type: Number, default: 0 },
  change: { type: Number, default: 0 },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
  /**
   * Which admin day-close this sale was reconciled into, if any.
   *
   * Without this, "which sales belong to this Z-report" is only ever an
   * implicit re-query by timestamp range — fine until someone needs to audit a
   * historical close, or until a boundary bug (there was one — see
   * admin.js day-close route) quietly drops a sale between two periods with no
   * way to detect it. Set once, at close time, and never changed after.
   */
  dayCloseId: { type: Schema.Types.ObjectId, ref: 'DayClose', default: null }
})

// common query patterns: per-tenant date queries
saleSchema.index({ tenantId: 1, createdAt: -1 })

// Audit query: "which sales have never been reconciled into a close" — finds
// both ordinary unclosed sales and any that fell into a boundary gap.
saleSchema.index(
  { tenantId: 1, dayCloseId: 1, createdAt: 1 },
  { partialFilterExpression: { dayCloseId: null } }
)

// `/sync/push/sale` dedupes on metadata.localId on EVERY push from EVERY kiosk.
// With no index that is a full collection scan per sale — on a year of sales it
// is the slowest thing the server does. Partial, because only synced sales have it.
saleSchema.index(
  { tenantId: 1, 'metadata.localId': 1 },
  { partialFilterExpression: { 'metadata.localId': { $type: 'string' } } }
)

// Card transaction history (`/pos/cards/:code/history`) was a collection scan.
saleSchema.index({ tenantId: 1, cardCode: 1, createdAt: -1 })

// Announce NEW sales only (an update, e.g. flagging a sale refunded, is not new
// money). The central uplink queues each one for the server.
// THE RULE (2026-10-20): a card is never credited with anything but cash. A NEW recharge sale must be a cash sale; any code path
// that tries to book one with another method (the 'recharge paid with the card' hole) fails here, whatever route it came from.
saleSchema.pre('validate', function (next) {
  if (this.isNew && this.type === 'recharge' && this.method !== 'cash' && !(this.metadata && this.metadata.voided)) {
    return next(new Error('A card recharge can only be paid in cash'))
  }
  next()
})

saleSchema.pre('save', function (next) { this.$locals.wasNew = this.isNew; next() })
saleSchema.post('save', function (doc) {
  if (doc.$locals.wasNew) modelEvents.emit('sale:created', doc)
})

export default mongoose.model('Sale', saleSchema)

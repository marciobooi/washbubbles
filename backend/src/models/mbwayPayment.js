import mongoose from 'mongoose'

const { Schema } = mongoose

/** One MB WAY payment request made at a kiosk (see services/mbway.js). Lives in the shop's database. */
const mbwayPaymentSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  identifier: { type: String, required: true },          // our id, sent to Eupago
  batchId: { type: String },
  amount: { type: Number, required: true },
  phone: { type: String, default: '' },                  // masked: the full number is not kept
  reference: { type: String, default: '' },              // Eupago's
  transactionId: { type: String, default: '' },
  couponCode: { type: String, default: '' },
  lines: [{ machineId: { type: Schema.Types.ObjectId, ref: 'Machine' }, blocks: Number, price: Number, name: String, _id: false }],
  // pending: waiting for the customer | started: paid and the machines started | failed / expired: nothing was paid |
  // cancelled: the customer gave up at the kiosk | start_failed: PAID but a machine could not start (refund by hand) |
  // paid_unclaimed: paid after the customer had cancelled (refund by hand)
  status: { type: String, enum: ['pending', 'paid', 'started', 'failed', 'expired', 'cancelled', 'start_failed', 'paid_unclaimed'], default: 'pending', index: true },
  error: { type: String, default: '' },
  lastPolledAt: { type: Date },
  expiresAt: { type: Date, required: true },
  paidAt: { type: Date },
  startedAt: { type: Date },
  saleIds: [{ type: Schema.Types.ObjectId, ref: 'Sale' }],
  createdAt: { type: Date, default: Date.now },
})
mbwayPaymentSchema.index({ tenantId: 1, identifier: 1 }, { unique: true })

export default mongoose.model('MbwayPayment', mbwayPaymentSchema)

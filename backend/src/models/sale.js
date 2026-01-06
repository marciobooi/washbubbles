import mongoose from 'mongoose'

const { Schema } = mongoose

const saleSchema = new Schema({
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
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('Sale', saleSchema)

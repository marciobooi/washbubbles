import mongoose from 'mongoose'

const { Schema } = mongoose

// Denomination breakdown for coins/bills
const denominationSchema = new Schema({
  value: { type: Number, required: true },  // face value in euros (e.g. 0.05, 0.10, 1.00, 5, 10 …)
  count: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true }   // value × count (stored for convenience)
}, { _id: false })

const dayCloseSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

  // ── Sales totals extracted from DB for this period ──
  totalCash:   { type: Number, default: 0 }, // cash sales in this period
  totalCard:   { type: Number, default: 0 }, // card sales in this period
  totalSales:  { type: Number, default: 0 }, // totalCash + totalCard

  // ── Cash reconciliation ──
  openingFloat:  { type: Number, default: 0 }, // float carried over from the previous close
  expectedCash:  { type: Number, default: 0 }, // openingFloat + totalCash  (what should be in machine)
  countedCash:   { type: Number, default: 0 }, // what the operator physically counted
  discrepancy:   { type: Number, default: 0 }, // countedCash - expectedCash (negative = shortage)

  // Denomination breakdown used to reach countedCash (coins + bills in machine)
  countedDenominations: [denominationSchema],

  // ── Cash management ──
  amountToBank: { type: Number, required: true }, // cash removed for bank deposit
  floatLeft:    { type: Number, required: true },  // cash left to start next session

  // ── Coin mechanism (acceptor) inventory ──
  // Physical count of coins sitting in the coin acceptor mechanism at close time
  coinMechanismInventory: [denominationSchema],
  coinMechanismTotal: { type: Number, default: 0 },

  // ── Hopper restocking ──
  // Coins loaded into the upper coin dispenser (hopper) for making change
  hopperCoins: [denominationSchema],
  hopperTotal: { type: Number, default: 0 },

  // ── Misc ──
  notes: { type: String, default: '' },

  closedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  closedByUsername: { type: String, default: '' },

  periodFrom: { type: Date },
  periodTo:   { type: Date, default: Date.now },

  createdAt: { type: Date, default: Date.now }
})

dayCloseSchema.index({ tenantId: 1, createdAt: -1 })

export default mongoose.model('DayClose', dayCloseSchema)

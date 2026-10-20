import mongoose from 'mongoose'
import modelEvents from '../services/modelEvents.js'

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
  totalCard:   { type: Number, default: 0 }, // spent from card balances in this period — INFORMATION only, not accounted
  totalRecharges: { type: Number, default: 0 }, // cash put ON cards (in the till, but a prepayment, not a sale)
  totalMbway:  { type: Number, default: 0 }, // paid with MB WAY (bank, not the till)
  totalSales:  { type: Number, default: 0 }, // = totalCash + totalMbway: the books follow the money that entered (till or bank)

  // ── Cash reconciliation ──
  openingFloat:  { type: Number, default: 0 }, // float carried over from the previous close
  expectedCash:  { type: Number, default: 0 }, // openingFloat + totalCash  (what should be in machine)
  countedCash:   { type: Number, default: 0 }, // what the operator physically counted
  discrepancy:   { type: Number, default: 0 }, // countedCash - expectedCash (negative = shortage)

  // Denomination breakdown used to reach countedCash (coins + bills in machine)
  countedDenominations: [denominationSchema],

  // ── Cash management ──
  // Not `required`: a Z-report pushed up from a kiosk (`/sync/push/day-close`) is
  // generated from local sales and has no operator cash-handling input, so a
  // required field here rejected every offline close.
  amountToBank: { type: Number, default: 0 }, // cash removed for bank deposit
  floatLeft:    { type: Number, default: 0 },  // cash left to start next session

  // ── Origin ──
  // 'adjustment' = a standalone cash top-up (e.g. seeding the starting float)
  // created via createFloatAdjustment — no bank split, no physical count, so
  // it's tagged distinctly from a real reconciliation close even though it
  // still counts as the float chain's baseline (see findLastDashboardClose).
  source: { type: String, enum: ['dashboard', 'kiosk', 'adjustment'], default: 'dashboard' },
  totalRecharges: { type: Number, default: 0 },
  salesCount: { type: Number, default: 0 },
  // `metadata.localId` dedupes retried kiosk pushes, same as Sale.
  metadata: { type: Schema.Types.Mixed },

  // ── Opening state (carried from previous close for reference) ──
  openingMechanismCoins: [denominationSchema], // mechanism inventory at session start
  openingHopperCoins:    [denominationSchema], // hopper state at session start
  totalChangeDispensed:  { type: Number, default: 0 }, // total change given to customers during period

  // ── Coin mechanism (acceptor) inventory at close ──
  coinMechanismInventory: [denominationSchema],
  coinMechanismTotal: { type: Number, default: 0 },

  // ── Hopper: actual state before restock + target for next session ──
  hopperActualBefore:      [denominationSchema], // physical count of remaining coins before refilling
  hopperActualBeforeTotal: { type: Number, default: 0 },
  // Coins loaded / target state for the next session (becomes openingHopperCoins on next open)
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

// `/sync/push/day-close` dedupes retried kiosk Z-reports on this.
dayCloseSchema.index(
  { tenantId: 1, 'metadata.localId': 1 },
  { partialFilterExpression: { 'metadata.localId': { $type: 'string' } } }
)

dayCloseSchema.pre('save', function (next) { this.$locals.wasNew = this.isNew; next() })
dayCloseSchema.post('save', function (doc) {
  if (doc.$locals.wasNew) modelEvents.emit('dayclose:created', doc)
})

export default mongoose.model('DayClose', dayCloseSchema)

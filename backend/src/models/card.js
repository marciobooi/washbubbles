import mongoose from 'mongoose'

const { Schema } = mongoose

const cardSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  code: { type: String, required: true }, // public card code
  balance: { type: Number, default: 0 },
  // Loyalty bonus accrued on recharges. `services/client.js` reads and writes this;
  // without the field, Mongoose strict mode dropped every write silently and all
  // loyalty bonus was permanently lost.
  bonus: { type: Number, default: 0 },

  // Deltas already applied to this card, keyed by the kiosk's local operation id.
  // Kiosk pushes are delta-based ("add €20") and are retried after a timeout or a
  // power cut, so without a dedupe key a retry credits the card twice.
  appliedDeltas: { type: [String], default: [] },


  /**
   * Lifecycle state of the physical card.
   *
   * A card is dispensed blank and only becomes usable once the customer inserts
   * it into the reader and we write the code and balance onto it. Until then it
   * is `pending_write`: the row exists so the purchase is recorded and the
   * customer can resume, but the card must not be spendable — otherwise a card
   * that was paid for and never personalised would still draw down a balance
   * that no physical card carries.
   */
  status: {
    type: String,
    enum: ['pending_write', 'active', 'blocked'],
    default: 'active', // existing cards predate this field and are already in use
  },

  // Optional user data (collected during card purchase)
  name: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  contribuinte: { type: String, default: '' }, // Tax ID number
  // Opt-in, not opt-out, per GDPR — unchecked by default at purchase time.
  // Only cards with this true are ever included in a marketing broadcast.
  marketingOptIn: { type: Boolean, default: false },
  
  /**
   * What the physical card was last CONFIRMED to hold (services/cardSync.js).
   *
   * In controller mode the card carries the balance as well as this database, so
   * either can be lost and restored from the other. Comparing the card's balance,
   * ours, and this marker tells "the card missed our last update" (card == marker)
   * from "the card was changed elsewhere" (ours == marker). null = never synced.
   */
  cardSyncedBalance: { type: Number, default: null },
  cardSyncedAt: { type: Date, default: null },

  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

cardSchema.pre('save', function(next) {
  this.updatedAt = new Date()
  next()
})

// Ensure card codes are unique per tenant
cardSchema.index({ tenantId: 1, code: 1 }, { unique: true })

// --- change notifications ---------------------------------------------------
// Every balance change in the app goes through a Mongoose call (save,
// findOneAndUpdate, updateOne), so hooking the model catches all of them —
// spend, top-up, auto-charge, admin edit, sync — without touching each route.
// cardSync.js subscribes to write the new balance onto the physical card.
// (Its own bookkeeping uses the raw collection, which bypasses these hooks.)
const changeListeners = new Set()

export function onCardChanged(fn) {
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}

function notify(tenantId, code) {
  if (!code || changeListeners.size === 0) return
  for (const fn of changeListeners) {
    try { fn(tenantId, String(code)) } catch (err) { console.error('[Card] change listener failed:', err.message) }
  }
}

cardSchema.post('save', function (doc) { notify(doc.tenantId, doc.code) })
// The query's *result* may be the pre-update document; only tenantId/code are
// used, and the listener re-reads the current balance itself.
cardSchema.post('findOneAndUpdate', function (doc) { if (doc) notify(doc.tenantId, doc.code) })
cardSchema.post('updateOne', function () {
  const f = typeof this.getFilter === 'function' ? this.getFilter() : {}
  if (f && f.code) notify(f.tenantId, f.code)
})

export default mongoose.model('Card', cardSchema)

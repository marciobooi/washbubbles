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

export default mongoose.model('Card', cardSchema)

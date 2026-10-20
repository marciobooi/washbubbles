import mongoose from 'mongoose'

const { Schema } = mongoose

/**
 * A QR code on the kiosk screen points to /pagar/<token> (served by the central server). The customer types THEIR MB WAY number on
 * their own phone there; the shop picks it up (once) and asks Eupago for the MB WAY payment. ONE code = ONE session: paid, cancelled,
 * refused, expired or abandoned, it is never used again and a new one is always made. The number is wiped as soon as the shop
 * has taken it, and the row disappears by itself a day after it expires.
 */
const mbwayLinkSchema = new Schema({
  token: { type: String, required: true, unique: true },
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  amount: { type: Number, required: true },
  machines: [{ type: String }],
  status: { type: String, enum: ['waiting', 'phone_received', 'consumed', 'cancelled'], default: 'waiting' },
  phone: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
})
mbwayLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 })

export default mongoose.model('MbwayLink', mbwayLinkSchema)

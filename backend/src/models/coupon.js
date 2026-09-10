import mongoose from 'mongoose'

const { Schema } = mongoose

const couponSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  discountType: { type: String, enum: ['percent', 'fixed'], required: true },
  discountValue: { type: Number, required: true },
  appliesTo: { type: String, enum: ['wash', 'dry', 'both'], default: 'both' },
  // null = unlimited
  maxRedemptions: { type: Number, default: null },
  redemptionCount: { type: Number, default: 0 },
  expiresAt: { type: Date, default: null },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
})

couponSchema.index({ tenantId: 1, code: 1 }, { unique: true })

export default mongoose.model('Coupon', couponSchema)

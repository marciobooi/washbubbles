import mongoose from 'mongoose'

const { Schema } = mongoose

const cardSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  code: { type: String, required: true }, // public card code
  balance: { type: Number, default: 0 },
  
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

import mongoose from 'mongoose'

const priceSchema = new mongoose.Schema({
  type: { type: String, enum: ['wash', 'dry'], required: true },
  weight: { type: Number, required: true }, // kg
  duration: { type: Number, default: null }, // minutes (for wash machines)
  cashPrice: { type: Number, required: true, default: 0 }, // price for cash payment
  cardPrice: { type: Number, required: true, default: 0 }, // price for card payment
  mobilePrice: { type: Number, required: true, default: 0 }, // price for mobile payment
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

// Compound unique index: one price per type+weight combination
priceSchema.index({ type: 1, weight: 1 }, { unique: true })

priceSchema.pre('save', function (next) {
  this.updatedAt = new Date()
  next()
})

priceSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updatedAt: new Date() })
  next()
})

export default mongoose.model('Price', priceSchema)

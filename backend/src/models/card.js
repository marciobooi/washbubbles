import mongoose from 'mongoose'

const { Schema } = mongoose

const cardSchema = new Schema({
  code: { type: String, required: true, unique: true }, // public card code
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

export default mongoose.model('Card', cardSchema)

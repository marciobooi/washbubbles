import mongoose from 'mongoose'

const interfaceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  brand: { type: String, default: '' },
  model: { type: String, default: '' },
  serialNumber: { type: String, required: true, unique: true },
  address: { type: Number, required: true },
  tOn: { type: Number, required: true, default: 100 }, // t_on in ms
  tOff: { type: Number, required: true, default: 100 }, // t_off in ms
  status: { type: String, enum: ['active', 'inactive', 'fault'], default: 'inactive' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

interfaceSchema.pre('save', function (next) {
  this.updatedAt = new Date()
  next()
})

interfaceSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updatedAt: new Date() })
  next()
})

export default mongoose.model('Interface', interfaceSchema)

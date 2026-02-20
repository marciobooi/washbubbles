import mongoose from 'mongoose'

const interfaceSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true },
  brand: { type: String, default: '' },
  model: { type: String, default: '' },
  serialNumber: { type: String, required: true },
  address: { type: Number, required: true },
  ports: { type: Number, required: true, default: 2 }, // number of ports on this interface
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

// Ensure serial numbers are unique per tenant
interfaceSchema.index({ tenantId: 1, serialNumber: 1 }, { unique: true, sparse: true })

export default mongoose.model('Interface', interfaceSchema)

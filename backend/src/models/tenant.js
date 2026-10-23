import mongoose from 'mongoose'

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Public site addresses of this shop (marcioslvinc.ro, www.marcioslvinc.ro). An address belongs to exactly ONE shop.
  domains: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
})

tenantSchema.index({ domains: 1 }, { unique: true, partialFilterExpression: { 'domains.0': { $exists: true } } })

export default mongoose.model('Tenant', tenantSchema)

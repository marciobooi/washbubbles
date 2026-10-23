import mongoose from 'mongoose'

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Public site addresses of this shop (marcioslvinc.ro, www.marcioslvinc.ro). An address belongs to exactly ONE shop.
  domains: { type: [String], default: [] },
  // The customer's contact: gets the DNS instructions and the link to set the administrator's password.
  customerEmail: { type: String, default: '' },
  // 'suspended': the shop's posts stop syncing and its site says it is unavailable; the data stays.
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  // Where the site address is on its way to going live (see services/storeProvisioning.js and the domain service on the host).
  domainState: {
    state: { type: String, enum: ['none', 'pending_dns', 'pending_cert', 'active', 'failed'], default: 'none' },
    message: { type: String, default: '' },
    checkedAt: { type: Date, default: null },
    requestedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    activatedAt: { type: Date, default: null },
    activationEmailSentAt: { type: Date, default: null },
  },
  welcomeEmail: { sentAt: { type: Date, default: null }, error: { type: String, default: '' } },
  createdAt: { type: Date, default: Date.now }
})

tenantSchema.index({ domains: 1 }, { unique: true, partialFilterExpression: { 'domains.0': { $exists: true } } })

export default mongoose.model('Tenant', tenantSchema)

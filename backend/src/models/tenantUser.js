import mongoose from 'mongoose'

const tenantUserSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ['OWNER','ADMIN','MEMBER'], default: 'MEMBER' },
  createdAt: { type: Date, default: Date.now }
})

// One membership per (tenant,user)
tenantUserSchema.index({ tenantId: 1, userId: 1 }, { unique: true })

export default mongoose.model('TenantUser', tenantUserSchema)

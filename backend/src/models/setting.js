import mongoose from 'mongoose'

const { Schema } = mongoose

const settingSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  key: { type: String, required: true },
  value: { type: Schema.Types.Mixed }
}, { timestamps: true }) // updatedAt feeds the sitemap's lastmod

// settings keys are unique per tenant
settingSchema.index({ tenantId: 1, key: 1 }, { unique: true })

export default mongoose.model('Setting', settingSchema)
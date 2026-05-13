import mongoose from 'mongoose'

const { Schema } = mongoose

const userSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  username: { type: String, required: true },
  // email kept optional for compatibility
  email: { type: String, default: null },
  password: { type: String, required: true },
  role: { type: String, default: 'USER' },
  apiKey: { type: String, default: null },
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
  lastSeen: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
})

// Per-tenant uniqueness: usernames, emails and apiKeys are unique within a tenant
userSchema.index({ tenantId: 1, username: 1 }, { unique: true })
userSchema.index({ tenantId: 1, email: 1 }, { unique: true, sparse: true })
// Ensure apiKey uniqueness only when an apiKey actually exists (avoid collisions on null)
userSchema.index(
  { tenantId: 1, apiKey: 1 },
  { unique: true, partialFilterExpression: { apiKey: { $type: 'string' } } }
)

export default mongoose.model('User', userSchema)

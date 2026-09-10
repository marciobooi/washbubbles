import mongoose from 'mongoose'

const { Schema } = mongoose

const userSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  username: { type: String, required: true },
  // email kept optional for compatibility
  email: { type: String, default: null },
  password: { type: String, required: true },
  // Enumerated so a role can never be set to an arbitrary string from a request
  // body — the last line of defence behind the route-level role checks.
  role: { type: String, default: 'USER', enum: ['USER', 'KIOSK', 'ADMIN', 'SUPERADMIN', 'STAFF', 'TECHNICIAN'] },
  apiKey: { type: String, default: null },
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
  lastSeen: { type: Date, default: null },
  // Set once an "offline too long" alert email has gone out for this kiosk,
  // so the watchdog doesn't re-send every check while the outage continues —
  // cleared automatically the moment lastSeen looks healthy again.
  offlineAlertSent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})

// Per-tenant uniqueness: usernames, emails and apiKeys are unique within a tenant
userSchema.index({ tenantId: 1, username: 1 }, { unique: true })
// `sparse` skips a document only when *every* indexed field is absent. `tenantId`
// is always present and `email` defaults to null, so sparse skipped nothing here
// and the second user created without an email in a tenant failed with E11000.
// `partialFilterExpression` is the correct tool for a compound index.
userSchema.index(
  { tenantId: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
)
// Ensure apiKey uniqueness only when an apiKey actually exists (avoid collisions on null)
userSchema.index(
  { tenantId: 1, apiKey: 1 },
  { unique: true, partialFilterExpression: { apiKey: { $type: 'string' } } }
)

export default mongoose.model('User', userSchema)

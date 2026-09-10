import mongoose from 'mongoose'

const { Schema } = mongoose

const maintenanceTicketSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  machineId: { type: Schema.Types.ObjectId, ref: 'Machine', required: true },
  source: { type: String, enum: ['auto_fault', 'manual'], default: 'auto_fault' },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  description: { type: String, default: '' },
  faultCode: { type: String, default: '' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
})

// Dedupe lookup: "is there already an open ticket for this machine" — checked
// on every hardware fault event, so a flapping fault doesn't spam tickets.
maintenanceTicketSchema.index({ tenantId: 1, machineId: 1, status: 1 })

export default mongoose.model('MaintenanceTicket', maintenanceTicketSchema)

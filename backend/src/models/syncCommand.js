import mongoose from 'mongoose'

const { Schema } = mongoose

/**
 * SyncCommand Model
 * Used for remote maintenance commands sent from Admin Dashboard to Kiosks
 */
const syncCommandSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  kioskId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  
  type: { 
    type: String, 
    enum: ['reboot', 'update_config', 'upload_logs', 'screenshot', 'clear_queue', 'sync_now', 'start_machine', 'end_machine', 'set_service', 'empty_hopper', 'blank_card', 'gift_card'],
    required: true 
  },
  payload: { type: Schema.Types.Mixed },
  
  status: { 
    type: String, 
    enum: ['pending', 'executing', 'done', 'failed'], 
    default: 'pending',
    index: true
  },
  error: { type: String },
  result: { type: Schema.Types.Mixed },
  executedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('SyncCommand', syncCommandSchema)

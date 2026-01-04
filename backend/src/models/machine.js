import mongoose from 'mongoose'

const { Schema } = mongoose

const machineSchema = new Schema({
  name: { type: String, required: true },
  number: { type: Number }, // machine display number
  brand: { type: String, default: '' },
  model: { type: String, default: '' },
  serialNumber: { type: String, default: '' },
  status: { type: String, enum: ['free','working','offline','reserved','fault'], default: 'free' },
  statusText: { type: String },
  cycle: { type: Number, default: 0 },
  weight: { type: Number, default: 0 }, // kg - used to lookup price from Price collection
  type: { type: String, enum: ['wash','dry'], default: 'wash' },
  icon: { type: String },
  
  // Low-level device integration (from old code)
  intId: { type: Number }, // Internal ID used by low-level controller
  channel: { type: Number }, // Hardware channel number
  impulses: { type: String, default: '1' }, // Pulse count for activation
  
  // Reservation tracking
  reserved: { type: Boolean, default: false },
  reservedBy: { type: String, default: null }, // Card number or session ID
  reservedAt: { type: Date, default: null },
  reservationDuration: { type: Number, default: 0 }, // Minutes
  
  // Runtime tracking
  currentProgram: { type: String, default: null },
  startedAt: { type: Date, default: null },
  estimatedEndTime: { type: Date, default: null },
  runningDuration: { type: Number, default: 0 }, // Minutes
  
  // Interface linking
  interfaceId: { type: Schema.Types.ObjectId, ref: 'Interface' },
  port: { type: Number }, // port number on the interface (1-based)
  activation: { type: String, enum: ['high', 'low'], default: 'high' },
  // Dry machine specific
  tImp: { type: Number, default: null }, // time per impulse in minutes (only for dry machines)
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('Machine', machineSchema)

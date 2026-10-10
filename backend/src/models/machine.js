import mongoose from 'mongoose'

const { Schema } = mongoose

const machineSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true },
  number: { type: Number }, // machine display number
  brand: { type: String, default: '' },
  model: { type: String, default: '' },
  serialNumber: { type: String, default: '' },
  status: { type: String, enum: ['free','working','offline','reserved','fault'], default: 'free' },
  statusText: { type: String },
  // Taken out of service by the operator (admin "Offline"). Unlike `status` this is configuration:
  // it travels from the central server to the shop and the hardware poll never clears it.
  outOfService: { type: Boolean, default: false },
  serviceStatus: { type: String, enum: ['offline', 'fault', null], default: null }, // which one: "Offline" or "Avariada"
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
  createdAt: { type: Date, default: Date.now },

  // Preventive maintenance — set manually by admin.js's POST /machines/:id/service,
  // separate from `cycle` (a running total, incremented in coinMachine.js on
  // every completed wash/dry cycle).
  lastServicedAt: { type: Date, default: null }
})

// Machine numbers should be unique per tenant when provided.
// Plain `sparse` doesn't help on a compound index: since tenantId is always
// present, Mongo still indexes (and collides on) documents missing `number`.
// A partial index actually excludes them.
machineSchema.index({ tenantId: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $exists: true } } })

// `coinMachine.js` resolves a machine by intId on every hardware status packet —
// several per second across a site. Without this it is a collection scan each time.
machineSchema.index(
  { tenantId: 1, intId: 1 },
  { partialFilterExpression: { intId: { $type: 'number' } } }
)

// Same for the {interfaceId, port} lookup on each status packet. Unique as well:
// `admin.js` only checks port collisions in application code with a findOne, so
// two admins saving at once could both assign the same physical port — after
// which one customer's payment starts the other's machine.
machineSchema.index(
  { tenantId: 1, interfaceId: 1, port: 1 },
  { unique: true, partialFilterExpression: { interfaceId: { $type: 'objectId' }, port: { $type: 'number' } } }
)

export default mongoose.model('Machine', machineSchema)

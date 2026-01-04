import mongoose from 'mongoose'

const peripheralSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { 
    type: String, 
    required: true,
    enum: ['bill_acceptor', 'card_dispenser', 'coin_acceptor', 'hopper', 'printer', 'rfid_reader']
  },
  enabled: { type: Boolean, default: true },
  protocol: { 
    type: String,
    enum: ['rs232', 'pulse', 'cctalk', 'MDB', 'usb', 'ethernet'],
    default: 'pulse'
  },
  address: { type: String, default: '' },
  baudRate: { type: String, default: '' },
  brand: { type: String, default: '' },
  model: { type: String, default: '' },
  serialNumber: { type: String, default: '' },
  status: {
    type: String,
    enum: ['ok', 'fault', 'offline', 'unknown'],
    default: 'unknown'
  },
  image: { type: String, default: '' },
  
  // Hopper-specific configuration
  hopperConfig: {
    coinDenominations: { 
      type: [Number], 
      default: [2.00, 1.00, 0.50, 0.20, 0.10, 0.05] // Euro coins
    },
    maxStock: { type: Number, default: 500 }, // Maximum coins per denomination
    currentStock: { 
      type: Map, 
      of: Number,
      default: {} // { '2.00': 100, '1.00': 150, ... }
    }
  }
}, { timestamps: true })

export default mongoose.model('Peripheral', peripheralSchema)

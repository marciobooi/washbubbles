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
  image: { type: String, default: '' }
}, { timestamps: true })

export default mongoose.model('Peripheral', peripheralSchema)

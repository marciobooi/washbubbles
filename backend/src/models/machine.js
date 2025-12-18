import mongoose from 'mongoose'

const { Schema } = mongoose

const machineSchema = new Schema({
  name: { type: String, required: true },
  status: { type: String, enum: ['free','working','offline'], default: 'free' },
  statusText: { type: String },
  cycle: { type: Number, default: 0 },
  weight: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  loyaltyPrice: { type: Number, default: 0 },
  type: { type: String, enum: ['wash','dry'], default: 'wash' },
  icon: { type: String },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('Machine', machineSchema)

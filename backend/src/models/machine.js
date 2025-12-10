import mongoose from 'mongoose'

const { Schema } = mongoose

const machineSchema = new Schema({
  name: { type: String, required: true },
  status: { type: Schema.Types.Mixed },
  cycle: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('Machine', machineSchema)

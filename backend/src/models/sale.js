import mongoose from 'mongoose'

const { Schema } = mongoose

const saleSchema = new Schema({
  machineId: { type: Schema.Types.ObjectId, ref: 'Machine', required: true },
  amount: { type: Number, required: true },
  items: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('Sale', saleSchema)

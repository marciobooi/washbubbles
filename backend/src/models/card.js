import mongoose from 'mongoose'

const { Schema } = mongoose

const cardSchema = new Schema({
  code: { type: String, required: true, unique: true }, // public card code
  balance: { type: Number, default: 0 },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('Card', cardSchema)

import mongoose from 'mongoose'

const { Schema } = mongoose

const userSchema = new Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'USER' },
  apiKey: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('User', userSchema)

import mongoose from 'mongoose'

const { Schema } = mongoose

const userSchema = new Schema({
  username: { type: String, required: true, unique: true },
  // email kept optional for compatibility
  email: { type: String, unique: true, sparse: true },
  password: { type: String, required: true },
  role: { type: String, default: 'USER' },
  apiKey: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('User', userSchema)

import mongoose from 'mongoose'

const { Schema } = mongoose

const settingSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed }
})

export default mongoose.model('Setting', settingSchema)
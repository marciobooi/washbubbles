import mongoose from 'mongoose'

/** Settings of the PLATFORM (all shops together): support e-mail, the outgoing mail account. Not tied to a shop on purpose. */
const platformSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
  updatedAt: { type: Date, default: Date.now },
})

export default mongoose.model('PlatformSetting', platformSettingSchema)

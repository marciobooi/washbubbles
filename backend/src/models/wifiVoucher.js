import mongoose from 'mongoose'

const { Schema } = mongoose

/**
 * One row per wash/dry purchase that earned a guest-WiFi voucher. Keyed on
 * batchId so a retried voucher request for the same purchase (network hiccup,
 * customer re-opening the popup) returns the SAME code instead of minting a
 * fresh one from the UniFi controller every time.
 */
const wifiVoucherSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  batchId: { type: String, required: true },
  code: { type: String, required: true },
  ssid: { type: String },
  durationMinutes: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
})

wifiVoucherSchema.index({ tenantId: 1, batchId: 1 }, { unique: true })

export default mongoose.model('WifiVoucher', wifiVoucherSchema)

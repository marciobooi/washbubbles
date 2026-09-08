import express from 'express'
import Sale from '../models/sale.js'
import Setting from '../models/setting.js'
import WifiVoucher from '../models/wifiVoucher.js'
import { requireKiosk } from '../middleware/auth.js'
import { withTenant } from '../services/tenant.js'
import unifiVoucher from '../services/unifiVoucher.js'

const router = express.Router()

const DEFAULT_DURATION_MINUTES = 60

async function getSettingValue(SettingT, key, fallback) {
  const row = await SettingT.findOne({ key }).lean()
  return row && row.value != null ? row.value : fallback
}

/**
 * POST /api/wifi/voucher — issue (or re-fetch) the guest-WiFi voucher earned
 * by a wash/dry purchase.
 *
 * Idempotent on batchId: a retried call for the same purchase (popup
 * re-opened, a flaky connection) returns the SAME voucher instead of minting
 * a new one on the controller every time.
 */
router.post('/voucher', requireKiosk, async (req, res) => {
  try {
    const batchId = String(req.body?.batchId || '').trim()
    if (!batchId) return res.status(400).json({ error: 'batchId is required' })

    const SettingT = withTenant(Setting, req)
    const enabled = await getSettingValue(SettingT, 'wifi.enabled', false)
    if (!enabled) return res.status(403).json({ error: 'WiFi voucher feature is disabled' })

    const VoucherT = withTenant(WifiVoucher, req)
    const existing = await VoucherT.findOne({ batchId }).lean()
    if (existing) {
      return res.json({
        code: existing.code, ssid: existing.ssid,
        durationMinutes: existing.durationMinutes, expiresAt: existing.expiresAt
      })
    }

    // Only issue a voucher for a batch that actually contains a real
    // machine payment — otherwise any kiosk-authenticated caller could mint
    // free WiFi vouchers by making up a batchId.
    const SaleT = withTenant(Sale, req)
    const sale = await SaleT.findOne({ batchId, type: 'payment', machineId: { $ne: null } }).lean()
    if (!sale) return res.status(404).json({ error: 'No matching machine purchase for this batch' })

    const durationMinutes = Number(await getSettingValue(SettingT, 'wifi.durationMinutes', DEFAULT_DURATION_MINUTES)) || DEFAULT_DURATION_MINUTES
    const ssid = await getSettingValue(SettingT, 'wifi.ssid', '')

    const code = await unifiVoucher.createVoucher(durationMinutes, `sale ${sale._id}`)
    const expiresAt = new Date(Date.now() + durationMinutes * 60000)

    const voucher = await VoucherT.create({ batchId, code, ssid, durationMinutes, expiresAt })
    res.json({ code: voucher.code, ssid: voucher.ssid, durationMinutes: voucher.durationMinutes, expiresAt: voucher.expiresAt })
  } catch (err) {
    // The controller being unreachable/misconfigured must not look like the
    // sale itself failed — the money already moved by the time this runs.
    console.error('[Wifi] Voucher creation failed:', err.message)
    res.status(502).json({ error: 'Could not issue a WiFi voucher right now' })
  }
})

export default router

import React, { useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import Modal from './ui/Modal'
import { Wifi, Camera, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Shown after a wash/dry purchase when a WiFi voucher was issued.
 *
 * The guest network itself is open (no password) — the voucher code is what
 * the UniFi captive portal actually checks. When the SSID is known, the QR
 * encodes a standard WiFi-join payload (`WIFI:T:nopass;S:<ssid>;;`), which a
 * phone's own camera recognises as "join this network" — one tap connects,
 * and the captive portal then opens on its own. That still leaves the
 * voucher code itself to be typed into the portal by hand — nothing about a
 * UniFi voucher (kept deliberately, per-purchase duration matters here) can
 * skip that step. If no SSID is configured, the QR just encodes the code as
 * plain text (join is manual too, in that case).
 *
 * Everything after "tap Join" happens on the customer's own phone, outside
 * this app — the captive portal page itself is UniFi's, not ours, so it
 * can't be relabelled. This screen's job is to leave nothing to guess: say
 * exactly what the phone will do at each step, and keep the code big enough
 * to read back from across the room (or photograph) once they're looking at
 * their phone instead of the kiosk.
 */
export default function WifiQrModal({ open, onClose, voucher }) {
  const { t } = useTranslation('cart')
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!open || !voucher?.code || !canvasRef.current) return
    const payload = voucher.ssid ? `WIFI:T:nopass;S:${voucher.ssid};;` : voucher.code
    QRCode.toCanvas(canvasRef.current, payload, { width: 200, margin: 1 }, (err) => {
      if (err) console.error('[WifiQrModal] Failed to render QR code', err)
    })
  }, [open, voucher?.code, voucher?.ssid])

  if (!voucher) return null

  return (
    <Modal open={open} onClose={onClose} title={t('wifiTitle')}>
      <div className="flex flex-col items-center gap-5 text-center max-w-sm mx-auto">
        <div className="flex items-center gap-2 text-primary-700">
          <Wifi className="h-6 w-6" />
          <h2 className="text-xl font-bold">{t('wifiHeadline')}</h2>
        </div>

        <div className="w-full flex flex-col gap-3">
          <Step number={1} icon={Camera} title={voucher.ssid ? t('wifiStep1Qr') : t('wifiStep1Manual')}>
            {voucher.ssid && <canvas ref={canvasRef} className="rounded-lg mt-2 mx-auto" />}
          </Step>

          <Step number={2} icon={Wifi} title={t('wifiStep2')}>
            <div className="text-xs text-neutral-500 mt-0.5">{t('wifiStep2Hint')}</div>
          </Step>

          <Step number={3} icon={KeyRound} title={t('wifiStep3')}>
            <div className="mt-2 text-3xl font-mono font-bold tracking-widest text-primary-700 bg-primary-50 rounded-lg py-2 text-center">
              {voucher.code}
            </div>
          </Step>
        </div>

        {voucher.durationMinutes ? (
          <div className="text-xs text-neutral-500">
            {t('wifiValid', { min: voucher.durationMinutes })}
          </div>
        ) : null}

        <div className="text-xs text-neutral-400">
          {t('wifiTip')}
        </div>

        <button
          onClick={onClose}
          className="mt-1 px-6 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700"
        >
          {t('closeBtn')}
        </button>
      </div>
    </Modal>
  )
}

function Step({ number, icon: Icon, title, children }) {
  return (
    <div className="flex items-start gap-3 text-left bg-neutral-50 rounded-lg p-3">
      <div className="shrink-0 h-7 w-7 rounded-full bg-primary-600 text-white flex items-center justify-center font-bold text-sm">
        {number}
      </div>
      <div className="flex-1 text-sm text-neutral-800">
        <div className="flex items-center gap-1.5">
          <Icon className="h-4 w-4 text-primary-600 shrink-0" />
          <span>{title}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

import React, { useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import Modal from './ui/Modal'
import { Wifi } from 'lucide-react'

/**
 * Shown after a wash/dry purchase when a WiFi voucher was issued.
 *
 * The QR just encodes the voucher's own redemption link (not raw WPA
 * credentials) — the guest network itself is open, so a phone still needs to
 * join it manually and hit the captive portal to actually get online. The
 * link is a convenience for a phone that already scans well; the code
 * printed below it is the fallback for typing it in by hand.
 */
export default function WifiQrModal({ open, onClose, voucher }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!open || !voucher?.code || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, voucher.code, { width: 220, margin: 1 }, (err) => {
      if (err) console.error('[WifiQrModal] Failed to render QR code', err)
    })
  }, [open, voucher?.code])

  if (!voucher) return null

  return (
    <Modal open={open} onClose={onClose} title="WiFi grátis">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-2 text-primary-700">
          <Wifi className="h-6 w-6" />
          <h2 className="text-xl font-bold">Internet grátis para a sua visita</h2>
        </div>

        <canvas ref={canvasRef} className="rounded-lg" />

        <div>
          <div className="text-xs text-neutral-500">Código</div>
          <div className="text-2xl font-mono font-bold tracking-widest">{voucher.code}</div>
        </div>

        <ol className="text-sm text-neutral-700 text-left list-decimal list-inside space-y-1 max-w-xs">
          <li>Ligue-se à rede WiFi{voucher.ssid ? ` "${voucher.ssid}"` : ''}</li>
          <li>Quando a página de acesso abrir, introduza o código acima</li>
        </ol>

        {voucher.durationMinutes ? (
          <div className="text-xs text-neutral-500">
            Válido por {voucher.durationMinutes} minutos após a ativação
          </div>
        ) : null}

        <button
          onClick={onClose}
          className="mt-2 px-6 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700"
        >
          Fechar
        </button>
      </div>
    </Modal>
  )
}

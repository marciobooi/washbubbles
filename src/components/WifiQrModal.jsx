import React, { useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import Modal from './ui/Modal'
import { Wifi } from 'lucide-react'

/**
 * Shown after a wash/dry purchase when a WiFi voucher was issued.
 *
 * The guest network itself is open (no password) — the voucher code is what
 * the UniFi captive portal actually checks. When the SSID is known, the QR
 * encodes a standard WiFi-join payload (`WIFI:T:nopass;S:<ssid>;;`), which a
 * phone's own camera recognises as "join this network" — one tap connects,
 * and the captive portal then opens on its own. That still leaves the
 * voucher code itself to be typed into the portal by hand; nothing about a
 * UniFi voucher can skip that step. If no SSID is configured, the QR just
 * encodes the code as plain text (join is manual too, in that case).
 */
export default function WifiQrModal({ open, onClose, voucher }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!open || !voucher?.code || !canvasRef.current) return
    const payload = voucher.ssid ? `WIFI:T:nopass;S:${voucher.ssid};;` : voucher.code
    QRCode.toCanvas(canvasRef.current, payload, { width: 220, margin: 1 }, (err) => {
      if (err) console.error('[WifiQrModal] Failed to render QR code', err)
    })
  }, [open, voucher?.code, voucher?.ssid])

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
          {voucher.ssid ? (
            <li>Aponte a câmara do telemóvel para o código para se ligar à rede</li>
          ) : (
            <li>Ligue-se à rede WiFi do estabelecimento</li>
          )}
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

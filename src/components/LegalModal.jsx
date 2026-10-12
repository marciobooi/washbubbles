import React, { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import Modal from './ui/Modal'
import api from '@/services/api'
import { useTranslation } from 'react-i18next'
import { mergeLegal, legalText, parseLegal } from '@/lib/defaultLegal'

let cache = null
/** The shop's legal info, from the server (setting `legal.info`), with the defaults behind it. */
export function useLegal() {
  const [info, setInfo] = useState(cache || mergeLegal(null))
  useEffect(() => {
    let alive = true
    api.getPublicSetting('legal.info')
      .then((r) => { const m = mergeLegal(r && r.value); cache = m; if (alive) setInfo(m) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return info
}

/** One window for the three legal screens: privacy (RGPD), terms and the complaints book (QR). */
export default function LegalModal({ open, kind, onClose }) {
  const { t, i18n } = useTranslation('cart')
  const info = useLegal()
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!open || kind !== 'complaints' || !canvasRef.current || !info.complaintsUrl) return
    QRCode.toCanvas(canvasRef.current, info.complaintsUrl, { width: 260, margin: 1 }, () => {})
  }, [open, kind, info.complaintsUrl])

  if (!open) return null
  const lang = i18n.language
  const title = kind === 'terms' ? t('legalTerms') : kind === 'complaints' ? t('legalComplaints') : t('legalPrivacy')
  const body = kind === 'terms' ? legalText(info.terms, lang) : kind === 'privacy' ? legalText(info.privacy, lang) : ''
  const parts = [info.company, info.nif && `NIF ${info.nif}`, info.address, info.phone, info.email].filter(Boolean)

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="min(68vw, 740px)">
      <div className="flex flex-col gap-5 pt-1">
        <h3 className="text-3xl font-extrabold tracking-tight text-emerald-900 pr-14">{title}</h3>

        {kind === 'complaints' ? (
          <div className="flex flex-col items-center text-center gap-5 py-4">
            <p className="text-xl text-slate-600 max-w-md">{t('legalComplaintsHint')}</p>
            <canvas ref={canvasRef} className="rounded-xl border border-slate-200" />
            <p className="text-lg text-slate-500 break-all">{info.complaintsUrl}</p>
          </div>
        ) : (
          <div className="max-h-[46vh] overflow-y-auto touch-pan-y pr-3 text-xl leading-relaxed text-slate-700">
            {parseLegal(body).map((b, i) => b.type === 'h'
              ? <h4 key={i} className="mt-6 first:mt-0 mb-2 text-2xl font-bold text-emerald-900">{b.text}</h4>
              : b.type === 'ul'
                ? <ul key={i} className="list-disc pl-7 space-y-1.5">{b.items.map((it, k) => <li key={k}>{it}</li>)}</ul>
                : <p key={i} className="mb-2">{b.text}</p>)}
          </div>
        )}

        {parts.length > 0 && (
          <div className="rounded-2xl bg-slate-50 border border-slate-200 px-5 py-4 text-lg text-slate-600">
            <div className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-1">{t('legalController')}</div>
            {parts.join(' · ')}
          </div>
        )}

        <button type="button" onClick={onClose} className="h-[72px] rounded-2xl bg-[#00875A] text-white font-bold text-2xl active:scale-[0.98]">
          {t('closeBtn')}
        </button>
      </div>
    </Modal>
  )
}

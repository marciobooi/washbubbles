import React from 'react'
import { useTranslation } from 'react-i18next'
import { Smartphone } from 'lucide-react'
import QRCode from 'qrcode'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'

const kioskHeaders = () => {
  const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
  const key = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
  return key ? { Authorization: `ApiKey ${key}` } : undefined
}
const call = (path, opts = {}) => api.request(`/gateways/mbway${path}`, { headers: kioskHeaders(), skipAuth: true, expect: 'json', ...opts })
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

/**
 * MB WAY at the kiosk: the customer types the phone number, approves in the MB WAY app (5 minutes) and the machines start by
 * themselves when the shop sees the payment (it asks Eupago every 2 s). Machines only; a recharge is cash only.
 */
// `kind` is 'machines' (a cart of machines, the default), 'card_purchase' (a new card: `extra` = { customer }) or 'recharge' (`extra` = { amount, cardCode }).
// The server prices all of them itself; the screen only says WHAT is being bought.
export default function MbwayPanel({ items, total, couponCode, batchId, kind = 'machines', extra = null, onPaid, onClose, onAbandon }) {
  const { t } = useTranslation('cart')
  const [step, setStep] = React.useState('choose') // choose | qr | phone | sending | waiting | problem
  // ONE QR = ONE session: a new code every time, and giving the screen up (back, cancel, error, retry, close) ends the code for good
  const [link, setLink] = React.useState(null) // { token, url, qr }
  const linkRef = React.useRef(null)
  const [phone, setPhone] = React.useState('')
  const [pay, setPay] = React.useState(null)
  const [problem, setProblem] = React.useState('')
  const [now, setNow] = React.useState(Date.now())
  const alive = React.useRef(true)
  // Once a payment was REQUESTED, cancelling or failing ends the purchase: the cart is emptied (nothing was charged, the machine is untouched).
  const requested = React.useRef(false)
  const dropLink = React.useCallback(() => {
    const l = linkRef.current
    linkRef.current = null
    if (l) call(`/link/${l.token}/cancel`, { method: 'POST' }).catch(() => {})
  }, [])
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; dropLink() } }, [dropLink])

  async function chooseQr() {
    setStep('sending')
    try {
      const r = await call('/link', { method: 'POST', json: { items: kind === 'machines' ? items.map((i) => ({ _id: i._id || i.productId || i.id, quantity: i.quantity })) : [], ...(kind !== 'machines' ? { kind, ...(extra || {}) } : {}), batchId, couponCode: couponCode || undefined } })
      const qr = await QRCode.toDataURL(r.url, { width: 560, margin: 1, errorCorrectionLevel: 'M' })
      if (!alive.current) { call(`/link/${r.token}/cancel`, { method: 'POST' }).catch(() => {}); return }
      linkRef.current = { token: r.token }
      setLink({ token: r.token, url: r.url, qr, expiresAt: r.expiresAt }); setStep('qr')
    } catch (e) {
      if (!alive.current) return
      setProblem(t('mbwayLinkFailed')); setStep('problem')
    }
  }
  function backToChoose() { dropLink(); setLink(null); setPay(null); setStep('choose') }

  // QR on screen: ask the shop every 2 s whether the customer has typed the number on their phone
  React.useEffect(() => {
    if (step !== 'qr' || !link) return undefined
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const poll = setInterval(async () => {
      try {
        const r = await call(`/link/${link.token}`)
        if (!alive.current) return
        if (r.status === 'started') { linkRef.current = null; requested.current = true; setPay(r.payment); setLink(null); setStep('waiting') }
        else if (r.status === 'expired' || r.status === 'not-found') { linkRef.current = null; setProblem(t('mbwayLinkExpired')); setLink(null); setStep('problem') }
        else if (r.status === 'error') { linkRef.current = null; setProblem(r.code === 'below-minimum' ? t('mbwayMinimum') : (r.code === 'cart-refused' || r.code === 'price-changed') ? t('mbwayCartChanged') : t('mbwayRefused')); setLink(null); setStep('problem') }
      } catch { /* the shop is busy for a moment: ask again */ }
    }, 2000)
    return () => { clearInterval(tick); clearInterval(poll) }
  }, [step, link?.token])

  async function send() {
    const digits = phone.replace(/\D/g, '')
    if (!/^(?:00351|351)?9\d{8}$/.test(digits)) { toast({ title: t('mbwayBadPhone'), variant: 'warning' }); return }
    setStep('sending')
    try {
      const body = { items: kind === 'machines' ? items.map((i) => ({ _id: i._id || i.productId || i.id, quantity: i.quantity })) : [], ...(kind !== 'machines' ? { kind, ...(extra || {}) } : {}), phone: digits, batchId, couponCode: couponCode || undefined, expectedAmount: Number(total) }
      const r = await call('/start', { method: 'POST', json: body })
      if (!alive.current) return
      requested.current = true
      setPay(r); setStep('waiting')
    } catch (e) {
      if (!alive.current) return
      const code = e?.body?.code
      setProblem(code === 'bad-phone' ? t('mbwayBadPhone') : code === 'below-minimum' ? t('mbwayMinimum') : code === 'mbway-off' ? t('mbwayOff') : (code === 'price-changed' || code === 'cart-refused') ? t('mbwayCartChanged') : (e?.body?.error ? t('mbwayRefused') : t('mbwayFailed')))
      setStep('problem')
    }
  }

  // while waiting: ask every 2 s, and tick the countdown
  React.useEffect(() => {
    if (step !== 'waiting' || !pay) return undefined
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const poll = setInterval(async () => {
      try {
        const r = await call(`/${pay.id}`)
        if (!alive.current) return
        if (r.status === 'started') { clearInterval(poll); onPaid?.(r) }
        else if (r.status === 'start_failed') { setProblem(t('mbwayStartFailed')); setStep('problem') }
        else if (r.status === 'failed') { setProblem(t('mbwayFailed')); setStep('problem') }
        else if (r.status === 'expired') { setProblem(t('mbwayExpired')); setStep('problem') }
        else if (r.status === 'cancelled') { setStep('phone') }
      } catch { /* the shop is busy for a moment: ask again */ }
    }, 2000)
    return () => { clearInterval(tick); clearInterval(poll) }
  }, [step, pay?.id])

  async function cancel() {
    dropLink()
    if (step === 'waiting' && pay) {
      try { await call(`/${pay.id}/cancel`, { method: 'POST' }) } catch { /* the shop keeps following it */ }
      onAbandon?.() // a payment was requested and the customer gave up: the cart is emptied
      return
    }
    onClose?.()
  }

  const left = pay ? new Date(pay.expiresAt).getTime() - now : 0
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0']
  const press = (k) => setPhone((p) => (k === '⌫' ? p.slice(0, -1) : (p + k).slice(0, 9)))
  const nice = phone.replace(/(\d{3})(?=\d)/g, '$1 ').trim()

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-6" onClick={(e) => e.stopPropagation()}>
      <div role="dialog" aria-modal="true" className="w-full bg-white rounded-[2rem] shadow-2xl p-9 flex flex-col gap-6" style={{ maxWidth: 'min(80vw, 760px)' }}>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-[#d3101c]/10 flex items-center justify-center"><Smartphone className="w-9 h-9 text-[#d3101c]" strokeWidth={1.8} /></div>
          <div>
            <div className="text-4xl font-black text-slate-900">MB WAY</div>
            <div className="text-xl text-slate-500">{t('mbwayAmount', { amount: `${Number(total).toFixed(2).replace('.', ',')}€` })}</div>
          </div>
        </div>

        {step === 'choose' && (
          <>
            <div className="text-2xl font-semibold text-slate-700">{t('mbwayChoose')}</div>
            <button type="button" onClick={chooseQr} className="min-h-[96px] rounded-2xl bg-[#d3101c] text-white font-bold text-3xl active:scale-[0.98] px-6">{t('mbwayScan')}</button>
            <button type="button" onClick={() => setStep('phone')} className="min-h-[96px] rounded-2xl bg-white border-2 border-slate-300 text-slate-800 font-bold text-3xl active:scale-[0.98] px-6">{t('mbwayType')}</button>
            <button type="button" onClick={cancel} className="h-[72px] rounded-2xl bg-slate-100 text-slate-600 font-bold text-2xl active:scale-[0.98]">{t('mbwayBack')}</button>
          </>
        )}

        {step === 'qr' && link && (
          <>
            <div className="text-2xl font-semibold text-slate-700 text-center">{t('mbwayScanTitle')}</div>
            <img src={link.qr} alt="QR" className="mx-auto w-[360px] h-[360px] rounded-2xl border-2 border-slate-200" />
            <div className="text-xl text-slate-600 text-center">{t('mbwayScanHint')}</div>
            <div className="text-center text-slate-500 text-lg tabular-nums">{t('mbwayQrValid', { time: mmss(new Date(link.expiresAt).getTime() - now) })}</div>
            <button type="button" onClick={backToChoose} className="h-[72px] rounded-2xl bg-slate-100 text-slate-600 font-bold text-2xl active:scale-[0.98]">{t('mbwayBack')}</button>
          </>
        )}

        {(step === 'phone' || step === 'sending') && (
          <>
            <div className="text-2xl font-semibold text-slate-700">{t('mbwayPhoneLabel')}</div>
            <div className="h-20 rounded-2xl bg-slate-50 border-2 border-slate-200 flex items-center justify-center text-5xl font-bold tracking-wider text-slate-900 tabular-nums">{nice || <span className="text-slate-300">9•• ••• •••</span>}</div>
            <div className="grid grid-cols-3 gap-3">
              {keys.map((k) => (
                <button key={k} type="button" onClick={() => press(k)} className={`h-[72px] rounded-2xl bg-white border-2 border-slate-200 text-4xl font-bold text-slate-800 active:scale-95 ${k === '0' ? 'col-start-2' : ''}`}>{k}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button type="button" onClick={backToChoose} className="h-[72px] rounded-2xl bg-slate-100 text-slate-600 font-bold text-2xl active:scale-[0.98]">{t('mbwayBack')}</button>
              <button type="button" disabled={step === 'sending' || phone.length < 9} onClick={send} className="h-[72px] rounded-2xl bg-[#d3101c] text-white font-bold text-2xl disabled:opacity-40 active:scale-[0.98]">{step === 'sending' ? t('mbwaySending') : t('mbwaySend')}</button>
            </div>
          </>
        )}

        {step === 'waiting' && (
          <>
            <div className="rounded-2xl bg-amber-50 border-2 border-amber-200 p-6 text-center">
              <div className="text-3xl font-bold text-slate-900">{t('mbwayWaiting')}</div>
              <div className="text-xl text-slate-600 mt-2">{t('mbwayWaitingHint', { phone: pay?.phone || '' })}</div>
            <div className="text-2xl font-bold text-slate-900 mt-3">{t('mbwayAmount', { amount: `${Number(pay?.amount ?? total).toFixed(2).replace('.', ',')}€` })}</div>
              <div className="text-6xl font-black text-[#d3101c] tabular-nums mt-4">{mmss(left)}</div>
            </div>
            <button type="button" onClick={cancel} className="h-[72px] rounded-2xl bg-slate-100 text-slate-600 font-bold text-2xl active:scale-[0.98]">{t('mbwayCancel')}</button>
          </>
        )}

        {step === 'problem' && (
          <>
            <div className="rounded-2xl bg-rose-50 border-2 border-rose-200 p-6 text-center text-2xl font-semibold text-rose-800">{problem}</div>
            {requested.current ? (
              <button type="button" onClick={() => onAbandon?.()} className="h-[72px] rounded-2xl bg-slate-100 text-slate-700 font-bold text-2xl active:scale-[0.98]">{t('mbwayOk')}</button>
            ) : (
            <div className="grid grid-cols-2 gap-4">
              <button type="button" onClick={onClose} className="h-[72px] rounded-2xl bg-slate-100 text-slate-600 font-bold text-2xl active:scale-[0.98]">{t('mbwayBack')}</button>
              <button type="button" onClick={backToChoose} className="h-[72px] rounded-2xl bg-[#d3101c] text-white font-bold text-2xl active:scale-[0.98]">{t('mbwayRetry')}</button>
            </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

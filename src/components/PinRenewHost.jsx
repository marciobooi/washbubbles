import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { setPinRenewHandler } from '@/lib/pinRenew'

/**
 * "PIN expirado": the staff PIN is renewed every Monday. When the PIN typed at the kiosk was right but has expired, this popup asks
 * for the OLD PIN again, a new one and its confirmation (OK / Anular). The old PIN is asked here and not reused from the PIN screen: a
 * popup left open by staff must not let a customer set a PIN without knowing the old one. The server checks it too.
 */
export default function PinRenewHost() {
  const { t } = useTranslation('cart')
  const [ctx, setCtx] = useState(null) // { apiKey } of the kiosk; the PIN that was just refused as expired is NOT kept
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setPinRenewHandler((c) => { setOldPin(''); setNewPin(''); setConfirm(''); setError(''); setCtx({ apiKey: c?.apiKey }) }); return () => setPinRenewHandler(null) }, [])
  if (!ctx) return null

  const close = () => { setCtx(null); setOldPin(''); setNewPin(''); setConfirm(''); setError('') }
  async function ok() {
    setError('')
    if (!oldPin) return setError(t('pinRenewOldMissing'))
    if (!/^\d{4,8}$/.test(newPin)) return setError(t('pinRenewFormat'))
    if (newPin !== confirm) return setError(t('pinRenewMismatch'))
    setSaving(true)
    try {
      await api.renewStaffPin({ pin: oldPin, newPin, confirm }, { apiKey: ctx.apiKey })
      close()
      toast({ title: t('pinRenewDone'), variant: 'success' })
    } catch (e) {
      const code = e?.body?.code
      setError(code === 'invalid-pin' ? t('pinRenewOldWrong') : code === 'same-pin' ? t('pinRenewSame') : code === 'mismatch' ? t('pinRenewMismatch') : code === 'bad-format' ? t('pinRenewFormat') : code === 'offline' ? t('pinRenewOffline') : e?.status === 429 ? t('pinTooMany') : t('pinRenewFailed'))
    } finally { setSaving(false) }
  }
  const field = 'w-full px-3 py-2 rounded-lg border border-neutral-300 text-center text-xl tracking-widest'

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/55 p-4 pt-3" role="dialog" aria-modal="true" aria-label={t('pinRenewTitle')}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl space-y-2.5">
        <div>
          <h2 className="text-lg font-extrabold text-neutral-900">{t('pinRenewTitle')}</h2>
          <p className="text-xs text-neutral-600 mt-0.5 leading-snug">{t('pinRenewText')}</p>
        </div>
        <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} autoFocus value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))} placeholder={t('pinRenewOld')} aria-label={t('pinRenewOld')} className={field} />
        <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} placeholder={t('pinRenewNew')} aria-label={t('pinRenewNew')} className={field} />
        <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && !saving) ok() }} placeholder={t('pinRenewConfirm')} aria-label={t('pinRenewConfirm')} className={field} />
        {error && <div className="text-sm text-red-600 font-semibold">{error}</div>}
        <div className="flex gap-3">
          <button type="button" onClick={close} disabled={saving} className="flex-1 py-2.5 rounded-lg border font-semibold">{t('pinRenewCancel')}</button>
          <button type="button" onClick={ok} disabled={saving || !oldPin || !newPin || !confirm} className={`flex-1 py-2.5 rounded-lg font-semibold ${saving || !oldPin || !newPin || !confirm ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}>{saving ? t('pinRenewSaving') : t('pinRenewOk')}</button>
        </div>
      </div>
    </div>
  )
}

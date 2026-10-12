import React, { useState } from 'react'
import i18n from '@/lib/i18n'
import { Lock } from 'lucide-react'
import api from '@/services/api'
import { useKioskLock } from '@/context/KioskLockContext'

/**
 * Full-screen "frozen for maintenance" overlay.
 *
 * Rendered once, near the root of the kiosk app, above everything else
 * (including any modal) — see its z-index. Unlocking needs the staff PIN
 * again: the whole point is that a customer walking up to an unattended,
 * locked kiosk cannot get back into it themselves.
 */
export default function KioskLockOverlay() {
  const { locked, unlock } = useKioskLock()
  const [pin, setPin] = useState('')
  const [error, setError] = useState(null)
  const [checking, setChecking] = useState(false)

  if (!locked) return null

  async function handleUnlock() {
    setChecking(true)
    setError(null)
    try {
      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
      const kioskKey = electronKey || (typeof localStorage !== 'undefined' ? localStorage.getItem('kiosk_api_key') : null) || import.meta.env.VITE_KIOSK_API_KEY
      await api.verifyAdminPin(pin, { apiKey: kioskKey })
      // Whatever reasons are currently holding the lock, a verified staff PIN
      // releases all of them — the operator is unambiguously back at the wheel.
      unlock('maintenance')
      unlock('day-close')
      setPin('')
    } catch (e) {
      setError(e?.status === 409 ? i18n.t('lockPinNone', { ns: 'cart' }) : i18n.t('lockPinInvalid', { ns: 'cart' }))
      setPin('')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-900/95 backdrop-blur-sm select-none">
      <div className="flex flex-col items-center gap-5 px-6 text-center max-w-sm">
        <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center">
          <Lock className="w-10 h-10 text-white" aria-hidden />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">{i18n.t('lockTitle', { ns: 'cart' })}</h2>
          <p className="text-sm text-white/60 mt-1">
            {i18n.t('lockText', { ns: 'cart' })}
          </p>
        </div>

        <div className="w-full space-y-2 pt-2">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && pin && !checking) handleUnlock() }}
            placeholder={i18n.t('lockPin', { ns: 'cart' })}
            className="w-full px-4 py-3 rounded-lg text-center text-xl tracking-widest bg-white/10 text-white placeholder-white/30 border border-white/20 focus:outline-none focus:border-white/50"
          />
          {error && <div className="text-sm text-red-300 font-medium">{error}</div>}
          <button
            onClick={handleUnlock}
            disabled={checking || !pin}
            className={`w-full py-3 rounded-lg font-semibold transition ${checking || !pin ? 'bg-white/10 text-white/40' : 'bg-white text-neutral-900'}`}
          >
            {checking ? i18n.t('lockChecking', { ns: 'cart' }) : i18n.t('lockUnlock', { ns: 'cart' })}
          </button>
        </div>
      </div>
    </div>
  )
}

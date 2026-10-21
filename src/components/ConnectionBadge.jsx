import React from 'react'
import { useTranslation } from 'react-i18next'
import api from '@/services/api'

/**
 * Discreet "is this shop talking to the central server" indicator for the kiosk header.
 * A small green dot when online; an amber "Offline" pill when not. Offline is a normal state
 * (cash, cards and machines keep working, everything is sent later), so it is a hint, not an alarm.
 * Hidden entirely on an install with no central server.
 */
export default function ConnectionBadge() {
  const { t } = useTranslation('cart')
  const [state, setState] = React.useState(null) // null = unknown / not applicable

  React.useEffect(() => {
    let alive = true
    let timer
    const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
    const key = electronKey || (() => { try { return localStorage.getItem('kiosk_api_key') } catch { return null } })() || import.meta.env.VITE_KIOSK_API_KEY
    const poll = () => {
      api.request('/pos/connection', { method: 'GET', headers: key ? { Authorization: `ApiKey ${key}` } : undefined, skipAuth: true, expect: 'json' })
        .then((s) => { if (alive) setState(s?.enabled ? Boolean(s.online) : null) })
        // The local server itself not answering is not "offline from the central one": show nothing rather than a wrong state.
        .catch(() => { if (alive) setState(null) })
        .finally(() => { if (alive) timer = setTimeout(poll, 10_000) })
    }
    poll()
    return () => { alive = false; clearTimeout(timer) }
  }, [])

  if (state === null) return null
  if (state) {
    return <span className="inline-block w-3 h-3 rounded-full bg-emerald-500/70" title={t('connOnline', { defaultValue: 'Online' })} role="img" aria-label={t('connOnline', { defaultValue: 'Online' })} />
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-3 h-8 text-base font-semibold" role="status">
      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
      {t('connOffline', { defaultValue: 'Offline' })}
    </span>
  )
}

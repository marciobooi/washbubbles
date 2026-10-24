import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Power } from 'lucide-react'
import { subscribe } from '@/services/websocket'
import { isKioskScreen } from '@/lib/kioskContext'

/**
 * The last minutes before the shop PC switches itself off (scheduled at night): a full-screen countdown with a slow animation.
 * The server sends the exact moment (`shutdownAt`) every 30 s inside the window, so a reloaded screen catches up. A touch hides
 * it (somebody may be in the middle of paying: the machine waits for them) until the last minute, when it stays.
 */
const TOTAL_MS = 3 * 60 * 1000

export default function ShutdownOverlay() {
  const { t } = useTranslation('cart')
  const [at, setAt] = useState(null)       // epoch ms of the shutdown
  const [now, setNow] = useState(Date.now())
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!isKioskScreen()) return undefined
    return subscribe((data) => {
      if (data && data.type === 'shutdown:warning' && Number(data.payload?.shutdownAt) > Date.now()) setAt(Number(data.payload.shutdownAt))
    })
  }, [])
  useEffect(() => {
    if (!at) return undefined
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [at])

  if (!at) return null
  const left = Math.max(0, at - now)
  const lastMinute = left <= 60_000
  if (hidden && !lastMinute) return null
  const mm = String(Math.floor(left / 60000)).padStart(2, '0')
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0')
  const frac = Math.min(1, left / TOTAL_MS)
  const R = 90, C = 2 * Math.PI * R

  return (
    <div role="alertdialog" aria-live="assertive" onPointerDown={() => setHidden(true)}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-900/92 text-white text-center px-8 select-none"
      style={{ background: 'radial-gradient(circle at 50% 40%, #134e4a 0%, #0f172a 70%)' }}>
      <div className="relative w-64 h-64 mb-8">
        <svg viewBox="0 0 200 200" className="absolute inset-0 -rotate-90">
          <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="8" />
          <circle cx="100" cy="100" r={R} fill="none" stroke="#5eead4" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: 'stroke-dashoffset 1s linear' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Power className="h-16 w-16 text-teal-300 animate-pulse mb-2" strokeWidth={1.6} />
          <div className="text-5xl font-extrabold tabular-nums tracking-tight">{mm}:{ss}</div>
        </div>
      </div>
      <h2 className="text-4xl font-extrabold mb-3">{t('shutdownTitle')}</h2>
      <p className="text-xl text-teal-100/90 max-w-xl">{t('shutdownBody')}</p>
      {!lastMinute && <p className="mt-8 text-sm text-white/60 animate-pulse">{t('shutdownTap')}</p>}
    </div>
  )
}

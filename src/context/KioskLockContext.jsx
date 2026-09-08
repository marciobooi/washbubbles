import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import api from '@/services/api'

const KioskLockContext = createContext(null)

/**
 * Global "screen frozen for maintenance" state for the kiosk.
 *
 * Separate from any individual modal's own backdrop: a modal only blocks
 * interaction while it happens to be open, and closes the moment that specific
 * action finishes. This lock is for the case staff explicitly want the screen
 * frozen for an indefinite stretch — refilling the hopper, clearing a jam,
 * physically counting cash — where they may step away from the kiosk UI
 * entirely and don't want a customer wandering up to it in the meantime.
 *
 * Tracked as a set of reasons rather than a single boolean so two independent
 * triggers (e.g. the day-close wizard AND an explicit "lock now") can overlap
 * without one's cleanup prematurely releasing the other's lock.
 */
export function KioskLockProvider({ children }) {
  const [reasons, setReasons] = useState(() => new Set())
  const [enabled, setEnabled] = useState(true) // fail open until the setting loads, so a slow network doesn't itself block staff actions

  useEffect(() => {
    let cancelled = false
    const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
    const kioskKey = electronKey || (typeof localStorage !== 'undefined' ? localStorage.getItem('kiosk_api_key') : null) || import.meta.env.VITE_KIOSK_API_KEY
    api.getPublicSetting('kioskLockEnabled')
      .then((row) => { if (!cancelled) setEnabled(row ? Boolean(row.value) : false) })
      .catch(() => { if (!cancelled) setEnabled(false) })
    return () => { cancelled = true }
  }, [])

  const lock = useCallback((reason = 'maintenance') => {
    if (!enabled) return
    setReasons((prev) => {
      const next = new Set(prev)
      next.add(reason)
      return next
    })
  }, [enabled])

  const unlock = useCallback((reason = 'maintenance') => {
    setReasons((prev) => {
      if (!prev.has(reason)) return prev
      const next = new Set(prev)
      next.delete(reason)
      return next
    })
  }, [])

  const locked = reasons.size > 0

  return (
    <KioskLockContext.Provider value={{ locked, lock, unlock, lockFeatureEnabled: enabled }}>
      {children}
    </KioskLockContext.Provider>
  )
}

export function useKioskLock() {
  const ctx = useContext(KioskLockContext)
  if (!ctx) throw new Error('useKioskLock must be used within a KioskLockProvider')
  return ctx
}

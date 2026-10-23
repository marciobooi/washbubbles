import React, { createContext, useContext, useEffect, useState } from 'react'

const AuthContext = createContext()

/** Expiry (ms since epoch) of a JWT, or null when it cannot be read. The server still decides; this only saves the user a dead page. */
function tokenExpiry(token) {
  try {
    const part = String(token).split('.')[1]
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    return Number.isFinite(json.exp) ? json.exp * 1000 : null
  } catch { return null }
}
const isExpired = (token) => { const e = token ? tokenExpiry(token) : null; return e != null && e <= Date.now() }
const inAdmin = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')

export function AuthProvider({ children }) {
  // A token that has already expired is never taken up: the admin would see every page and none would work.
  const stored = localStorage.getItem('ws_token')
  const startExpired = isExpired(stored)
  const [token, setToken] = useState(() => (startExpired ? null : stored || null))
  const [role, setRole] = useState(() => (startExpired ? null : localStorage.getItem('ws_role') || null))
  // The shop the logged-in user belongs to ({ id, name, slug }), from the login answer.
  const [tenant, setTenant] = useState(() => { try { return startExpired ? null : JSON.parse(localStorage.getItem('ws_home_tenant') || 'null') } catch { return null } })

  useEffect(() => {
    if (token) localStorage.setItem('ws_token', token)
    else localStorage.removeItem('ws_token')
    if (role) localStorage.setItem('ws_role', role)
    else localStorage.removeItem('ws_role')
  }, [token, role])

  // If running inside Electron and there is a kioskKey, automatically exchange it for a token.
  // Skipped on /admin routes: the kiosk API key is baked into every build of
  // this SPA, so without this guard the auto-login races a human admin login
  // and can silently overwrite a just-established SUPERADMIN/ADMIN session
  // with a KIOSK one — the login page then appears to hang with no error.
  useEffect(() => {
    if (token) return // already logged in
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) return
    try {
      const apiKey = window?.electronAPI?.kioskKey?.() || import.meta.env.VITE_KIOSK_API_KEY
      if (apiKey) {
        (async () => {
          try {
            // Falls back to a same-origin relative path (not localhost:3000) so a
            // missing VITE_API_URL at build time doesn't send production kiosks
            // to their own browser's localhost.
            const API_URL = (import.meta.env.VITE_API_URL || '') + '/api/auth/login'
            const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }) })
            if (!res.ok) return
            const data = await res.json()
            login({ token: data.token, role: data.role })
          } catch (err) {
            // ignore auto login failure
            console.error('Auto-login with kiosk key failed', err)
          }
        })()
      }
    } catch (err) { /* ignore */ }
  }, [])

  // The session ran out (the clock reached the token's expiry, or the server answered 401 to a request that carried it):
  // forget it and go to the login page with a short explanation, instead of leaving a dashboard that shows everything and does nothing.
  const expireSession = () => {
    if (!inAdmin()) return
    setToken(null)
    setRole(null)
    try { sessionStorage.setItem('ws_expired', '1') } catch { /* private mode: the page just redirects */ }
    if (window.location.pathname !== '/admin/login') window.location.replace('/admin/login')
  }
  useEffect(() => {
    if (!token) return undefined
    const onUnauthorized = () => expireSession()
    window.addEventListener('auth:expired', onUnauthorized)
    const exp = tokenExpiry(token)
    const timer = exp ? setTimeout(expireSession, Math.min(Math.max(exp - Date.now(), 0), 2 ** 31 - 1)) : null
    return () => { window.removeEventListener('auth:expired', onUnauthorized); if (timer) clearTimeout(timer) }
  }, [token])

  const login = ({ token, role, tenant: shop }) => {
    // Every login starts in the user's OWN shop (a superadmin's "act as" choice is not carried over).
    try { localStorage.removeItem('ws_tenant'); if (shop) localStorage.setItem('ws_home_tenant', JSON.stringify(shop)); else localStorage.removeItem('ws_home_tenant') } catch { /* optional */ }
    window.dispatchEvent(new CustomEvent('ws:tenant-reset'))
    setTenant(shop || null)
    setToken(token)
    setRole(role)
  }
  const logout = () => {
    try { localStorage.removeItem('ws_tenant'); localStorage.removeItem('ws_home_tenant') } catch { /* optional */ }
    window.dispatchEvent(new CustomEvent('ws:tenant-reset'))
    setTenant(null)
    setToken(null)
    setRole(null)
  }

  return (
    <AuthContext.Provider value={{ token, role, tenant, login, logout }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

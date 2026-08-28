import React, { createContext, useContext, useEffect, useState } from 'react'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('ws_token') || null)
  const [role, setRole] = useState(() => localStorage.getItem('ws_role') || null)

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

  const login = ({ token, role }) => {
    setToken(token)
    setRole(role)
  }
  const logout = () => {
    setToken(null)
    setRole(null)
  }

  return (
    <AuthContext.Provider value={{ token, role, login, logout }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

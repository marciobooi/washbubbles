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

  // If running inside Electron and there is a kioskKey, automatically exchange it for a token
  useEffect(() => {
    if (token) return // already logged in
    try {
      const apiKey = window?.electronAPI?.kioskKey?.() || import.meta.env.VITE_KIOSK_API_KEY
      if (apiKey) {
        (async () => {
          try {
            const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000') + '/api/auth/login'
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

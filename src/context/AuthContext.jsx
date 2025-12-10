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

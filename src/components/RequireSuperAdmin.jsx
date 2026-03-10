import React from 'react'
import { useAuth } from '../context/AuthContext'
import { Navigate } from 'react-router-dom'

export default function RequireSuperAdmin({ children }) {
  const { role } = useAuth()
  if (role !== 'SUPERADMIN') {
    // redirect non‑superadmins back to pos (or you could show 403)
    return <Navigate to="/" replace />
  }
  return children
}

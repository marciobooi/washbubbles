import React from 'react'
import { useAuth } from '../context/AuthContext'
import { Navigate } from 'react-router-dom'
import Loading from './ui/loading'

export default function RequireAdmin({ children }) {
  const { role, token } = useAuth()

  // If an auth token exists but role is not yet determined, show a loading spinner
  if (token && !role) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading size="small" />
      </div>
    )
  }

  // If no token or not admin, redirect to login
  if (role !== 'ADMIN') return <Navigate to="/admin/login" replace />

  return children
}
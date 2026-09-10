import React from 'react'
import { useAuth } from '../context/AuthContext'
import { Navigate } from 'react-router-dom'
import Loading from './ui/loading'

// `roles` defaults to full-admin-only. Pass e.g. roles={['ADMIN','SUPERADMIN','STAFF']}
// to also let a read-only or technician role through a specific route — the
// server-side guard (requireAdmin/requireStaffRead/requireTechnician) is the
// real enforcement, this is just so the wrong role doesn't land on a blank page.
export default function RequireAdmin({ children, roles = ['ADMIN', 'SUPERADMIN'] }) {
  const { role, token } = useAuth()

  // If an auth token exists but role is not yet determined, show a loading spinner
  if (token && !role) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading size="small" />
      </div>
    )
  }

  // No token, or a role not on this route's allow-list.
  if (!roles.includes(role)) return <Navigate to="/admin/login" replace />

  return children
}
import React from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function AdminDashboard() {
  const { logout, role } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/admin')
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-3xl w-full p-8 bg-white rounded shadow">
        <h1 className="text-2xl font-bold mb-4">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground mb-4">You are logged in as <strong>{role}</strong>.</p>
        <div className="space-x-2">
          <button className="px-3 py-2 rounded bg-red-600 text-white" onClick={handleLogout}>Logout</button>
        </div>
      </div>
    </div>
  )
}
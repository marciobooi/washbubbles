import React from 'react'
import LoginForm from '../components/LoginForm'
import { useAuth } from '../context/AuthContext'

export default function Admin() {
  const { token, role, logout } = useAuth()

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="glass-card w-full max-w-md mx-4 md:mx-0 p-6">
        <div className="auth-right">
          {!token && (
            <>
              <h2 className="text-lg font-semibold mb-2">Admin Login</h2>
              <LoginForm mode="admin" embedded />
            </>
          )}
          {token && role === 'ADMIN' && (
            <>
              <h2 className="text-lg font-semibold mb-2">Admin</h2>
              <p className="text-sm text-neutral-700">You are logged in as an admin.</p>
              <div className="mt-4 flex gap-2">
                <button className="px-3 py-1 rounded btn-success" onClick={() => logout()}>Logout</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

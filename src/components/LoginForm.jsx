import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function LoginForm({ mode = 'admin' }) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    const payload = apiKey ? { apiKey } : { email, password }
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error('Login failed')
      const data = await res.json()
      login({ token: data.token, role: data.role })
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white p-4 rounded shadow w-full max-w-md">
      <h3 className="font-semibold mb-2">{mode === 'admin' ? 'Admin Login' : 'Kiosk Login / API Key'}</h3>
      {mode === 'admin' ? (
        <>
          <label className="block mb-2">
            <span className="text-sm">Email</span>
            <input className="w-full border rounded p-2" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block mb-2">
            <span className="text-sm">Password</span>
            <input className="w-full border rounded p-2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </>
      ) : (
        <label className="block mb-2">
          <span className="text-sm">API Key</span>
          <input className="w-full border rounded p-2" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </label>
      )}
      {error && <p className="text-primary-700">{error}</p>}
      <button className="mt-2 px-3 py-1 rounded btn-primary" type="submit">Login</button>
    </form>
  )
}

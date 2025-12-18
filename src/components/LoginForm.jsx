import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'

export default function LoginForm({ mode = 'admin', embedded = false }) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const payload = apiKey ? { apiKey } : { email, password }
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error('Login failed')
      const data = await res.json()
      login({ token: data.token, role: data.role })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (embedded) {
    // compact small layout for side panels
    return (
      <form onSubmit={handleSubmit} className="w-full">
        {mode === 'admin' ? (
          <div className="space-y-3">
            <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <div className="text-destructive text-sm">{error}</div>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Input placeholder="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            {error && <div className="text-destructive text-sm">{error}</div>}
            <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</Button>
          </div>
        )}
      </form>
    )
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle>{mode === 'admin' ? 'Admin Login' : 'Kiosk Login'}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {mode === 'admin' ? (
              <>
                <div>
                  <label className="text-sm mb-1 block text-neutral-700">Email</label>
                  <Input placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm mb-1 block text-neutral-700">Password</label>
                  <Input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </>
            ) : (
              <div>
                <label className="text-sm mb-1 block text-neutral-700">API Key</label>
                <Input placeholder="Paste your API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              </div>
            )}

            {error && <div className="text-destructive text-sm">{error}</div>}
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="ml-auto" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</Button>
        </CardFooter>
      </form>
    </Card>
  )
}

import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'

export default function LoginForm({ mode = 'admin', embedded = false }) {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)


  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const payload = apiKey ? { apiKey } : { username, password }
    try {
      const data = await api.login(payload)
      login({ token: data.token, role: data.role })
    } catch (err) {
      // show error via global toast (shadcn-style)
      try {
        toast({ title: 'Login failed', description: err.message || 'Login failed', variant: 'destructive' })
      } catch (e) {
        setError(err.message || 'Login failed')
      }
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
            <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
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

  // Non-embedded: full demo-style form without Card wrapper (matches shadcn example)
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 w-full">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-bold">Login to your account</h1>
        <p className="text-muted-foreground text-sm">Enter your username below to login to your account</p>
      </div>

      {mode === 'admin' ? (
        <>
          <div>
            <label className="text-sm mb-1 block text-neutral-700">Username</label>
            <Input id="username" placeholder="your-username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>

          <div>
            <div className="flex items-center">
              <label className="text-sm mb-1 block text-neutral-700">Password</label>
              </div>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <div>
            <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</Button>
          </div>

      

       
        </>
      ) : (
        <div>
          <label className="text-sm mb-1 block text-neutral-700">API Key</label>
          <Input placeholder="Paste your API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          {error && <div className="text-destructive text-sm mt-2">{error}</div>}
          <div className="mt-4">
            <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</Button>
          </div>
        </div>
      )}
    </form>
  )
}

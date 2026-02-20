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
      // Navigation is handled by the parent (e.g., Admin page) after successful login
      // This keeps routing decisions out of the form component and centralizes role-based redirects
      // (no client-side navigation here)
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

  // Non-embedded: full login layout
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {mode === 'admin' ? (
        <>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium" htmlFor="username">Username</label>
            <Input
              id="username"
              name="username"
              type="text"
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              className="mt-1 w-full"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium" htmlFor="password">Password</label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="mt-1 w-full"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <input
                id="rememberMe"
                name="rememberMe"
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="rememberMe" className="text-sm font-medium">Remember me</label>
            </div>
            <div className="text-sm">
              <a className="text-primary hover:text-primary/90 font-medium" href="/forgot-password">Forgot your password?</a>
            </div>
          </div>

          {error && <div className="text-destructive text-sm">{error}</div>}

          <div>
            <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-2 text-gray-500">or continue with</span>
            </div>
          </div>

          <div className="grid gap-3">
            <button type="button" className="flex w-full items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 hover:bg-accent">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a9.96 9.96 0 0 1 6.29 2.226a1 1 0 0 1 .04 1.52l-1.51 1.362a1 1 0 0 1 -1.265 .06a6 6 0 1 0 2.103 6.836l.001 -.004h-3.66a1 1 0 0 1 -.992 -.883l-.007 -.117v-2a1 1 0 0 1 1 -1h6.945a1 1 0 0 1 .994 .89c.04 .367 .061 .737 .061 1.11c0 5.523 -4.477 10 -10 10s-10 -4.477 -10 -10s4.477 -10 10 -10z" /></svg>
              Google
            </button>
            <button type="button" className="flex w-full items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 hover:bg-accent">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5" /></svg>
              GitHub
            </button>
          </div>
        </>
      ) : (
        <div>
          <label className="flex items-center gap-2 text-sm font-medium" htmlFor="apiKey">API Key</label>
          <Input id="apiKey" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} className="mt-1 w-full" />
          {error && <div className="text-destructive text-sm mt-2">{error}</div>}
          <div className="mt-4">
            <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</Button>
          </div>
        </div>
      )}
    </form>
  )
}

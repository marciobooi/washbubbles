import React, { useState, useEffect } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../context/AuthContext'
import { Input } from '@/components/ui/input'
import PasswordInput from '@/components/ui/PasswordInput'
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

  // Sent here because the session ran out: say so once.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('ws_expired')) {
        sessionStorage.removeItem('ws_expired')
        toast({ title: 'A sessão expirou', description: 'Entre de novo para continuar.' })
      }
    } catch { /* no sessionStorage: nothing to say */ }
  }, [])


  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    // Read what is in the fields at the moment of the click, not only what the change events reported: a browser or password
    // manager can fill a field without any event, and the typed password is not kept in the page's state otherwise.
    const fd = new FormData(e.currentTarget)
    const payload = apiKey ? { apiKey } : { username: fd.get('username') || username, password: fd.get('password') || password }
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
            <Input name="username" autoComplete="username" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <PasswordInput name="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
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
          {/* username field */}
          <div>
            <label data-slot="label" className="flex items-center gap-2 text-sm leading-none font-medium select-none" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-[#7caaa1] flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive mt-1"
            />
          </div>
          {/* password field */}
          <div>
            <label data-slot="label" className="flex items-center gap-2 text-sm leading-none font-medium select-none" htmlFor="password">
              Password
            </label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              rawClassName="file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-[#7caaa1] flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive mt-1"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={false}
                data-state="unchecked"
                value="on"
                data-slot="checkbox"
                className="peer dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-lg border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 border-[#7caaa1]"
                id="rememberMe"
                onClick={() => {
                  const cb = document.getElementById('rememberMe-checkbox');
                  if (cb) cb.checked = !cb.checked;
                }}
              ></button>
              <input
                type="checkbox"
                id="rememberMe-checkbox"
                aria-hidden="true"
                tabIndex={-1}
                style={{ position: 'absolute', pointerEvents: 'none', opacity: 0, margin: 0, transform: 'translateX(-100%)', width: 16, height: 16 }}
                value="on"
              />
              <label htmlFor="rememberMe" className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Remember me
              </label>
            </div>
            <div className="text-sm">
              <Link className="text-primary hover:text-primary/90 font-medium hover:underline" to="/forgot-password">
                Forgot your password?
              </Link>
            </div>
          </div>

          {error && <div className="text-destructive text-sm">{error}</div>}

          <div>
            <button
              data-slot="button"
              type="submit"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 h-9 px-4 py-2 has-[>svg]:px-3 w-full"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign in'}
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


import React, { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'

function useQuery() {
  return new URLSearchParams(useLocation().search)
}

export default function ResetPassword() {
  const query = useQuery()
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const t = query.get('token')
    if (t) setToken(t)
  }, [query])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password !== confirm) {
      return toast({ title: 'Error', description: 'Passwords do not match', variant: 'destructive' })
    }
    setLoading(true)
    try {
      await api.resetPassword({ token, newPassword: password })
      toast({ title: 'Password changed', description: 'You may now log in', variant: 'default' })
      navigate('/admin/login')
    } catch (err) {
      toast({ title: 'Error', description: err.message || 'Unable to reset password', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return <p className="text-center text-red-500">Invalid or missing token</p>
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h2 className="mt-6 text-3xl font-bold">Reset password</h2>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium" htmlFor="password">
            New password
          </label>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="confirm">
            Confirm password
          </label>
          <Input
            id="confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full"
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </div>
  )
}
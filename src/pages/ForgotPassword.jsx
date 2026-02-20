import React, { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.forgotPassword({ email })
      toast({ title: 'Email sent', description: 'If that address exists we sent a recovery link', variant: 'default' })
      setEmail('')
    } catch (err) {
      toast({ title: 'Error', description: err.message || 'Failed to send', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h2 className="mt-6 text-3xl font-bold">Forgot password</h2>
      <p className="mt-2 text-sm text-gray-600">Enter your email to receive a reset link.</p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium" htmlFor="email">
            Email address
          </label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full"
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </div>
  )
}
import React from 'react'
import LoginForm from '../components/LoginForm'
import { useAuth } from '../context/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'

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
              <Card>
                <CardHeader>
                  <CardTitle>Admin</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-neutral-700">You are logged in as an admin.</p>
                </CardContent>
                <CardFooter>
                  <div className="mt-2 flex gap-2 ml-auto">
                    <Button variant="outline" onClick={() => logout()}>Logout</Button>
                  </div>
                </CardFooter>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

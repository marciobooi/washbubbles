import React, { useEffect } from 'react'
import LoginForm from '../components/LoginForm'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function Admin() {
  const { role } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (role === 'ADMIN') {
      navigate('/admin/operations')
    }
  }, [role, navigate])

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left column with logo and form */}
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium text-primary-800">
            <div className="bg-primary text-primary-foreground flex h-10 w-10 items-center justify-center rounded-md">
              {/* simple icon */}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h4l3-6 4 12 3-6h4" />
              </svg>
            </div>
            <span className="text-lg font-semibold">Acme Inc.</span>
          </a>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <LoginForm mode="admin" />
          </div>
        </div>
      </div>

      {/* Right column with cover image (hidden on small screens) */}
      <div className="bg-muted relative hidden lg:block">
        <img
          src="/geral/login.jpg"
          alt="Cover"
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
        />
      </div>
    </div>
  )
}

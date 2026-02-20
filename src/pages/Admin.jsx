import React, { useEffect } from 'react'
import LoginForm from '../components/LoginForm'
import { useAuth } from '../context/AuthContext'
import { useTenant } from '../context/TenantContext'
import { useNavigate } from 'react-router-dom'
import LoginCarousel from '../components/LoginCarousel'

export default function Admin() {
  const { role } = useAuth()
  const { tenantId, tenants } = useTenant()
  const tenant = (tenants || []).find(t => t._id === tenantId) || null
  const navigate = useNavigate()

  useEffect(() => {
    if (role === 'ADMIN') {
      navigate('/admin/operations')
    }
  }, [role, navigate])

  return (
    <div className="items-center justify-center md:flex">
      <div className="w-full">
        <div className="lg:grid lg:min-h-[760px] lg:grid-cols-2">
          <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:flex-none xl:px-24">
            <div className="mx-auto w-full max-w-sm lg:w-96">
              <h2 className="mt-6 text-3xl font-bold">Sign in to your account</h2>
              <div className="mt-8 space-y-6">
                <LoginForm mode="admin" />
              </div>
            </div>
          </div>
          <div className="relative hidden lg:block">
            {/* carousel of login folder images */}
            <LoginCarousel className="absolute inset-0 h-full w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

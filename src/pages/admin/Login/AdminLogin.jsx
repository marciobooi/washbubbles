import React, { useEffect } from 'react'
import LoginForm from '@/components/LoginForm'
import { useAuth } from '@/context/AuthContext'
import { useTenant } from '@/context/TenantContext'
import { useNavigate } from 'react-router-dom'
import LoginCarousel from '@/components/LoginCarousel'
import { Card, CardContent } from '@/components/ui/card'

export default function Admin() {
  const { role } = useAuth()
  const { tenantId, tenants } = useTenant()
  const tenant = (tenants || []).find(t => t._id === tenantId) || null
  const navigate = useNavigate()

  useEffect(() => {
    // the superadmin lands on the list of shops (and enters one from there); everybody else on their own shop's operations
    if (role === 'SUPERADMIN') navigate('/admin/tenants')
    else if (role === 'ADMIN' || role === 'OPERATOR') navigate('/admin/operations')
  }, [role, navigate])

  return (
    <div className="items-center justify-center md:flex min-h-screen bg-[#f5f2ec]">
      <div className="w-full">
        <div className="lg:grid lg:min-h-[760px] lg:grid-cols-2">
          <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:flex-none xl:px-24">
            <div className="mx-auto w-full max-w-sm lg:w-96">
              <h2 className="mt-6 text-3xl font-bold text-[#1c2530]">Entrar na conta</h2>
              <div className="mt-8 space-y-6">
                <Card>
                  <CardContent className="p-6">
                    <LoginForm mode="admin" />
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
          <div className="relative h-64 lg:h-auto lg:block hidden lg:block">
            {/* carousel of login folder images */}
            <LoginCarousel className="absolute inset-0 h-full w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
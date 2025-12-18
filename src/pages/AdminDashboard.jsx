import React from 'react'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { Separator } from '@/components/ui/separator'
import NavSearch from '@/components/NavSearch'

import { useAuth } from '../context/AuthContext'
import { useNavigate, Outlet } from 'react-router-dom'

export default function AdminDashboard() {
  const { logout, role } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/admin/login')
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-20 w-full h-16 shrink-0 flex items-center gap-2 border-b px-4 bg-white/70 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />

            <NavSearch className="mr-4" />

            <div className="flex-1">
              <h1 className="text-lg font-semibold">Admin Dashboard</h1>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground">{role}</div>
              <button className="px-3 py-2 rounded bg-red-600 text-white" onClick={handleLogout}>Logout</button>
            </div>
          </header>
          <div className="dashContainer flex flex-1 flex-col gap-4 p-4 pt-4 min-w-0">
            <Outlet />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
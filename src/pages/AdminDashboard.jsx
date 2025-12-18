import React from 'react'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { Separator } from '@/components/ui/separator'
import NavSearch from '@/components/NavSearch'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
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
          <header className="sticky top-0 z-20 w-full shadow-md h-16 shrink-0 flex items-center gap-2 border-b px-4 bg-white/70 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />

            <NavSearch className="mr-4" />

     

            <div className="flex items-end gap-2">
              <div className="text-sm text-muted-foreground">{role}</div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="Logout" onClick={handleLogout}>
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={6}>Logout</TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
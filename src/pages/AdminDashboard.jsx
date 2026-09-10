import React from 'react'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import NavSearch from '@/components/NavSearch'
import { LogOut, Bell, Sun, Moon, ChevronDown, User } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { useAuth } from '../context/AuthContext'
import { useNavigate, Outlet } from 'react-router-dom'

// The admin redesign only specifies a light "alabaster" theme — every color
// here is a hardcoded hex, not a `--background`/`--card` token — so there is
// no real dark palette for this screen to switch to yet. The toggle still
// reflects and remembers the pressed state (so it looks and feels alive) but
// deliberately stops short of flipping `document.documentElement`'s `dark`
// class, which would otherwise dim these pages' cards while leaving their
// hardcoded dark text in place and unreadable.
const THEME_KEY = 'app.theme'

function useTheme() {
  const [dark, setDark] = React.useState(() => {
    try { return localStorage.getItem(THEME_KEY) === 'dark' } catch { return false }
  })
  React.useEffect(() => {
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light') } catch { /* preference is optional */ }
  }, [dark])
  return [dark, setDark]
}

// Pill-shaped chrome button shared by the topbar icon actions — a filled
// off-white circle with a hairline border, matching the rest of the topbar.
function TopbarIconButton({ className = '', children, ...props }) {
  return (
    <button
      className={`h-10 w-10 rounded-full border border-black/[0.09] bg-[#f7f5f1] flex items-center justify-center cursor-pointer transition-[background,transform] duration-150 hover:bg-[#eeebe4] hover:scale-[1.06] ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export default function AdminDashboard() {
  const { logout, role } = useAuth()
  const navigate = useNavigate()
  const [dark, setDark] = useTheme()

  const handleLogout = () => {
    logout()
    navigate('/admin/login')
  }

  const roleLabel = role === 'SUPERADMIN' ? 'Superadmin' : 'Admin'

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-[#f5f2ec] text-[#1c2530]">
        <AppSidebar />
        <SidebarInset>
          <div className="flex flex-1 flex-col gap-4 min-w-0 px-4 sm:px-6 py-5">
            <header className="h-[60px] shrink-0 flex items-center gap-3.5 px-3 sm:px-[18px] rounded-2xl bg-white shadow-[0_1px_2px_rgba(20,25,30,0.04),0_8px_20px_-12px_rgba(20,25,30,0.10)]">
              <SidebarTrigger className="shrink-0 rounded-full hover:bg-[#f7f5f1] md:hidden" />

              <NavSearch className="flex-1 max-w-[380px]" />

              <div className="ml-auto flex items-center gap-2">
                <TopbarIconButton aria-label="Notificações">
                  <Bell className="h-4 w-4" strokeWidth={1.7} />
                </TopbarIconButton>

                <div className="flex items-center p-[3px] rounded-full border border-black/[0.09] bg-[#f7f5f1] gap-0.5">
                  <button
                    aria-label="Modo claro"
                    onClick={() => setDark(false)}
                    className={`h-[34px] w-[34px] rounded-full flex items-center justify-center cursor-pointer transition-colors duration-150 ${!dark ? 'bg-[#f4c451] text-[#3a2c05]' : 'bg-transparent text-[#8a8478]'}`}
                  >
                    <Sun className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  </button>
                  <button
                    aria-label="Modo escuro"
                    onClick={() => setDark(true)}
                    className={`h-[34px] w-[34px] rounded-full flex items-center justify-center cursor-pointer transition-colors duration-150 ${dark ? 'bg-[#f4c451] text-[#3a2c05]' : 'bg-transparent text-[#8a8478]'}`}
                  >
                    <Moon className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  </button>
                </div>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        aria-label="Perfil"
                        onClick={() => navigate('/admin/profile')}
                        className="flex items-center gap-2 h-10 pl-[3px] pr-3.5 rounded-full border border-black/[0.09] bg-[#f7f5f1] cursor-pointer transition-colors duration-150 hover:bg-[#eeebe4]"
                      >
                        <span className="h-8 w-8 rounded-full shrink-0 bg-linear-to-br from-primary-300 to-primary-600 flex items-center justify-center">
                          <User className="h-4 w-4 text-white" strokeWidth={2} />
                        </span>
                        <span className="text-[13.5px] font-bold text-[#1c2530]">{roleLabel}</span>
                        <ChevronDown className="h-[13px] w-[13px]" strokeWidth={2} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent sideOffset={6}>Perfil</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TopbarIconButton aria-label="Sair" onClick={handleLogout}>
                        <LogOut className="h-4 w-4" strokeWidth={1.7} />
                      </TopbarIconButton>
                    </TooltipTrigger>
                    <TooltipContent sideOffset={6}>Logout</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </header>

            <main className="flex-1 min-w-0">
              <Outlet />
            </main>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

import React from 'react'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import NavSearch from '@/components/NavSearch'
import { LogOut, Bell, Sun, Moon, ChevronDown, User, KeyRound } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { useAuth } from '../context/AuthContext'
import TenantSwitch, { ActingAsStrip } from '../components/TenantSwitch'
import { useNavigate, useLocation, Navigate, Outlet } from 'react-router-dom'

// Light "alabaster" is the design; dark is a re-mapping of its hard-coded colours (see `.admin-dark` in index.css),
// switched on by the class on the admin shell below. The choice is remembered per browser.
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
  // The role chip opens a small menu: change my password / sign out (every dashboard role, the operator included).
  const [menuOpen, setMenuOpen] = React.useState(false)
  const menuRef = React.useRef(null)
  React.useEffect(() => {
    if (!menuOpen) return undefined
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  const handleLogout = () => {
    logout()
    navigate('/admin/login')
  }

  const roleLabel = role === 'SUPERADMIN' ? 'Superadmin' : role === 'OPERATOR' ? 'Operador' : 'Admin'
  // An operator sees ONE page: whatever address they open, they land on Operações.
  const here = useLocation()
  if (role === 'OPERATOR' && !here.pathname.startsWith('/admin/operations') && !here.pathname.startsWith('/admin/profile')) return <Navigate to="/admin/operations" replace />

  return (
    <SidebarProvider>
      <div className={`admin-shell flex min-h-screen w-full bg-[#f5f2ec] text-[#1c2530] ${dark ? 'admin-dark' : ''}`}>
        <AppSidebar />
        <SidebarInset>
          <div className="flex flex-1 flex-col gap-4 min-w-0 px-4 sm:px-6 py-5">
            <ActingAsStrip />
            <header className="sticky top-0 z-20 h-[60px] shrink-0 flex items-center gap-3.5 px-3 sm:px-[18px] rounded-2xl bg-white shadow-[0_1px_2px_rgba(20,25,30,0.04),0_8px_20px_-12px_rgba(20,25,30,0.10)]">
              <SidebarTrigger className="h-10 w-10 shrink-0 rounded-full border border-black/[0.09] bg-[#f7f5f1] flex items-center justify-center transition-[background,transform] duration-150 hover:bg-[#eeebe4] hover:scale-[1.06]" />

              <NavSearch className="flex-1 max-w-[380px]" />
              <TenantSwitch />

              <div className="ml-auto flex items-center gap-2">
              

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

                <div className="relative" ref={menuRef}>
                  <button
                    aria-label="Conta"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((o) => !o)}
                    className="flex items-center gap-2 h-10 pl-[10px] pr-3.5 rounded-full border border-black/[0.09] cursor-pointer transition-colors duration-150 hover:bg-[#eeebe4]"
                  >
                    <User className="h-[15px] w-[15px]" strokeWidth={1.8} />
                    <span className="text-[13.5px] font-bold text-[#1c2530]">{roleLabel}</span>
                    <ChevronDown className={`h-[13px] w-[13px] transition-transform ${menuOpen ? 'rotate-180' : ''}`} strokeWidth={2} />
                  </button>
                  {menuOpen && (
                    <div role="menu" className="absolute right-0 top-12 z-50 w-60 rounded-2xl border border-black/[0.09] bg-white p-1.5 shadow-lg">
                      <button role="menuitem" onClick={() => { setMenuOpen(false); navigate('/admin/profile') }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14px] font-semibold text-[#1c2530] hover:bg-[#f5f2ec]">
                        <KeyRound className="h-4 w-4" strokeWidth={1.8} /> Alterar palavra-passe
                      </button>
                      <button role="menuitem" onClick={() => { setMenuOpen(false); handleLogout() }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[14px] font-semibold text-[#1c2530] hover:bg-[#f5f2ec]">
                        <LogOut className="h-4 w-4" strokeWidth={1.8} /> Sair
                      </button>
                    </div>
                  )}
                </div>

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

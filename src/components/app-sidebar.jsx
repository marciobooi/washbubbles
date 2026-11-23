import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useSidebar } from './ui/sidebar'
import Fuse from 'fuse.js'
import Highlight from './Highlight'
import { Cpu, Users, CreditCard, Settings, Globe, Activity, PlugZap, Coins, Cable, Wallet, Banknote, LayoutDashboard, Wrench, Tag, ScrollText } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useBranding } from '../context/BrandingContext'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from './ui/sidebar'

// base admin navigation. `roles` gates which dashboard roles see the item —
// omit it for the ADMIN/SUPERADMIN default. This mirrors (but does not
// replace) the backend's own per-route guards in routes/admin.js; it only
// keeps the wrong role from seeing a link that would 403 anyway.
const navItems = [
  { id: 'overview', title: 'Visão Geral', url: '/admin/overview', Icon: LayoutDashboard, roles: ['ADMIN', 'SUPERADMIN', 'STAFF'] },
  { id: 'operations', title: 'Operações', url: '/admin/operations', Icon: Activity, roles: ['ADMIN', 'SUPERADMIN', 'OPERATOR'] },
  { id: 'machines', title: 'Máquinas', url: '/admin/machines', Icon: Cpu, roles: ['ADMIN', 'SUPERADMIN', 'STAFF', 'TECHNICIAN'] },
  { id: 'maintenance', title: 'Manutenção', url: '/admin/maintenance', Icon: Wrench, roles: ['ADMIN', 'SUPERADMIN', 'TECHNICIAN'] },
  { id: 'interfaces', title: 'Interfaces', url: '/admin/interfaces', Icon: PlugZap },
  { id: 'peripherals', title: 'Periféricos', url: '/admin/peripherals', Icon: Cable },
  { id: 'prices', title: 'Preços', url: '/admin/prices', Icon: Coins },
  { id: 'coupons', title: 'Cupões e Campanhas', url: '/admin/coupons', Icon: Tag },
  { id: 'cards', title: 'Cartões', url: '/admin/cards', Icon: Wallet, roles: ['ADMIN', 'SUPERADMIN', 'STAFF'] },
  { id: 'users', title: 'Utilizadores', url: '/admin/users', Icon: Users },
  { id: 'transactions', title: 'Transacções', url: '/admin/transactions', Icon: CreditCard, roles: ['ADMIN', 'SUPERADMIN', 'STAFF'] },
  { id: 'day-close', title: 'Fecho de Dia', url: '/admin/day-close', Icon: Banknote, roles: ['ADMIN', 'SUPERADMIN', 'STAFF', 'OPERATOR'] },
  { id: 'website', title: 'Website', url: '/admin/website', Icon: Globe },
  { id: 'settings', title: 'Definições', url: '/admin/settings', Icon: Settings },
  { id: 'audit-log', title: 'Auditoria', url: '/admin/audit-log', Icon: ScrollText },
  { id: 'tenants', title: 'Lojas', url: '/admin/tenants', Icon: Users, roles: ['SUPERADMIN'] },
]

// Sidebar groups, in order. Empty groups (no visible items for the current
// role) are skipped, so operators/staff only see the sections that apply.
const navGroups = [
  { id: 'geral', label: 'Geral', items: ['overview'] },
  { id: 'maquina', label: 'Máquina', items: ['operations', 'machines', 'maintenance', 'interfaces', 'peripherals', 'day-close'] },
  { id: 'negocios', label: 'Negócios', items: ['prices', 'coupons', 'cards', 'transactions'] },
  { id: 'pessoas', label: 'Pessoas & Acesso', items: ['users', 'tenants'] },
  { id: 'sistema', label: 'Sistema', items: ['website', 'settings', 'audit-log'] },
]

export function AppSidebar(props) {
  const { searchQuery } = useSidebar() || { searchQuery: '' }
  const q = (searchQuery || '').trim()
  const location = useLocation()

  const { role } = useAuth()
  const { branding } = useBranding() || {}
  // Logo files that failed to load. The saved logo is tried first, then the shop's default one; when both
  // have failed (or nothing is configured) the plain gradient mark is shown. Each source is tried once.
  const [failedLogos, setFailedLogos] = React.useState([])
  const logoSrc = [branding?.logo].find((u) => u && !failedLogos.includes(u))
  const visibleRoles = (i) => (i.roles || ['ADMIN', 'SUPERADMIN']).includes(role)

  const itemsById = new Map(navItems.map((i) => [i.id, i]))

  let itemsToRender = navItems
    .filter((i) => visibleRoles(i))
    .map((i) => ({ ...i, matchIndices: [] }))
  if (q.length > 0) {
    const fuse = new Fuse(navItems, { keys: ['title'], includeMatches: true, threshold: 0.4 })
    const results = fuse.search(q)
    itemsToRender = results
      .map((r) => {
        const m = r.matches && r.matches.find((x) => x.key === 'title')
        return { ...r.item, matchIndices: m ? m.indices : [] }
      })
      .filter((i) => visibleRoles(i))
  }

  const renderMenuItem = (it) => {
    const isActive = location.pathname === it.url || location.pathname.startsWith(it.url + '/') || location.pathname.startsWith(it.url)
    return (
      <SidebarMenuItem key={it.id}>
        <SidebarMenuButton asChild Icon={it.Icon} title={it.title} isActive={isActive}>
          <NavLink to={it.url} className="flex items-center gap-2">
            <span className="min-w-32"><Highlight text={it.title} matches={it.matchIndices} /></span>
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        {/* Real company branding from Definições > Branding, same source
            App.jsx's topbar already reads — falls back to the plain
            gradient mark + "Admin" when nothing's been configured yet. */}
        <div className="flex items-center gap-2.5 px-2 pt-1 pb-3.5 min-w-0">
          {/* The saved logo; if none is set (or its file cannot be loaded), the shop's own default logo, the
              same one the public page falls back to; only if that fails too, the plain gradient mark. */}
          {logoSrc ? (
            <img src={logoSrc} alt="" onError={() => setFailedLogos((f) => (f.includes(logoSrc) ? f : [...f, logoSrc]))} className="h-8 w-8 shrink-0 rounded-[10px] object-cover" />
          ) : (
            <div className="h-8 w-8 shrink-0 rounded-[10px] bg-linear-to-br from-primary-300 to-primary-600" />
          )}
          <span className="font-extrabold text-[17px] tracking-tight text-white truncate">{branding?.companyName || 'Admin'}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {q.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {itemsToRender.map((it) => renderMenuItem(it))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          navGroups.map((group) => {
            const groupItems = group.items.map((id) => itemsById.get(id)).filter((i) => i && visibleRoles(i))
            if (groupItems.length === 0) return null
            return (
              <SidebarGroup key={group.id}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {groupItems.map((it) => renderMenuItem(it))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )
          })
        )}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

export default AppSidebar

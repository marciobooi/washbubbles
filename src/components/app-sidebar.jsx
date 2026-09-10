import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useSidebar } from './ui/sidebar'
import Fuse from 'fuse.js'
import Highlight from './Highlight'
import { Cpu, Users, CreditCard, Settings, Activity, PlugZap, Coins, Cable, Wallet, Banknote, LayoutDashboard, Wrench, Tag, ScrollText } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
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
  { title: 'Visão Geral', url: '/admin/overview', Icon: LayoutDashboard, roles: ['ADMIN', 'SUPERADMIN', 'STAFF'] },
  { title: 'Operações', url: '/admin/operations', Icon: Activity },
  { title: 'Máquinas', url: '/admin/machines', Icon: Cpu, roles: ['ADMIN', 'SUPERADMIN', 'STAFF', 'TECHNICIAN'] },
  { title: 'Manutenção', url: '/admin/maintenance', Icon: Wrench, roles: ['ADMIN', 'SUPERADMIN', 'TECHNICIAN'] },
  { title: 'Interfaces', url: '/admin/interfaces', Icon: PlugZap },
  { title: 'Periféricos', url: '/admin/peripherals', Icon: Cable },
  { title: 'Preços', url: '/admin/prices', Icon: Coins },
  { title: 'Cupões', url: '/admin/coupons', Icon: Tag },
  { title: 'Cartões', url: '/admin/cards', Icon: Wallet, roles: ['ADMIN', 'SUPERADMIN', 'STAFF'] },
  { title: 'Utilizadores', url: '/admin/users', Icon: Users },
  { title: 'Transacções', url: '/admin/transactions', Icon: CreditCard, roles: ['ADMIN', 'SUPERADMIN', 'STAFF'] },
  { title: 'Fecho de Dia', url: '/admin/day-close', Icon: Banknote, roles: ['ADMIN', 'SUPERADMIN', 'STAFF'] },
  { title: 'Definições', url: '/admin/settings', Icon: Settings },
  { title: 'Auditoria', url: '/admin/audit-log', Icon: ScrollText },
  { title: 'Tenants', url: '/admin/tenants', Icon: Users, roles: ['SUPERADMIN'] },
]

export function AppSidebar(props) {
  const { searchQuery } = useSidebar() || { searchQuery: '' }
  const q = (searchQuery || '').trim()
  const location = useLocation()

  const { role } = useAuth()
  let itemsToRender = navItems
    .filter(i => (i.roles || ['ADMIN', 'SUPERADMIN']).includes(role))
    .map((i) => ({ ...i, matchIndices: [] }))
  if (q.length > 0) {
    const fuse = new Fuse(navItems, { keys: ['title'], includeMatches: true, threshold: 0.4 })
    const results = fuse.search(q)
    itemsToRender = results.map((r) => {
      const m = r.matches && r.matches.find((x) => x.key === 'title')
      return { ...r.item, matchIndices: m ? m.indices : [] }
    })
  }

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <div className="font-semibold">Admin</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {itemsToRender.map((it) => {
                const isActive = location.pathname === it.url || location.pathname.startsWith(it.url + '/') || location.pathname.startsWith(it.url)
                return (
                  <SidebarMenuItem key={it.title}>
                    <SidebarMenuButton asChild Icon={it.Icon} title={it.title} isActive={isActive}>
                      <NavLink to={it.url} className="flex items-center gap-2">
                        <span className="min-w-32"><Highlight text={it.title} matches={it.matchIndices} /></span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

export default AppSidebar

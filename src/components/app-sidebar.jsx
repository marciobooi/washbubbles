import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useSidebar } from './ui/sidebar'
import Fuse from 'fuse.js'
import Highlight from './Highlight'
import { Cpu, Users, CreditCard, Settings, Activity, PlugZap } from 'lucide-react'
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

const navItems = [
  { title: 'Operações', url: '/admin/operations', Icon: Activity },
  { title: 'Máquinas', url: '/admin/machines', Icon: Cpu },
  { title: 'Interfaces', url: '/admin/interfaces', Icon: PlugZap },
  { title: 'Utilizadores', url: '/admin/users', Icon: Users },
  { title: 'Transacções', url: '/admin/transactions', Icon: CreditCard },
  { title: 'Definições', url: '/admin/settings', Icon: Settings },
]

export function AppSidebar(props) {
  const { searchQuery } = useSidebar() || { searchQuery: '' }
  const q = (searchQuery || '').trim()
  const location = useLocation()

  let itemsToRender = navItems.map((i) => ({ ...i, matchIndices: [] }))
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
                        <span className="min-w-[8rem]"><Highlight text={it.title} matches={it.matchIndices} /></span>
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

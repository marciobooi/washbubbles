import React from 'react'
import { Link } from 'react-router-dom'
import { VersionSwitcher } from './version-switcher'
import { Home, FileText, Layers, BookOpen, Server } from 'lucide-react'
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

const data = {
  versions: ['1.0.1', '1.1.0-alpha', '2.0.0-beta1'],
  navMain: [
    {
      title: 'Getting Started',
      url: '#',
      icon: Home,
      items: [
        { title: 'Installation', url: '/admin/settings' },
        { title: 'Project Structure', url: '/admin/settings' },
      ],
    },
    {
      title: 'Building Your Application',
      url: '#',
      icon: FileText,
      items: [
        { title: 'Routing', url: '/admin' , icon: Home},
        { title: 'Data Fetching', url: '/admin/machines', isActive: true, icon: FileText },
        { title: 'Rendering', url: '/admin' , icon: Layers},
        { title: 'Caching', url: '/admin' , icon: Server},
        { title: 'Styling', url: '/admin' , icon: BookOpen },
      ],
    },
    {
      title: 'API Reference',
      url: '#',
      icon: Layers,
      items: [
        { title: 'Components', url: '/admin/users', icon: Home },
        { title: 'Functions', url: '/admin/users', icon: FileText },
        { title: 'CLI', url: '/admin/users', icon: Server },
      ],
    },
  ],
}

export function AppSidebar(props) {
  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <VersionSwitcher versions={data.versions} defaultVersion={data.versions[0]} />
        <SearchForm />
      </SidebarHeader>
      <SidebarContent>
        {data.navMain.map((item) => (
          <SidebarGroup key={item.title}>
            <SidebarGroupLabel>
              {item.icon && <item.icon className="inline-block mr-2 h-4 w-4 align-middle" />} {item.title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {item.items.map((it) => (
                  <SidebarMenuItem key={it.title}>
                    <SidebarMenuButton asChild isActive={it.isActive} Icon={it.icon} title={it.title}>
                      <Link to={it.url}>{it.title}</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

export default AppSidebar

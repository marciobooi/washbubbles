import React, { createContext, useContext, useEffect, useState } from 'react'

const SidebarContext = createContext({})
const STORAGE_KEY = 'app.sidebar.collapsed'

export function SidebarProvider({ children }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1'
    } catch (e) {
      return false
    }
  })

  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
    } catch (e) {}
  }, [collapsed])

  const toggle = () => setCollapsed((s) => !s)

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, searchQuery, setSearchQuery }}>{children}</SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}

export function Sidebar({ children, className = '', ...props }) {
  const { collapsed } = useSidebar() || { collapsed: false }
  // When collapsed, use smaller width and hide overflow
  return (
    <aside
      className={`relative transition-all duration-150 flex-shrink-0 ${collapsed ? 'w-16' : 'w-64'} min-h-screen border-r bg-sidebar p-2 overflow-y-auto overflow-x-hidden ${className}`}
      data-collapsed={collapsed}
      {...props}
    >
      {children}
    </aside>
  )
}

export function SidebarHeader({ children, className = '' }) {
  return <div className={`px-2 py-4 ${className}`}>{children}</div>
}

export function SidebarContent({ children, className = '' }) {
  return <div className={`px-2 ${className}`}>{children}</div>
}

export function SidebarGroup({ children, className = '' }) {
  return <div className={`mb-2 ${className}`}>{children}</div>
}

export function SidebarGroupLabel({ children, className = '' }) {
  const { collapsed } = useSidebar() || { collapsed: false }
  return (
    <div className={`px-2 text-xs text-muted-foreground mb-1 ${className}`}>
      {typeof children === 'string' ? (
        <span className={`${collapsed ? 'hidden' : ''}`}>{children}</span>
      ) : (
        // if children contains icon + text, let it render but hide textual nodes when collapsed
        React.Children.map(children, (c) => {
          if (typeof c === 'string') return <span className={`${collapsed ? 'hidden' : ''}`}>{c}</span>
          return c
        })
      )}
    </div>
  )
}

export function SidebarGroupContent({ children, className = '' }) {
  return <div className={`px-1 ${className}`}>{children}</div>
}

export function SidebarMenu({ children, className = '' }) {
  return <ul className={`space-y-1 ${className}`}>{children}</ul>
}

export function SidebarMenuItem({ children, className = '' }) {
  return <li className={`${className}`}>{children}</li>
}

import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'

export function SidebarMenuButton({ children, isActive, asChild = false, className = '', title, Icon, ...props }) {
  const { collapsed } = useSidebar() || { collapsed: false }
  const base = `flex items-center gap-2 w-full text-left px-3 py-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'}`
  // set title attribute so tooltips work when collapsed
  const mergedTitle = title || (typeof children === 'string' ? children : undefined)

  const content = (
    <div className={`${base} ${className}`} {...props}>
      {Icon && <Icon className="h-4 w-4" aria-hidden />}
      <span className={`${collapsed ? 'hidden' : ''}`}>{children}</span>
    </div>
  )

  if (asChild && React.isValidElement(children)) {
    // When using `asChild` (e.g., anchor), replace its children to include the Icon and
    // wrap the text in a span so we can hide it when collapsed.
    const childText = children.props.children
    const newChildren = (
      <>
        {Icon && <Icon className="h-4 w-4" aria-hidden />}
        <span className={`${collapsed ? 'hidden' : ''}`}>{childText}</span>
      </>
    )

    return React.cloneElement(children, {
      className: `${children.props.className || ''} ${base} ${className}`,
      title: mergedTitle,
      children: newChildren,
      ...props,
    })
  }

  // Wrap with Tooltip when collapsed
  if (collapsed && mergedTitle) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {content}
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>
            {mergedTitle}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return content
}

export function SidebarRail() {
  return <div className="hidden md:block p-2" aria-hidden />
}

export function SidebarInset({ children }) {
  return <div className="flex flex-1 flex-col min-h-screen">{children}</div>
}

import { ChevronLeft, ChevronRight } from 'lucide-react'

export function SidebarTrigger({ className = '' }) {
  const ctx = useSidebar() || { toggle: () => {}, collapsed: false }
  return (
    <button
      className={`p-2 rounded-md hover:bg-muted/50 ${className}`}
      aria-expanded={ctx.collapsed}
      onClick={ctx.toggle}
      title={ctx.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <span className={`inline-block transform transition-transform ${ctx.collapsed ? 'rotate-180' : ''}`}>
        {ctx.collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </span>
    </button>
  )
}

export function SidebarInput(props) {
  return <input className="w-full rounded-md border p-2" {...props} />
}

export default Sidebar

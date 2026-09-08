import React, { createContext, useContext, useEffect, useState } from 'react'

const SidebarContext = createContext({})
const STORAGE_KEY = 'app.sidebar.collapsed'
// Below this width the sidebar was previously squeezed permanently alongside
// the content in a flex row (min width 5rem even "collapsed") rather than
// adapting at all — on a phone that left almost no room for the actual page.
const MOBILE_BREAKPOINT_PX = 768

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

export function SidebarProvider({ children }) {
  const isMobile = useIsMobile()

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1'
    } catch (e) {
      return false
    }
  })

  // Separate from `collapsed`: on mobile the sidebar is an off-canvas drawer
  // that starts closed, rather than a narrower permanent column. The two
  // states don't interact — switching screen sizes doesn't fight over one flag.
  const [mobileOpen, setMobileOpen] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
    } catch { /* localStorage throws in private mode; the preference is optional */ }
  }, [collapsed])

  // toggle() is what SidebarTrigger calls; its meaning depends on device size
  // so the header button doesn't need to know which mode it's driving.
  const toggle = () => (isMobile ? setMobileOpen((s) => !s) : setCollapsed((s) => !s))
  const closeMobile = () => setMobileOpen(false)

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, isMobile, mobileOpen, closeMobile, searchQuery, setSearchQuery }}>{children}</SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}

export function Sidebar({ children, className = '', ...props }) {
  const { collapsed, isMobile, mobileOpen, closeMobile } = useSidebar() || { collapsed: false }

  if (isMobile) {
    // Off-canvas drawer: fixed over the content, slides in, with a backdrop to
    // dismiss it. Never takes up layout space of its own, unlike the desktop
    // column, so the page underneath keeps its full width.
    return (
      <>
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={closeMobile}
            aria-hidden="true"
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r bg-sidebar p-2 overflow-y-auto transition-transform duration-200 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} ${className}`}
          {...props}
        >
          {children}
        </aside>
      </>
    )
  }

  // Desktop: an inline column, narrower when collapsed.
  return (
    <aside
      className={`relative transition-all duration-150 flex-shrink-0 ${collapsed ? 'w-20' : 'w-64'} min-h-screen border-r bg-sidebar p-2 overflow-y-auto overflow-x-hidden ${className}`}
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
  const { collapsed, isMobile } = useSidebar() || { collapsed: false }
  // The icon-only "collapsed" treatment is a desktop-only space saving — the
  // mobile drawer is always full width, so text must stay visible there even
  // if the desktop column happened to be left collapsed.
  const hideText = collapsed && !isMobile
  return (
    <div className={`px-2 text-xs text-muted-foreground mb-1 ${className}`}>
      {typeof children === 'string' ? (
        <span className={`${hideText ? 'hidden' : ''}`}>{children}</span>
      ) : (
        // if children contains icon + text, let it render but hide textual nodes when collapsed
        React.Children.map(children, (c) => {
          if (typeof c === 'string') return <span className={`${hideText ? 'hidden' : ''}`}>{c}</span>
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
  const { collapsed: collapsedDesktop, isMobile, closeMobile } = useSidebar() || { collapsed: false }
  // Icon-only mode is a desktop space-saving affordance; the mobile drawer is
  // always full width and has room for labels, so never collapse there.
  const collapsed = collapsedDesktop && !isMobile
  const base = `flex items-center gap-2 w-full text-left p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'}`
  // set title attribute so tooltips work when collapsed
  const mergedTitle = title || (typeof children === 'string' ? children : undefined)
  // Tapping a nav item on mobile should close the drawer over the page it just
  // navigated to, rather than leaving it covering the new screen.
  const mobileProps = isMobile ? { onClick: closeMobile } : {}

  const content = (
    <div className={`${base} ${className}`} {...mobileProps} {...props}>
      {Icon && <Icon className="!h-6 !w-6 shrink-0" aria-hidden />}
      <span className={`${collapsed ? 'hidden' : ''}`}>{children}</span>
    </div>
  )

  if (asChild && React.isValidElement(children)) {
    // When using `asChild` (e.g., anchor), replace its children to include the Icon and
    // wrap the text in a span so we can hide it when collapsed.
    const childText = children.props.children
    const newChildren = (
      <>
        {Icon && <Icon className="!h-6 !w-6 shrink-0" aria-hidden />}
        <span className={`${collapsed ? 'hidden' : ''}`}>{childText}</span>
      </>
    )

    return React.cloneElement(children, {
      className: `${children.props.className || ''} ${base} ${className}`,
      title: mergedTitle,
      children: newChildren,
      ...mobileProps,
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

import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react'

export function SidebarTrigger({ className = '' }) {
  const ctx = useSidebar() || { toggle: () => {}, collapsed: false }
  const expanded = ctx.isMobile ? ctx.mobileOpen : !ctx.collapsed
  return (
    <button
      className={`p-2 rounded-md hover:bg-muted/50 ${className}`}
      aria-expanded={expanded}
      aria-label={ctx.isMobile ? (ctx.mobileOpen ? 'Fechar menu' : 'Abrir menu') : (ctx.collapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral')}
      onClick={ctx.toggle}
      title={ctx.isMobile ? undefined : (ctx.collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
    >
      <span className="inline-block transform transition-transform">
        {ctx.isMobile
          ? (ctx.mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />)
          : (ctx.collapsed ? <ChevronRight className="h-6 w-6" /> : <ChevronLeft className="h-6 w-6" />)}
      </span>
    </button>
  )
}

export function SidebarInput(props) {
  return <input className="w-full rounded-md border p-2" {...props} />
}

export default Sidebar

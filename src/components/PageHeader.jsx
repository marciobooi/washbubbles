import React from 'react'

/**
 * Shared page header for admin pages: a consistent title (h1) with an
 * optional subtitle and an actions slot on the right. Keeps every admin
 * page's top bar aligned without repeating the layout each time.
 *
 * The header wraps instead of pushing the title off-screen: pages with many
 * action buttons (e.g. Cards) drop the actions to their own right-aligned
 * row on narrow widths, and the title keeps its space.
 */
export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-6 ${className}`}>
      <div className="min-w-0 shrink-0 max-w-full">
        <h1 className="text-2xl font-bold tracking-tight text-[#1c2530] truncate">{title}</h1>
        {subtitle && <p className="text-sm text-[#8a8478] mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2 ml-auto shrink-0">{actions}</div>}
    </div>
  )
}

import React from 'react'

/**
 * AdminPage - Standardized wrapper for all admin pages.
 * Provides consistent spacing, max-width, and layout structure.
 * 
 * Usage:
 * <AdminPage>
 *   <PageHeader title="Page Title" subtitle="Optional subtitle" actions={<Button>Action</Button>} />
 *   <Card>...</Card>
 * </AdminPage>
 */
export default function AdminPage({ 
  children, 
  className = '', 
  maxWidth = 'max-w-[1180px]' 
}) {
  return (
    <div className={`p-4 md:p-6 ${maxWidth} mx-auto ${className}`}>
      {children}
    </div>
  )
}

/**
 * AdminSection - A section within an admin page with a heading.
 * Used for grouping related content.
 */
export function AdminSection({ 
  title, 
  description, 
  children, 
  className = '' 
}) {
  return (
    <div className={`space-y-4 ${className}`}>
      {(title || description) && (
        <div className="flex items-center justify-between gap-3">
          <div>
            {title && <h4 className="m-0 text-[13px] uppercase tracking-[0.06em] text-[#8a8478] font-bold">{title}</h4>}
            {description && <p className="m-0 mt-1 text-sm text-[#8a8478]">{description}</p>}
          </div>
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * AdminCard - Standardized card wrapper with consistent styling.
 * Wraps the Card component with admin-specific defaults.
 */
export function AdminCard({ 
  title, 
  description, 
  children, 
  headerActions,
  className = '',
  ...props
}) {
  return (
    <Card className={className} {...props}>
      {(title || description || headerActions) && (
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {title && <CardTitle className="truncate">{title}</CardTitle>}
              {description && <CardDescription>{description}</CardDescription>}
            </div>
            {headerActions && <div className="shrink-0">{headerActions}</div>}
          </div>
        </CardHeader>
      )}
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

/**
 * AdminFormCard - Card specifically for forms with consistent save/cancel pattern.
 */
export function AdminFormCard({ 
  title, 
  description, 
  children, 
  onSubmit,
  onCancel,
  submitLabel = 'Guardar',
  cancelLabel = 'Cancelar',
  isSubmitting = false,
  className = ''
}) {
  return (
    <AdminCard title={title} description={description} className={className}>
      <form onSubmit={onSubmit} className="space-y-4">
        {children}
        <div className="flex justify-end gap-2 pt-2 border-t">
          {onCancel && (
            <button type="button" className="abtn" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button type="submit" className="abtn abtn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'A guardar…' : submitLabel}
          </button>
        </div>
      </form>
    </AdminCard>
  )
}

/**
 * AdminEmptyState - Consistent empty state display.
 */
export function AdminEmptyState({ 
  message = 'Nenhum registo encontrado.', 
  icon,
  action,
  className = ''
}) {
  return (
    <div className={`text-center py-12 ${className}`}>
      {icon && <div className="mx-auto mb-3 text-[#8a8478]">{icon}</div>}
      <p className="text-[#8a8478]">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/**
 * AdminLoadingState - Consistent loading state with skeleton.
 */
export function AdminLoadingState({ 
  variant = 'card', // 'card' | 'table' | 'grid'
  rows = 5,
  cols = 4,
  className = ''
}) {
  if (variant === 'table') {
    return (
      <Card className={className}>
        <SkeletonTable rows={rows} cols={cols} />
      </Card>
    )
  }
  if (variant === 'grid') {
    return (
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }} {...{ className }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[18px] p-4 space-y-3 animate-pulse">
            <div className="h-14 w-14 rounded-xl bg-[#eee9df]" />
            <div className="h-4 w-3/4 bg-[#eee9df] rounded" />
            <div className="h-3 w-1/2 bg-[#eee9df] rounded" />
            <div className="h-px bg-[#eee9df]" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-9 bg-[#eee9df] rounded-xl" />
              <div className="h-9 bg-[#eee9df] rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <Card className={className}>
      <CardContent className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 animate-pulse">
            <div className="h-12 w-12 rounded-xl bg-[#eee9df]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 bg-[#eee9df] rounded" />
              <div className="h-3 w-1/4 bg-[#eee9df] rounded" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * AdminTable - Standardized table wrapper with consistent styling.
 */
export function AdminTable({ 
  headers, 
  rows, 
  emptyMessage = 'Nenhum registo.',
  loading = false,
  className = '',
  ...props
}) {
  if (loading) {
    return <AdminLoadingState variant="table" />
  }
  
  if (!rows || rows.length === 0) {
    return (
      <Card className={className}>
        <CardContent>
          <div className="text-center py-8 text-[#8a8478]">{emptyMessage}</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={`overflow-auto ${className}`} {...props}>
      <table className="min-w-full divide-y text-sm">
        <thead className="bg-muted-foreground/5">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-2 text-left font-semibold text-[#1c2530]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.06]">
          {rows.map((row, rowIndex) => (
            <tr key={row.key || rowIndex} className="hover:bg-neutral-50/50">
              {row.cells.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-3 text-[#1c2530]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

/**
 * AdminTabs - Standardized tab navigation for settings pages.
 */
export function AdminTabs({ 
  tabs, 
  activeTab, 
  onChange,
  className = ''
}) {
  return (
    <div className={`flex gap-2 overflow-x-auto pb-1 max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-full border whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[var(--primary,#0d9488)]
              ${active 
                ? 'bg-[var(--primary,#0d9488)] text-white border-transparent hover:bg-[color-mix(in_srgb,var(--primary,#0d9488)_88%,black)]' 
                : 'bg-white border-black/[0.12] text-neutral-700 hover:bg-white hover:border-[var(--primary,#0d9488)] hover:text-[var(--primary,#0d9488)] active:bg-neutral-50'}`}
          >
            {tab.Icon && <tab.Icon className="h-4 w-4" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * AdminSwitch - Standardized toggle switch component.
 */
export function AdminSwitch({ 
  checked, 
  onChange, 
  disabled = false,
  label,
  description,
  className = ''
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="flex-1 min-w-0">
        {label && <div className="font-medium text-sm">{label}</div>}
        {description && <p className="text-xs text-[#8a8478] mt-1">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50
          ${checked ? 'bg-[var(--primary,#0d9488)]' : 'bg-neutral-300'}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
            ${checked ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </button>
    </div>
  )
}

// Import required components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonTable } from '@/components/ui/Skeleton'
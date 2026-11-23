import React from 'react'

/**
 * Consistent empty-state block for tables/lists: an icon, a title and a
 * short hint. Drop it inside a <td colSpan={...}> or as a standalone block.
 */
export default function EmptyState({ title, hint, icon, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-10 text-center ${className}`}>
      {icon && <div className="text-[#8a8478] opacity-70">{icon}</div>}
      <p className="text-sm font-semibold text-[#1c2530]">{title}</p>
      {hint && <p className="text-xs text-[#8a8478] max-w-sm">{hint}</p>}
    </div>
  )
}

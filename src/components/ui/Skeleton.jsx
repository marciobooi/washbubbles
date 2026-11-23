import React from 'react'

/**
 * Simple pulsing skeleton placeholder for loading states. Use `width`/`height`
 * (CSS length) or pass children to size it; defaults to a full-width line.
 */
export default function Skeleton({ width = '100%', height = '1rem', className = '', rounded = 'rounded-md' }) {
  return (
    <div
      className={`animate-pulse bg-[#eee9df] ${rounded} ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}

export function SkeletonTable({ rows = 5, cols = 5 }) {
  return (
    <div className="bg-white rounded shadow overflow-auto">
      <table className="min-w-full divide-y text-sm">
        <thead className="bg-muted-foreground/5">
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="px-4 py-2"><Skeleton height="0.875rem" width="60%" /></th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="px-4 py-3"><Skeleton height="0.875rem" width={`${50 + (r * 7 + c * 13) % 40}%`} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

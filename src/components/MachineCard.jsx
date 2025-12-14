import React from 'react'
import useFrameAnimation from '../hooks/useFrameAnimation'

export default function MachineCard({ m, frames, onSelect = () => {} }) {
  const seed = Array.from(String(m.id)).reduce((s, c) => s * 31 + c.charCodeAt(0), 0)
  const frame = useFrameAnimation(frames, 300, { seed })
  const isFree = m.status === 'free'
  const borderClass = isFree ? 'border-1 border-green-500' : 'border-1 border-red-500'
  const interactiveClass = isFree
    ? 'cursor-pointer active:scale-95 active:shadow-lg hover:shadow-lg transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-400'
    : 'cursor-not-allowed opacity-70 pointer-events-none'

  return (
    <div
      className={`rounded-xl shadow-xl bg-white flex items-center gap-4 p-4 ${borderClass} ${interactiveClass}`}
      onClick={() => isFree && onSelect(m.id)}
      role="button"
      aria-disabled={!isFree}
    >
      <div className="w-20 h-20 flex items-center justify-center">
        {frame && (
          <img src={frame} alt={`${m.name}`} className="w-16 h-16 object-contain tealFilter" />
        )}
      </div>
      <div className="flex-1">
        <div className="text-lg font-semibold">{m.name}</div>
        <div className="text-sm text-neutral-600">{m.weight} kg • {m.price.toFixed(2)}€{m.price ? ` • ${Math.max(0, m.price - 0.5).toFixed(2)}€ fidelidade` : ''}</div>
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${isFree ? 'bg-green-500' : 'bg-red-500'}`} />
        <div className="text-sm font-medium">{m.statusText || (isFree ? 'Livre' : 'Ocupado')}</div>
      </div>
    </div>
  )
}

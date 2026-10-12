import React from 'react'
import { ICONS } from './icons/MachineIcons'

export default function Card({ c, onClick = () => {} }) {
  const Icon = ICONS[c.id]
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed="false"
      onClick={() => onClick(c.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick(c.id)}
      className="h-full bg-white/95 rounded-3xl border border-emerald-100 shadow-xl shadow-teal-900/5 flex flex-col items-center justify-center text-center px-8 py-8 select-none cursor-pointer transition-transform duration-100 active:scale-[0.975]"
    >
      <div className="w-40 h-40 rounded-full bg-gradient-to-br from-emerald-50 to-teal-100/60 border border-emerald-100/80 flex items-center justify-center mb-6">
        {Icon ? <Icon className="w-28 h-28" /> : null}
      </div>
      <h2 className="text-3xl font-black text-slate-800 tracking-wider uppercase">{c.text}</h2>
      <div className="w-16 h-1.5 bg-teal-400/80 rounded-full mt-4" />
      {c.sub ? <p className="text-base font-semibold text-slate-400 mt-3 uppercase tracking-wider">{c.sub}</p> : null}
    </div>
  )
}

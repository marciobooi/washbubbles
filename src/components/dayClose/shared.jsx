import React from 'react'

// Shared by both day-close wizards — the admin dashboard's (`AdminDayClose.jsx`)
// and the kiosk's own (`KioskDayCloseModal.jsx`). Kept in one place so the two
// surfaces can never drift into disagreeing about how a count is displayed or
// totalled, mirroring how `services/dayClose.js` is the one place the actual
// reconciliation math lives on the backend.

export const COIN_DENOMS = [0.05, 0.10, 0.20, 0.50, 1.00, 2.00]
export const BILL_DENOMS = [5, 10, 20, 50, 100, 200]
export const ALL_CASH_DENOMS = [...COIN_DENOMS, ...BILL_DENOMS]

export function fmt(n) { return Number(n || 0).toFixed(2) }
export function denomSum(arr) { return arr.reduce((s, d) => s + Number(d.value) * Number(d.count || 0), 0) }
export function buildDenomState(values) { return values.map(v => ({ value: v, count: 0 })) }
export function fmtDenomLabel(v) {
  if (v < 1) return `${Math.round(v * 100)}c`
  if (v % 1 === 0) return `${v}€`
  return `${Number(v).toFixed(2)}€`
}
export function buildDenomFromSaved(values, saved) {
  return values.map(v => {
    const found = (saved || []).find(d => Math.abs(Number(d.value) - v) < 0.001)
    return { value: v, count: found ? Number(found.count || 0) : 0 }
  })
}
export function computeGap(targetDenoms, actualDenoms) {
  return COIN_DENOMS.map(v => {
    const t = targetDenoms.find(d => Math.abs(d.value - v) < 0.001)?.count || 0
    const a = actualDenoms.find(d => Math.abs(d.value - v) < 0.001)?.count || 0
    return { value: v, target: t, actual: a, toAdd: Math.max(0, t - a) }
  })
}

// ── Coin chip grid — each denomination is a card with a stepper input ────────
export function CoinChipGrid({ denoms, onChange, readOnly = false, className = '' }) {
  const isCoin = v => v < 3
  return (
    <div className={`grid grid-cols-3 gap-2 sm:grid-cols-6 ${className}`}>
      {denoms.map((d, i) => {
        const coin = isCoin(d.value)
        const active = d.count > 0
        return (
          <div
            key={d.value}
            className={`relative flex flex-col items-center rounded-xl border-2 py-2 px-1 transition-all
              ${readOnly
                ? active ? 'border-primary-300 bg-primary-50' : 'border-neutral-100 bg-neutral-50 opacity-50'
                : active ? 'border-primary-400 bg-primary-50 shadow-sm' : 'border-neutral-200 bg-white hover:border-primary-300'
              }`}
          >
            {/* Coin/bill icon */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mb-1
              ${coin
                ? active ? 'bg-primary-500 text-white' : 'bg-neutral-200 text-neutral-500'
                : active ? 'bg-emerald-500 text-white' : 'bg-neutral-200 text-neutral-500'
              }`}>
              {fmtDenomLabel(d.value)}
            </div>
            {readOnly ? (
              <div className={`text-base font-bold ${active ? 'text-primary-700' : 'text-neutral-400'}`}>
                {d.count || 0}
              </div>
            ) : (
              <input
                type="number" min="0" step="1"
                className="w-full text-center text-sm font-semibold border-0 bg-transparent p-0 focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                value={d.count === 0 ? '' : d.count}
                onChange={e => onChange(i, e.target.value)}
                placeholder="0"
              />
            )}
            {active && (
              <div className="text-[10px] text-primary-600 font-medium mt-0.5">
                {fmt(d.value * d.count)}&euro;
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Hopper bar — visual fill per denomination ─────────────────────────────────
export function HopperBar({ actual, target, value }) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
  const color = pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="w-10 text-xs font-semibold text-neutral-600 text-right">{fmtDenomLabel(value)}</div>
      <div className="flex-1 h-3 bg-neutral-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-20 text-xs text-neutral-500 text-right">
        {actual}/{target} <span className={pct < 100 ? 'text-red-500 font-semibold' : 'text-emerald-600'}>({pct}%)</span>
      </div>
    </div>
  )
}

// ── Step section wrapper ──────────────────────────────────────────────────────
export function Step({ number, title, subtitle, children, accent = 'teal' }) {
  const accents = {
    teal:   'border-primary-500 bg-primary-50 text-primary-700',
    amber:  'border-amber-500 bg-amber-50 text-amber-700',
    emerald:'border-emerald-500 bg-emerald-50 text-emerald-700',
    blue:   'border-blue-500 bg-blue-50 text-blue-700',
    violet: 'border-violet-500 bg-violet-50 text-violet-700',
  }
  const badge = accents[accent] || accents.teal
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-5 pt-5 pb-3">
        {number && (
          <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${badge}`}>
            {number}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-semibold text-sm text-neutral-800 leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-neutral-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="px-5 pb-5 space-y-4">{children}</div>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, color = 'neutral', bold }) {
  const colors = {
    neutral: 'bg-neutral-50 border-neutral-200 text-neutral-700',
    teal:    'bg-primary-50 border-primary-200 text-primary-700',
    green:   'bg-emerald-50 border-emerald-200 text-emerald-700',
    blue:    'bg-blue-50 border-blue-200 text-blue-700',
    orange:  'bg-orange-50 border-orange-200 text-orange-700',
    red:     'bg-red-50 border-red-200 text-red-600',
    amber:   'bg-amber-50 border-amber-200 text-amber-700',
  }
  return (
    <div className={`rounded-xl border px-3 py-3 text-center ${colors[color] || colors.neutral}`}>
      <div className="text-[11px] font-medium opacity-70 mb-1 leading-tight">{label}</div>
      <div className={`text-xl leading-none ${bold ? 'font-extrabold' : 'font-semibold'}`}>{value}</div>
      {sub && <div className="text-[10px] opacity-60 mt-1">{sub}</div>}
    </div>
  )
}

// ── Money input ───────────────────────────────────────────────────────────────
export function MoneyInput({ label, value, onChange, readOnly, hint, required }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-neutral-600 mb-1.5">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm font-medium">&euro;</span>
        <input
          type="number" min="0" step="0.01" required={required}
          readOnly={readOnly}
          className={`w-full pl-7 pr-3 py-2.5 rounded-xl border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-400 transition
            ${readOnly ? 'bg-neutral-50 text-neutral-500 border-neutral-200' : 'bg-white border-neutral-300 text-neutral-800'}`}
          value={value}
          onChange={onChange ? e => onChange(e.target.value) : undefined}
          placeholder="0.00"
        />
      </div>
      {hint && <p className="text-[11px] text-neutral-400 mt-1">{hint}</p>}
    </div>
  )
}

// ── Discrepancy pill ──────────────────────────────────────────────────────────
export function DiscrepancyPill({ value }) {
  const zero = Math.abs(value) <= 0.005
  const neg  = value < -0.005
  if (zero) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-0.5">&#10003; Balancado</span>
  return (
    <span className={`inline-flex items-center rounded-full text-xs font-bold px-2.5 py-0.5 ${neg ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
      {value > 0 ? '+' : ''}{fmt(value)}&euro;
    </span>
  )
}

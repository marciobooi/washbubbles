import React from 'react'

// Shared by both day-close wizards — the admin dashboard's (`AdminDayClose.jsx`)
// and the kiosk's own (`KioskDayCloseModal.jsx`). Kept in one place so the two
// surfaces can never drift into disagreeing about how a count is displayed or
// totalled, mirroring how `services/dayClose.js` is the one place the actual
// reconciliation math lives on the backend.

export const COIN_DENOMS = [0.05, 0.10, 0.20, 0.50, 1.00, 2.00]
// The shop's bill acceptor takes 5, 10 and 20 euro notes only (50 and above are rejected), so those are the
// only notes there can be in the till from sales. Counting grids offer exactly these.
export const BILL_DENOMS = [5, 10, 20]
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

// ── Coin chip grid — each denomination is a touch card with − / + and tap-to-add ──────────────────────────
export function CoinChipGrid({ denoms, onChange, readOnly = false, className = '' }) {
  const isCoin = v => v < 3
  const set = (i, n) => onChange && onChange(i, Math.max(0, n))
  const card = (d, i) => {
    const coin = isCoin(d.value)
    const active = d.count > 0
    return (
      <div
        key={d.value}
        onClick={readOnly ? undefined : () => set(i, (d.count || 0) + 1)}
        className={`select-none relative flex flex-col items-center justify-between rounded-2xl border p-2.5 min-h-[104px] transition
          ${readOnly
            ? active ? 'border-primary-300 bg-primary-50' : 'border-neutral-100 bg-neutral-50 opacity-50'
            : `cursor-pointer active:scale-[0.98] ${active ? 'border-primary-400 bg-primary-50 shadow-sm' : 'border-neutral-200 bg-white hover:border-primary-300'}`
          }`}
      >
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold
          ${coin
            ? active ? 'bg-primary-500 text-white' : 'bg-neutral-100 text-neutral-600'
            : active ? 'bg-emerald-500 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
          {fmtDenomLabel(d.value)}
        </div>
        {readOnly ? (
          <div className={`text-xl font-extrabold leading-none ${active ? 'text-primary-700' : 'text-neutral-400'}`}>{d.count || 0}</div>
        ) : (
          // the quantity can be typed (a handful of coins at once) as well as stepped with − and +; tapping the card still adds one
          <input
            type="text" inputMode="numeric" pattern="[0-9]*" aria-label={`Quantidade de ${fmtDenomLabel(d.value)}`}
            value={d.count || 0}
            onClick={(e) => { e.stopPropagation(); e.target.select() }}
            onFocus={(e) => e.target.select()}
            onChange={(e) => set(i, parseInt(e.target.value.replace(/\D/g, '').slice(0, 5), 10) || 0)}
            className={`w-16 text-center text-xl font-extrabold leading-none bg-transparent rounded-md border border-transparent focus:border-primary-400 focus:bg-white focus:outline-none ${active ? 'text-primary-700' : 'text-neutral-400'}`}
          />
        )}
        {readOnly ? (
          <div className="h-7 text-[11px] text-primary-600 font-medium">{active ? `${fmt(d.value * d.count)}€` : ''}</div>
        ) : (
          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <button type="button" aria-label="Diminuir" onClick={() => set(i, (d.count || 0) - 1)}
              className="w-8 h-8 rounded-lg bg-neutral-100 hover:bg-neutral-200 active:scale-90 text-neutral-600 font-bold">−</button>
            <button type="button" aria-label="Aumentar" onClick={() => set(i, (d.count || 0) + 1)}
              className="w-8 h-8 rounded-lg bg-primary-50 text-primary-700 hover:bg-primary-100 active:scale-90 font-bold">+</button>
          </div>
        )}
      </div>
    )
  }
  const coins = denoms.map((d, i) => ({ d, i })).filter(x => isCoin(x.d.value))
  const bills = denoms.map((d, i) => ({ d, i })).filter(x => !isCoin(x.d.value))
  return (
    <div className={`space-y-3 ${className}`}>
      {coins.length > 0 && (
        <div>
          {bills.length > 0 && <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">Moedas</div>}
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">{coins.map(x => card(x.d, x.i))}</div>
        </div>
      )}
      {bills.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">Notas (aceites: 5€, 10€ e 20€)</div>
          <div className="grid grid-cols-3 gap-2.5 sm:max-w-[50%]">{bills.map(x => card(x.d, x.i))}</div>
        </div>
      )}
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
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-5 pt-5 pb-3">
        {number && (
          <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 bg-white ${badge.replace(/bg-\S+/, '')}`}>
            {number}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-bold text-base text-neutral-900 leading-tight">{title}</h3>
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
    <div className={`rounded-2xl border px-3 py-4 text-center min-h-[92px] flex flex-col justify-center ${colors[color] || colors.neutral}`}>
      <div className="text-[11px] font-medium opacity-70 mb-1 leading-tight">{label}</div>
      <div className={`text-2xl leading-none ${bold ? 'font-black' : 'font-extrabold'}`}>{value}</div>
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

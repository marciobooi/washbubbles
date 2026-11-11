import React from 'react'
import { fmtEuro, CARD_CLASS } from './fmt'

const monthShort = (ym) => {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-PT', { month: 'short' }).replace('.', '')
}

function Col({ title, children }) {
  return (
    <div className="flex flex-col gap-2.5 min-w-0">
      <div className="text-xs font-semibold text-[#8a8478]">{title}</div>
      {children}
    </div>
  )
}

export default function ClientsPanel({ data }) {
  const c = data?.clients
  if (!c) return null
  const nm = c.newCardsByMonth || []
  const maxNew = Math.max(1, ...nm.map((x) => x.cards))
  const seg = c.segments || {}
  const ret = c.retention || {}
  const mix = c.paymentMix || {}
  const segRows = [
    { key: 'regular', label: 'Regulares' },
    { key: 'occasional', label: 'Ocasionais' },
    { key: 'single', label: 'Uma só vez' },
  ]
  const mixRows = [
    { key: 'cash', label: 'Dinheiro', color: '#14b8a6' },
    { key: 'card', label: 'Cartão', color: '#f6c026' },
    { key: 'mbway', label: 'MB WAY', color: '#6366f1' },
  ]
  return (
    <div className={CARD_CLASS}>
      <h3 className="m-0 mb-4 text-[17px] font-extrabold">Clientes (últimos {c.days || 30} dias)</h3>
      <div className="grid gap-8 lg:grid-cols-3">
        <Col title="Cartões novos por mês">
          <div className="flex items-end gap-2 h-[120px]">
            {nm.map((x) => (
              <div key={x.month} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1" title={`${x.month}: ${x.cards} cartões novos`}>
                <span className="text-xs font-bold tabular-nums">{x.cards}</span>
                <div className="w-full max-w-[28px] rounded-t bg-primary-500" style={{ height: `${Math.max(2, (x.cards / maxNew) * 70)}%` }} />
                <span className="text-[10px] text-[#8a8478] capitalize">{monthShort(x.month)}</span>
              </div>
            ))}
          </div>
        </Col>

        <Col title="Quem usa os cartões">
          <div className="flex flex-col" title="Regular = usou o cartão em 4 ou mais dias; ocasional = 2 a 3 dias">
            {segRows.map((r) => (
              <div key={r.key} className="flex items-center gap-2 py-1.5 text-sm border-t border-black/[0.06] first:border-0">
                <span className="flex-1">{r.label}</span>
                <span className="tabular-nums">{seg[r.key]?.cards ?? 0} cartões</span>
                <span className="w-10 text-right text-[#8a8478] tabular-nums">{seg[r.key]?.sharePct != null ? `${Math.round(seg[r.key].sharePct)}%` : '-'}</span>
                <span className="w-20 text-right font-semibold tabular-nums">{fmtEuro(seg[r.key]?.spent)}</span>
              </div>
            ))}
          </div>
          <p className="m-0 text-[11px] text-[#8a8478]">Percentagem = parte do gasto com cartões. Passe o rato para ver o que é regular.</p>
          <p className="m-0 text-[13px]">
            Regressaram: <b>{ret.cameBack ?? 0}</b> de {ret.previousActive ?? 0}{ret.pct != null ? ` (${Math.round(ret.pct)}%)` : ''} dos cartões ativos no período anterior
          </p>
          <p className="m-0 text-[13px]">Cartões ativos: <b>{c.activeCards ?? 0}</b></p>
        </Col>

        <Col title="Como pagam">
          {mixRows.map((r) => {
            const m = mix[r.key] || {}
            const pct = Math.max(0, Math.min(100, Number(m.cyclesPct) || 0))
            return (
              <div key={r.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold">{r.label}</span>
                  <span className="text-xs text-[#8a8478] tabular-nums">{m.cyclesPct != null ? `${Math.round(m.cyclesPct)}%` : '-'} · {m.cycles || 0} ciclos · {fmtEuro(m.amount)}</span>
                </div>
                <div className="h-2 rounded-full bg-[#eee9df] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.color }} /></div>
              </div>
            )
          })}
          <p className="m-0 text-[11px] text-[#8a8478]">Os pagamentos com cartão gastam saldo já contado nas recargas.</p>
        </Col>
      </div>
    </div>
  )
}

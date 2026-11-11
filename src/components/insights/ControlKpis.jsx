import React from 'react'
import { fmtEuro, CARD_CLASS } from './fmt'

function DeltaChip({ pct, previous, unit, partial }) {
  const tip = partial
    ? `A loja ainda não tinha vendas durante todo o ${unit} anterior, por isso não há uma comparação justa. Aparece quando houver um ${unit} anterior completo.`
    : `Compara com os mesmos dias da ${unit} anterior (${fmtEuro(previous)}), para ser justo a meio do período.`
  if (pct == null) {
    return <span title={tip} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-[#f1efe9] text-[#8a8478]">sem comparação</span>
  }
  const up = pct >= 0
  return (
    <span title={tip} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${up ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#fef2f2] text-[#b91c1c]'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>{Math.abs(Math.round(pct))}%
    </span>
  )
}

function Kpi({ label, children }) {
  return (
    <div className={`${CARD_CLASS} !p-5 flex flex-col gap-1.5 min-w-0`}>
      <span className="text-[13px] font-bold text-[#8a8478]">{label}</span>
      {children}
    </div>
  )
}

const BIG = 'font-extrabold text-[28px] tracking-tight text-[#0c2b26] leading-tight'
const SMALL = 'text-xs text-[#8a8478]'

export default function ControlKpis({ data }) {
  if (!data) return null
  const { cardsLiability: cl, revenue, ticket } = data
  const idle = cl?.idle
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Kpi label="Dinheiro dos clientes nos cartões">
        <span className={BIG}>{fmtEuro(cl?.total)}</span>
        <span className={SMALL}>{cl?.cards || 0} cartões</span>
        {idle?.cards > 0 && (
          <span className="text-xs text-amber-700 cursor-help" title="Dinheiro já recebido mas ainda não usado: saldo de cartões sem utilização há muito tempo.">
            {fmtEuro(idle.amount)} parados há mais de {idle.afterDays} dias ({idle.cards} cartões)
          </span>
        )}
      </Kpi>
      <Kpi label="Esta semana">
        <span className={BIG}>{fmtEuro(revenue?.week?.current)}</span>
        <div><DeltaChip pct={revenue?.week?.deltaPct} previous={revenue?.week?.previous} partial={revenue?.week?.partial} unit="semana" /></div>
        <span className={SMALL}>mesmo período da semana anterior: {fmtEuro(revenue?.week?.previous)}</span>
      </Kpi>
      <Kpi label="Este mês">
        <span className={BIG}>{fmtEuro(revenue?.month?.current)}</span>
        <div><DeltaChip pct={revenue?.month?.deltaPct} previous={revenue?.month?.previous} partial={revenue?.month?.partial} unit="mês" /></div>
        <span className={SMALL}>mesmo período do mês anterior: {fmtEuro(revenue?.month?.previous)}</span>
      </Kpi>
      <Kpi label="Ticket médio">
        <span className={BIG}>{fmtEuro(ticket?.perVisit)} <span className="text-sm font-semibold text-[#8a8478]">por visita</span></span>
        <span className={SMALL}>{fmtEuro(ticket?.perCycle)} por ciclo · {ticket?.visits || 0} visitas</span>
      </Kpi>
    </div>
  )
}

import React from 'react'
import { fmtEuro, CARD_CLASS } from './fmt'

function Row({ label, color, d, share }) {
  const pct = Math.max(0, Math.min(100, Number(d?.occupancyPct) || 0))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-extrabold text-[15px]" style={{ color }}>{label}</span>
        <span className="text-xs text-[#8a8478]">{d?.machines || 0} máquinas</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span><b className="tabular-nums">{d?.cycles || 0}</b> ciclos</span>
        <span className="text-[#8a8478] tabular-nums">{Math.round(share || 0)}% dos ciclos</span>
        <span className="font-semibold tabular-nums ml-auto">{fmtEuro(d?.revenue)}</span>
      </div>
      <div className="flex items-center gap-2" title={`Ocupação: ${Math.round(pct)}%`}>
        <div className="flex-1 h-2 rounded-full bg-[#eee9df] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
        <span className="w-10 text-right text-xs tabular-nums text-[#8a8478]">{Math.round(pct)}%</span>
      </div>
    </div>
  )
}

export default function WashVsDry({ data }) {
  const wd = data?.washDry
  if (!wd) return null
  return (
    <div className={`${CARD_CLASS} flex flex-col gap-4 min-w-0`}>
      <h3 className="m-0 text-[16px] font-extrabold">Lavar vs. secar</h3>
      <Row label="Lavar" color="#14b8a6" d={wd.wash} share={wd.cyclesSharePct?.wash} />
      <Row label="Secar" color="#f59e0b" d={wd.dry} share={wd.cyclesSharePct?.dry} />
      <p className="m-0 text-xs text-[#8a8478]">Ocupação = tempo em ciclo / horas abertas. Perto de 100% de forma contínua indica falta de máquinas; muito baixa, máquinas a mais.</p>
    </div>
  )
}

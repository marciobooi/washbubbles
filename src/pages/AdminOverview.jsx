import React, { useEffect, useState } from 'react'
import { shopDateTime, shopDayKey } from '@/lib/shopTime'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import DonutChart from '@/components/charts/DonutChart'

function fmtEuro(n) {
  return `${(Number(n) || 0).toFixed(2)}€`
}

function fmtDay(isoDate) {
  const d = new Date(isoDate + 'T00:00:00')
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })
}

/** Minutes since a timestamp, or Infinity if there isn't one. */
function minutesSince(iso) {
  if (!iso) return Infinity
  return (Date.now() - new Date(iso).getTime()) / 60000
}

// Shared white surface used by every panel on this page.
function Panel({ className = '', children }) {
  return (
    <div className={`bg-card rounded-[20px] p-6 shadow-[0_1px_2px_rgba(20,25,30,0.04),0_8px_20px_-12px_rgba(20,25,30,0.08)] ${className}`}>
      {children}
    </div>
  )
}

export default function AdminOverview() {
  const [revenue, setRevenue] = useState([])
  const [machines, setMachines] = useState([])
  const [months, setMonths] = useState([]) // 'YYYY-MM', newest first
  const [month, setMonth] = useState('') // '' = the whole history
  const [rhythm, setRhythm] = useState(null)
  const [rhythmMonth, setRhythmMonth] = useState('') // '' = the whole history
  const [kiosks, setKiosks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const [rev, mach, kiosk] = await Promise.all([
          api.getAnalyticsRevenue(),
          api.getAnalyticsMachineMonths().catch(() => []),
          api.getKioskHealth().catch(() => []), // legacy-only fleet check; absent is fine
        ])
        if (!mounted) return
        setRevenue(Array.isArray(rev) ? rev : [])
        const list = Array.isArray(mach) ? mach : []
        setMonths(list)
        setMonth(list[0] || '') // opens on the latest month with sales
        setKiosks(Array.isArray(kiosk) ? kiosk : [])
      } catch (e) {
        console.error('Failed to load overview analytics', e)
        toast({ title: 'Erro ao carregar visão geral', variant: 'destructive' })
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    let mounted = true
    api.getAnalyticsMachines(month || undefined)
      .then((m) => { if (mounted) setMachines(Array.isArray(m) ? m : []) })
      .catch(() => { if (mounted) setMachines([]) })
    return () => { mounted = false }
  }, [month])

  useEffect(() => {
    let mounted = true
    api.getAnalyticsRhythm(rhythmMonth || undefined).then((r) => { if (mounted) setRhythm(r) }).catch(() => { if (mounted) setRhythm(null) })
    return () => { mounted = false }
  }, [rhythmMonth])

  const monthLabel = (m) => { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }) }
  const idx = months.indexOf(month)
  const totalCycles = machines.reduce((s, m) => s + (m.usageCount || 0), 0)
  const totalMachineRevenue = machines.reduce((s, m) => s + (m.totalRevenue || 0), 0)

  const totalRevenue30d = revenue.reduce((s, r) => s + (r.total || 0), 0)
  const todayKey = shopDayKey()
  const todayRevenue = revenue.find((r) => r._id === todayKey)?.total || 0

  // Every day from the first one with sales up to today (a day with no sales counts as 0), so the average is an honest daily average and
  // moves as the shop gets more days of history. "Receita" = cash + MB WAY: what is spent from a card was counted when it was loaded.
  const days = (() => {
    if (revenue.length === 0) return []
    const byKey = new Map(revenue.map((r) => [r._id, r]))
    const out = []
    const end = new Date(todayKey + 'T12:00:00')
    for (let d = new Date(revenue[0]._id + 'T12:00:00'); d <= end; d.setDate(d.getDate() + 1)) {
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      const r = byKey.get(k) || {}
      out.push({ key: k, cash: r.cash || 0, card: r.card || 0, mbway: r.mbway || 0, total: r.total || 0, count: r.count || 0 })
    }
    return out
  })()
  const avgDaily = days.length ? days.reduce((s, d) => s + d.total, 0) / days.length : 0
  const maxDay = Math.max(1, ...days.map((d) => d.cash + d.card + d.mbway))
  const weekdayShort = (k) => new Date(k + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short' })

  async function exportRevenueCsv() {
    try {
      const blob = await api.exportRevenueCsv()
      api.downloadBlob(blob, `receita-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao exportar CSV', variant: 'destructive' })
    }
  }

  const activeKiosks = kiosks.filter((k) => minutesSince(k.lastSeen) <= 15).length
  const kioskPct = kiosks.length ? Math.round((activeKiosks / kiosks.length) * 100) : 0

  if (loading) return <div className="p-6 text-[#8a8478]">A carregar…</div>

  return (
    <div className="flex flex-col gap-[18px] max-w-[1180px] print:max-w-full">
      <h1 className="m-0 text-[28px] font-extrabold tracking-tight">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr_0.85fr] gap-4">
        <div className="relative overflow-hidden bg-linear-to-br from-[#e4f4ef] to-[#cdece2] rounded-[20px] p-6 flex flex-col gap-2.5 min-h-[170px]">
          <div className="absolute -right-[30px] -bottom-10 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(13,148,136,0.16),transparent_70%)]" />
          <div className="absolute right-2.5 -bottom-2.5 w-[100px] h-[100px] rounded-[40%] bg-[radial-gradient(circle,rgba(245,158,11,0.14),transparent_70%)]" />
          <span className="text-[13px] font-bold text-[#0d6b60] relative">Hoje</span>
          <span className="font-extrabold text-[38px] tracking-tight text-[#0c2b26] relative">{fmtEuro(todayRevenue)}</span>
          <span className="text-[13px] text-[#3d5f57] relative">Últimos 30 dias: {fmtEuro(totalRevenue30d)}</span>
          {days.length > 0 && (
            <span className="text-[13px] text-[#3d5f57] relative" title={`Média de ${days.length} dias, do primeiro com vendas até hoje (os dias sem vendas contam como 0). Atualiza sozinha à medida que há mais dias.`}>
              Média diária: <strong>{fmtEuro(avgDaily)}</strong>{avgDaily > 0 ? <> · hoje {todayRevenue >= avgDaily ? '+' : '-'}{Math.round(Math.abs(todayRevenue / avgDaily - 1) * 100)}%</> : null}
            </span>
          )}
        </div>

        <Panel className="flex flex-col gap-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="m-0 mb-0.5 text-[16px] font-extrabold">Receita — últimos 30 dias</h3>
              <p className="m-0 text-xs text-[#8a8478]">Dinheiro, MB WAY e cartão, por dia · passe o rato por cima de um dia</p>
            </div>
            <button
              type="button"
              onClick={exportRevenueCsv}
              className="print:hidden shrink-0 inline-flex items-center h-8 px-3 rounded-full border border-black/[0.12] bg-white text-[#1c2530] font-semibold text-xs cursor-pointer transition-colors duration-150 hover:bg-[#f7f5f1]"
            >
              Exportar CSV
            </button>
          </div>
          {revenue.length === 0 ? (
            <>
              <div className="flex items-end gap-1.5 h-[76px]">
                {Array.from({ length: 6 }).map((_, i) => (
                  <span key={i} className="flex-1 h-[8%] bg-[#eee9df] rounded" />
                ))}
              </div>
              <p className="m-0 text-[12.5px] text-[#8a8478]">Sem vendas nos últimos 30 dias.</p>
            </>
          ) : (
            <div className="relative pt-1">
              <div className="relative flex items-end gap-[3px] h-[104px]">
                {/* the average: a dashed line across the bars */}
                {avgDaily > 0 && (
                  <div className="absolute left-0 right-0 border-t-2 border-dashed border-[#6366f1]/70 pointer-events-none z-[1]" style={{ bottom: `calc(20px + ${(avgDaily / maxDay) * 80}px)` }}>
                    <span className="absolute right-0 -top-4 text-[10px] font-bold text-[#6366f1] bg-white/80 px-1 rounded">média {fmtEuro(avgDaily)}</span>
                  </div>
                )}
                {days.map((d, i) => {
                  const vol = d.cash + d.card + d.mbway
                  const h = (n) => `${Math.round((n / maxDay) * 100)}%`
                  const side = i < 6 ? 'left-0' : i > days.length - 7 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                  const vs = avgDaily > 0 ? Math.round((d.total / avgDaily - 1) * 100) : null
                  return (
                    <div key={d.key} className="group relative flex-1 min-w-0 flex flex-col items-center gap-1">
                      <div className="flex flex-col justify-end h-20 w-full max-w-[16px] rounded overflow-hidden bg-[#eee9df] group-hover:ring-2 ring-[#6366f1]/40">
                        <div className="bg-amber-400" style={{ height: h(d.card) }} />
                        <div className="bg-[#6366f1]" style={{ height: h(d.mbway) }} />
                        <div className="bg-primary-500" style={{ height: h(d.cash) }} />
                      </div>
                      <div className="h-4 text-[10px] text-[#8a8478] whitespace-nowrap">{i % 5 === 0 || i === days.length - 1 ? fmtDay(d.key) : ''}</div>
                      {/* tooltip */}
                      <div className={`hidden group-hover:block absolute bottom-full mb-1 z-20 w-[210px] ${side} rounded-xl bg-[#1c2530] text-white text-xs p-3 shadow-lg pointer-events-none`}>
                        <div className="font-bold mb-1.5 capitalize">{weekdayShort(d.key)}, {fmtDay(d.key)} <span className="font-normal opacity-70">· {d.count} vendas</span></div>
                        <div className="flex justify-between"><span><span className="inline-block w-2 h-2 rounded-sm bg-primary-500 mr-1.5" />Dinheiro</span><b>{fmtEuro(d.cash)}</b></div>
                        <div className="flex justify-between"><span><span className="inline-block w-2 h-2 rounded-sm bg-[#6366f1] mr-1.5" />MB WAY</span><b>{fmtEuro(d.mbway)}</b></div>
                        <div className="flex justify-between"><span><span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1.5" />Cartão (consumo)</span><b>{fmtEuro(d.card)}</b></div>
                        <div className="flex justify-between border-t border-white/20 mt-1.5 pt-1.5"><span>Receita (dinheiro + MB WAY)</span><b>{fmtEuro(d.total)}</b></div>
                        {vs !== null && <div className="mt-1 opacity-80">{vs >= 0 ? '+' : ''}{vs}% face à média diária ({fmtEuro(avgDaily)})</div>}
                        <div className="mt-1 opacity-60">O consumo de cartão já foi contado quando o cartão foi recarregado.</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3.5 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-[9px] h-[9px] rounded-[3px] bg-primary-500 inline-block" />Dinheiro</span>
            <span className="flex items-center gap-1.5"><span className="w-[9px] h-[9px] rounded-[3px] bg-[#6366f1] inline-block" />MB WAY</span>
            <span className="flex items-center gap-1.5"><span className="w-[9px] h-[9px] rounded-[3px] bg-amber-400 inline-block" />Cartão</span>
            {avgDaily > 0 && <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#6366f1] inline-block" />Média diária ({days.length} dias)</span>}
          </div>
        </Panel>

        <Panel className="flex flex-col items-center gap-2.5">
          <h3 className="m-0 text-[15px] font-extrabold self-start">Quiosques ativos</h3>
          <div
            className="w-28 h-28 rounded-full flex items-center justify-center mt-1"
            style={{ background: `conic-gradient(#14b8a6 ${kioskPct}%, var(--donut-track, #eee9df) ${kioskPct}% 100%)` }}
          >
            <div className="w-[86px] h-[86px] rounded-full bg-card flex flex-col items-center justify-center">
              <span className="font-extrabold text-xl tracking-tight">{activeKiosks} / {kiosks.length}</span>
            </div>
          </div>
          <span className="text-xs text-[#8a8478]">{activeKiosks === 0 ? 'nenhum ativo agora' : `${kioskPct}% da frota`}</span>
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="m-0 mb-[3px] text-[17px] font-extrabold">Quando trabalha mais</h3>
            <p className="m-0 text-[13px] text-[#8a8478]">Ciclos pagos nas máquinas ({rhythmMonth ? monthLabel(rhythmMonth) : 'todo o histórico'}), na hora da loja</p>
          </div>
          <select value={rhythmMonth} onChange={(e) => setRhythmMonth(e.target.value)} className="h-9 rounded-lg border border-black/10 bg-white px-3 text-sm capitalize">
            <option value="">Todo o histórico</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        {!rhythm || rhythm.parts.every((p) => !p.cycles) ? (
          <p className="m-0 text-sm text-[#8a8478]">Sem dados de utilização ainda.</p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-2">
            {[
              { title: 'Parte do dia', list: rhythm.parts, colors: ['#f6c026', '#43b8a8', '#6366f1'], unit: 'ciclos' },
              { title: 'Dia da semana', list: rhythm.days, colors: ['#43b8a8', '#2f9e8f', '#7cd0c3', '#f6c026', '#f59e0b', '#6366f1', '#a78bfa'], unit: 'ciclos' },
            ].map(({ title, list, colors }) => {
              const total = list.reduce((s, x) => s + x.cycles, 0)
              const best = list.reduce((b, x) => (x.cycles > (b?.cycles ?? -1) ? x : b), null)
              return (
                <div key={title} className="flex flex-wrap items-center gap-5">
                  <DonutChart size={190} slices={list.map((x, i) => ({ key: x.key, label: x.label, value: x.cycles, color: colors[i % colors.length] }))}
                    centre={{ big: total, small: 'ciclos' }} />
                  <div className="flex-1 min-w-[220px]">
                    <div className="text-xs font-semibold text-[#8a8478] mb-1.5">{title}{best && best.cycles > 0 ? <> · mais forte: <span className="text-emerald-700">{best.label}</span></> : null}</div>
                    {list.map((x, i) => (
                      <div key={x.key} className={`flex items-center gap-2.5 py-1.5 text-sm border-t border-black/[0.06] first:border-0 ${best && x.key === best.key ? 'font-bold' : ''}`}>
                        <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: colors[i % colors.length] }} />
                        <span className="flex-1">{x.label}{x.hours ? <span className="text-[#8a8478] font-normal"> {x.hours}</span> : null}</span>
                        <span className="tabular-nums">{x.cycles}</span>
                        <span className="w-10 text-right text-[#8a8478] tabular-nums">{total > 0 ? Math.round((x.cycles / total) * 100) : 0}%</span>
                        <span className="w-20 text-right tabular-nums">{fmtEuro(x.revenue)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3.5">
          <div>
            <h3 className="m-0 mb-[3px] text-[17px] font-extrabold">Utilização das máquinas</h3>
            <p className="m-0 text-[13px] text-[#8a8478]">Receita e nº de ciclos por máquina ({month ? monthLabel(month) : 'todo o histórico'})</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" disabled={!month || idx >= months.length - 1} onClick={() => setMonth(months[idx + 1])} className="h-9 w-9 rounded-lg border border-black/10 bg-white text-lg disabled:opacity-30" aria-label="Mês anterior">&lsaquo;</button>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-lg border border-black/10 bg-white px-3 text-sm capitalize">
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              <option value="">Todo o histórico</option>
            </select>
            <button type="button" disabled={!month || idx <= 0} onClick={() => setMonth(months[idx - 1])} className="h-9 w-9 rounded-lg border border-black/10 bg-white text-lg disabled:opacity-30" aria-label="Mês seguinte">&rsaquo;</button>
          </div>
        </div>
        {machines.length === 0 ? (
          <p className="m-0 text-sm text-[#8a8478]">Sem dados de utilização ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[#8a8478] text-xs">
                  <th className="py-2 px-2.5 font-semibold">Máquina</th>
                  <th className="py-2 px-2.5 font-semibold">Ciclos</th>
                  <th className="py-2 px-2.5 font-semibold">Receita</th>
                  <th className="py-2 px-2.5 font-semibold">% da receita</th>
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => (
                  <tr key={m._id} className="border-t border-black/[0.07]">
                    <td className="py-2.5 px-2.5">{m.machineInfo?.name || m._id}</td>
                    <td className="py-2.5 px-2.5">{m.usageCount}</td>
                    <td className="py-2.5 px-2.5 font-semibold">{fmtEuro(m.totalRevenue)}</td>
                    <td className="py-2.5 px-2.5 text-[#8a8478]">{totalMachineRevenue > 0 ? `${Math.round((m.totalRevenue / totalMachineRevenue) * 100)}%` : '-'}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-black/15 font-extrabold">
                  <td className="py-2.5 px-2.5">Total</td>
                  <td className="py-2.5 px-2.5">{totalCycles}</td>
                  <td className="py-2.5 px-2.5">{fmtEuro(totalMachineRevenue)}</td>
                  <td className="py-2.5 px-2.5"></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* one slim card: the fleet is usually a single kiosk */}
      <Panel className="!p-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <h3
            className="m-0 text-[15px] font-extrabold"
            title={'"Online" é a ligação em tempo real (agente legado): um quiosque offline-first pode funcionar normalmente sem ela. A última atividade é o sinal real de que está vivo.'}
          >
            Quiosques
          </h3>
          {kiosks.length === 0 ? (
            <span className="text-sm text-[#8a8478]">Nenhum quiosque registado.</span>
          ) : kiosks.map((k) => {
            const stale = minutesSince(k.lastSeen) > 15
            return (
              <div key={k.id} className="flex items-center gap-2.5 text-sm">
                <span className={`w-2 h-2 rounded-full ${stale ? 'bg-[#b91c1c]' : 'bg-[#10b981]'}`} />
                <span className="font-semibold">{k.name}</span>
                <span className="text-[#8a8478]">{k.lastSeen ? shopDateTime(k.lastSeen) : 'Nunca'}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${stale ? 'bg-[#fef2f2] text-[#b91c1c]' : 'bg-[#ecfdf5] text-[#047857]'}`}>
                  {stale ? 'Sem atividade recente' : 'Ativo'}
                </span>
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}

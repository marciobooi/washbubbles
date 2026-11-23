import React, { useEffect, useState } from 'react'
import { shopDateTime, shopDayKey } from '@/lib/shopTime'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import DonutChart from '@/components/charts/DonutChart'
import ControlKpis from '@/components/insights/ControlKpis'
import OccupancyHours from '@/components/insights/OccupancyHours'
import WashVsDry from '@/components/insights/WashVsDry'
import ClientsPanel from '@/components/insights/ClientsPanel'
import PageHeader from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import Skeleton, { SkeletonTable } from '@/components/ui/Skeleton'

function fmtEuro(n) {
  return `${(Number(n) || 0).toFixed(2)}€`
}

function fmtDay(isoDate) {
  const d = new Date(isoDate + 'T00:00:00')
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })
}

function minutesSince(iso) {
  if (!iso) return Infinity
  return (Date.now() - new Date(iso).getTime()) / 60000
}

function lastUseLabel(d) {
  if (d == null) return 'nunca'
  if (d === 0) return 'hoje'
  if (d === 1) return 'ontem'
  return `há ${d} dias`
}

const monthLabel = (m) => {
  const [y, mo] = m.split('-')
  const s = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const weekdayShort = (k) => new Date(k + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short' })

function RevenueSummaryCard({ todayRevenue, rangeRevenue, rangeAvgDaily, rangeDays, exportRevenueCsv }) {
  return (
    <Card className="relative overflow-hidden bg-gradient-to-br from-[#e4f4ef] to-[#cdece2] p-6 flex flex-col gap-2.5 min-h-[170px]">
      <div className="absolute -right-[30px] -bottom-10 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(13,148,136,0.16),transparent_70%)]" />
      <div className="absolute right-2.5 -bottom-2.5 w-[100px] h-[100px] rounded-[40%] bg-[radial-gradient(circle,rgba(245,158,11,0.14),transparent_70%)]" />
      <span className="text-[13px] font-bold text-[#0d6b60] relative">Hoje</span>
      <span className="font-extrabold text-[38px] tracking-tight text-[#0c2b26] relative">{fmtEuro(todayRevenue)}</span>
      <span className="text-[13px] text-[#3d5f57] relative">Período selecionado: {fmtEuro(rangeRevenue)}</span>
      {rangeDays.length > 0 && (
        <span className="text-[13px] text-[#3d5f57] relative" title={`Média de ${rangeDays.length} dias`}>
          Média diária: <strong>{fmtEuro(rangeAvgDaily)}</strong>{rangeAvgDaily > 0 ? <> · hoje {todayRevenue >= rangeAvgDaily ? '+' : '-'}{Math.round(Math.abs(todayRevenue / rangeAvgDaily - 1) * 100)}%</> : null}
        </span>
      )}
      <Button variant="outline" size="sm" onClick={exportRevenueCsv} className="mt-auto w-fit">
        Exportar CSV
      </Button>
    </Card>
  )
}

function RevenueChart({ rangeDays, rangeAvgDaily, rangeMaxDay, byMonth = false }) {
  const unit = byMonth ? 'mensal' : 'diária'
  const tick = byMonth ? Math.max(1, Math.ceil(rangeDays.length / 10)) : 5
  const label = (k) => byMonth ? new Date(k + '-01T12:00:00').toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' }).replace(' de ', '/') : fmtDay(k)
  if (rangeDays.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-end gap-1.5 h-[76px]">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="flex-1 h-[8%] bg-[#eee9df] rounded" />
            ))}
          </div>
          <p className="m-0 text-[12.5px] text-[#8a8478] text-center mt-4">Sem vendas nos últimos 30 dias.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-full flex flex-col">
      <CardContent className="space-y-4 flex-1 flex flex-col">
        {/* the bars take all the height the card has (it is stretched to the summary card beside it) */}
        <div className="relative pt-1 flex-1 flex flex-col min-h-[124px]">
          <div className="relative flex items-stretch gap-[3px] flex-1">
            {rangeAvgDaily > 0 && (
              <div className="absolute left-0 right-0 border-t-2 border-dashed border-[#6366f1]/70 pointer-events-none z-[1]" style={{ bottom: `calc(20px + ${rangeAvgDaily / rangeMaxDay} * (100% - 20px))` }}>
                <span className="absolute right-0 -top-4 text-[10px] font-bold text-[#6366f1] bg-white/80 px-1 rounded">média {fmtEuro(rangeAvgDaily)}</span>
              </div>
            )}
            {rangeDays.map((d, i) => {
              const h = (n) => `${Math.round((n / rangeMaxDay) * 100)}%`
              // beside the bar (right of it in the left half, left of it in the right half), from the top of the chart: never above it, where the page header cuts it off
              const side = i < rangeDays.length / 2 ? 'left-full ml-2' : 'right-full mr-2'
              const vs = rangeAvgDaily > 0 ? Math.round((d.total / rangeAvgDaily - 1) * 100) : null
              return (
                <div key={d.key} className="group relative flex-1 min-w-0 flex flex-col items-center gap-1">
                  <div className="flex flex-col justify-end flex-1 min-h-0 w-full max-w-[30px] rounded overflow-hidden bg-[#eee9df] group-hover:ring-2 ring-[#6366f1]/40">
                    <div className="bg-amber-400" style={{ height: h(d.card) }} />
                    <div className="bg-[#6366f1]" style={{ height: h(d.mbway) }} />
                    <div className="bg-primary-500" style={{ height: h(d.cash) }} />
                  </div>
                  <div className="h-4 text-[10px] text-[#8a8478] whitespace-nowrap">{i % tick === 0 || i === rangeDays.length - 1 ? label(d.key) : ''}</div>
                  <div className={`hidden group-hover:block absolute top-0 z-20 w-[210px] ${side} rounded-xl bg-[#1c2530] text-white text-xs p-3 shadow-lg pointer-events-none`}>
                    <div className="font-bold mb-1.5 capitalize">{byMonth ? monthLabel(d.key) : `${weekdayShort(d.key)}, ${fmtDay(d.key)}`} <span className="font-normal opacity-70">· {d.count} vendas</span></div>
                    <div className="flex justify-between"><span><span className="inline-block w-2 h-2 rounded-sm bg-primary-500 mr-1.5" />Dinheiro</span><b>{fmtEuro(d.cash)}</b></div>
                    <div className="flex justify-between"><span><span className="inline-block w-2 h-2 rounded-sm bg-[#6366f1] mr-1.5" />MB WAY</span><b>{fmtEuro(d.mbway)}</b></div>
                    <div className="flex justify-between"><span><span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1.5" />Cartão (consumo)</span><b>{fmtEuro(d.card)}</b></div>
                    <div className="flex justify-between border-t border-white/20 mt-1.5 pt-1.5"><span>Receita (dinheiro + MB WAY)</span><b>{fmtEuro(d.total)}</b></div>
                    {vs !== null && <div className="mt-1 opacity-80">{vs >= 0 ? '+' : ''}{vs}% face à média {unit} ({fmtEuro(rangeAvgDaily)})</div>}
                    <div className="mt-1 opacity-60">O consumo de cartão já foi contado quando o cartão foi recarregado.</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="w-[9px] h-[9px] rounded-[3px] bg-primary-500 inline-block" />Dinheiro</span>
          <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="w-[9px] h-[9px] rounded-[3px] bg-[#6366f1] inline-block" />MB WAY</span>
          <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="w-[9px] h-[9px] rounded-[3px] bg-amber-400 inline-block" />Cartão</span>
          {rangeAvgDaily > 0 && <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="w-4 border-t-2 border-dashed border-[#6366f1] inline-block" />Média {unit} ({rangeDays.length} {byMonth ? 'meses' : 'dias'})</span>}
        </div>
      </CardContent>
    </Card>
  )
}

function RhythmSection({ rhythm, rhythmMonth, months, setRhythmMonth, loadInsights }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-[17px] font-extrabold">Quando trabalha mais</CardTitle>
          <CardDescription>Ciclos pagos nas máquinas ({rhythmMonth ? monthLabel(rhythmMonth) : 'todo o histórico'}), na hora da loja</CardDescription>
        </div>
        <Select value={rhythmMonth || '__all__'} onValueChange={(v) => setRhythmMonth(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue placeholder="Todo o histórico" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todo o histórico</SelectItem>
            {months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {!rhythm || rhythm.parts.every((p) => !p.cycles) ? (
          <p className="m-0 text-sm text-[#8a8478]">Sem dados de utilização ainda.</p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-2">
            {[
              { title: 'Parte do dia', list: rhythm.parts, colors: ['#f6c026', '#43b8a8', '#6366f1'], unit: 'ciclos' },
              { title: 'Dia da semana', list: rhythm.days, colors: ['#43b8a8', '#2f9e8f', '#7cd0c3', '#f6c026', '#f59e0b', '#6366f1', '#a78bfa'], unit: 'ciclos' },
            ].map(({ title, list, colors }, chartIdx) => {
              const total = list.reduce((s, x) => s + x.cycles, 0)
              const best = list.reduce((b, x) => (x.cycles > (b?.cycles ?? -1) ? x : b), null)
              return (
                <div key={title} className={`flex flex-wrap items-center gap-5 ${chartIdx > 0 ? 'border-t border-black/10 pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8' : ''}`}>
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
      </CardContent>
    </Card>
  )
}

function MachineUsageTable({ machines, month, months, idx, setMonth, insights, totalCycles, totalAdmin, totalMachineRevenue }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-[17px] font-extrabold">Utilização das máquinas</CardTitle>
          <CardDescription>Receita e nº de ciclos por máquina ({month ? monthLabel(month) : 'todo o histórico'})</CardDescription>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" onClick={() => setMonth(months[idx + 1])} disabled={!month || idx >= months.length - 1} aria-label="Mês anterior">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </Button>
          <Select value={month || '__all__'} onValueChange={(v) => setMonth(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="Todo o histórico" />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
              <SelectItem value="__all__">Todo o histórico</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => setMonth(months[idx - 1])} disabled={!month || idx <= 0} aria-label="Mês seguinte">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {machines.length === 0 ? (
          <p className="m-0 text-sm text-[#8a8478]">Sem dados de utilização ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[#8a8478] text-xs">
                  <th className="py-2 px-2.5 font-semibold">Máquina</th>
                  <th className="py-2 px-2.5 font-semibold" title="Ciclos pagos pelos clientes (dinheiro, cartão ou MB WAY)">Ciclos pagos</th>
                  <th className="py-2 px-2.5 font-semibold" title="Arranques feitos pelo staff ou pelo admin, sem pagamento">Admin</th>
                  <th className="py-2 px-2.5 font-semibold" title="Ciclos pagos + arranques do admin: quantas vezes a máquina trabalhou">Total ciclos</th>
                  <th className="py-2 px-2.5 font-semibold">Receita</th>
                  <th className="py-2 px-2.5 font-semibold">% da receita</th>
                  {insights && <th className="py-2 px-2.5 font-semibold">Ocupação (30 dias)</th>}
                  {insights && <th className="py-2 px-2.5 font-semibold">Último uso</th>}
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => {
                  const ins = insights?.machines?.find((x) => String(x.id) === String(m._id))
                  const occ = Math.max(0, Math.min(100, Number(ins?.occupancyPct) || 0))
                  const stale = ins && ins.daysSinceUse != null && ins.daysSinceUse >= 7
                  return (
                    <tr key={m._id} className="border-t border-black/[0.07]">
                      <td className="py-2.5 px-2.5">{m.machineInfo?.name || m._id}</td>
                      <td className="py-2.5 px-2.5">{m.usageCount}</td>
                      <td className="py-2.5 px-2.5 text-[#8a8478]">{m.adminStarts || 0}</td>
                      <td className="py-2.5 px-2.5 font-semibold">{(m.usageCount || 0) + (m.adminStarts || 0)}</td>
                      <td className="py-2.5 px-2.5 font-semibold">{fmtEuro(m.totalRevenue)}</td>
                      <td className="py-2.5 px-2.5 text-[#8a8478]">{totalMachineRevenue > 0 ? `${Math.round((m.totalRevenue / totalMachineRevenue) * 100)}%` : '-'}</td>
                      {insights && (
                        <td className="py-2.5 px-2.5">
                          {ins ? (
                            <div className="flex items-center gap-2 min-w-[110px]">
                              <div className="flex-1 h-1.5 rounded-full bg-[#eee9df] overflow-hidden"><div className="h-full rounded-full bg-primary-500" style={{ width: `${occ}%` }} /></div>
                              <span className="w-9 text-right text-xs tabular-nums text-[#8a8478]">{Math.round(occ)}%</span>
                            </div>
                          ) : <span className="text-[#8a8478]">-</span>}
                        </td>
                      )}
                      {insights && (
                        <td className={`py-2.5 px-2.5 whitespace-nowrap ${stale ? 'text-[#b91c1c] font-bold' : 'text-[#8a8478]'}`}>{ins ? lastUseLabel(ins.daysSinceUse) : '-'}</td>
                      )}
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-black/15 font-extrabold">
                  <td className="py-2.5 px-2.5">Total</td>
                  <td className="py-2.5 px-2.5">{totalCycles}</td>
                  <td className="py-2.5 px-2.5">{totalAdmin}</td>
                  <td className="py-2.5 px-2.5">{totalCycles + totalAdmin}</td>
                  <td className="py-2.5 px-2.5">{fmtEuro(totalMachineRevenue)}</td>
                  <td className="py-2.5 px-2.5"></td>
                  {insights && <td className="py-2.5 px-2.5"></td>}
                  {insights && <td className="py-2.5 px-2.5"></td>}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function KiosksCard({ kiosks }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <CardTitle className="text-[15px] font-extrabold m-0" title={'"Online" é a ligação em tempo real (agente legado): um quiosque offline-first pode funcionar normalmente sem ela. A última atividade é o sinal real de que está vivo.'}>
          Quiosques
        </CardTitle>
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
    </Card>
  )
}

export default function AdminOverview() {
  const [revenue, setRevenue] = useState([])
  const [machines, setMachines] = useState([])
  const [months, setMonths] = useState([])
  const [month, setMonth] = useState('')
  const [rhythm, setRhythm] = useState(null)
  const [rhythmMonth, setRhythmMonth] = useState('')
  const [kiosks, setKiosks] = useState([])
  const [loading, setLoading] = useState(true)
  const [insights, setInsights] = useState(null)
  const [range, setRange] = useState('30')

  const loadInsights = React.useCallback(() => {
    return api.getAnalyticsInsights()
      .then((r) => setInsights(r && typeof r === 'object' ? r : null))
      .catch(() => setInsights(null))
  }, [])

  useEffect(() => { loadInsights() }, [loadInsights])

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const [rev, mach, kiosk] = await Promise.all([
          api.getAnalyticsRevenue(),
          api.getAnalyticsMachineMonths().catch(() => []),
          api.getKioskHealth().catch(() => []),
        ])
        if (!mounted) return
        setRevenue(Array.isArray(rev) ? rev : [])
        const list = Array.isArray(mach) ? mach : []
        setMonths(list)
        setMonth(list[0] || '')
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

  const idx = months.indexOf(month)
  const totalCycles = machines.reduce((s, m) => s + (m.usageCount || 0), 0)
  const totalAdmin = machines.reduce((s, m) => s + (m.adminStarts || 0), 0)
  const totalMachineRevenue = machines.reduce((s, m) => s + (m.totalRevenue || 0), 0)

  const totalRevenue30d = revenue.reduce((s, r) => s + (r.total || 0), 0)
  const todayKey = shopDayKey()
  const todayRevenue = revenue.find((r) => r._id === todayKey)?.total || 0

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

  const rangeDays = range === 'all' ? days : days.slice(-Number(range))
  const rangeRevenue = rangeDays.reduce((s, d) => s + d.total, 0)
  const rangeAvgDaily = rangeDays.length ? rangeDays.reduce((s, d) => s + d.total, 0) / rangeDays.length : 0
  const rangeMaxDay = Math.max(1, ...rangeDays.map((d) => d.cash + d.card + d.mbway))

  // "Todo" = the whole history: one bar per MONTH (hundreds of daily bars are unreadable)
  const byMonth = range === 'all'
  const chartDays = byMonth
    ? Object.values(rangeDays.reduce((m, d) => {
        const k = String(d.key).slice(0, 7)
        const r = m[k] || (m[k] = { key: k, cash: 0, card: 0, mbway: 0, total: 0, count: 0 })
        r.cash += d.cash; r.card += d.card; r.mbway += d.mbway; r.total += d.total; r.count += d.count || 0
        return m
      }, {})).sort((a, b) => a.key.localeCompare(b.key))
    : rangeDays
  const chartAvg = chartDays.length ? chartDays.reduce((s, d) => s + d.total, 0) / chartDays.length : 0
  const chartMax = Math.max(1, ...chartDays.map((d) => d.cash + d.card + d.mbway))

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

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" subtitle="Visão geral do negócio" />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral do negócio"
        actions={
          <div className="flex items-center gap-1.5">
            {[
              { id: '7', label: '7 dias' },
              { id: '30', label: '30 dias' },
              { id: '90', label: '90 dias' },
              { id: 'all', label: 'Todo' },
            ].map((r) => (
              <Button
                key={r.id}
                variant={range === r.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRange(r.id)}
                className={range === r.id ? 'bg-[var(--primary,#0d9488)] border-[var(--primary,#0d9488)] hover:bg-[color-mix(in_srgb,var(--primary,#0d9488)_88%,black)]' : ''}
              >
                {r.label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-[minmax(240px,0.8fr)_2.6fr] gap-4">
        <RevenueSummaryCard
          todayRevenue={todayRevenue}
          rangeRevenue={rangeRevenue}
          rangeAvgDaily={rangeAvgDaily}
          rangeDays={rangeDays}
          exportRevenueCsv={exportRevenueCsv}
        />

        <RevenueChart
          rangeDays={chartDays}
          rangeAvgDaily={chartAvg}
          rangeMaxDay={chartMax}
          byMonth={byMonth}
        />
      </div>

      {insights?.alerts?.coinSilent && (
        <div className="rounded-2xl border border-[#fecaca] bg-[#fef2f2] text-[#991b1b] px-5 py-3.5 text-sm" role="alert">
          <strong>O moedeiro pode estar mudo.</strong> Não chega nenhuma moeda desde {shopDateTime(insights.alerts.coinSilent.since)}
          {insights.alerts.coinSilent.lastCoinMinutesAgo != null ? ` (a última moeda foi há ${Math.round(insights.alerts.coinSilent.lastCoinMinutesAgo / 60 * 10) / 10} h)` : ''}, com a loja a trabalhar.
          Ponha uma moeda de teste; se não for contada, veja o moedeiro e reinicie os periféricos.
        </div>
      )}

      <ControlKpis data={insights} />

      <RhythmSection
        rhythm={rhythm}
        rhythmMonth={rhythmMonth}
        months={months}
        setRhythmMonth={setRhythmMonth}
        loadInsights={loadInsights}
      />

      {insights && (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
          <OccupancyHours data={insights} onSaved={loadInsights} />
          <WashVsDry data={insights} />
        </div>
      )}

      <MachineUsageTable
        machines={machines}
        month={month}
        months={months}
        idx={idx}
        setMonth={setMonth}
        insights={insights}
        totalCycles={totalCycles}
        totalAdmin={totalAdmin}
        totalMachineRevenue={totalMachineRevenue}
      />

      <ClientsPanel data={insights} />

      <KiosksCard kiosks={kiosks} />
    </div>
  )
}
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
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'

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

const shiftKey = (key, n) => new Date(new Date(key + 'T12:00:00Z').getTime() + n * 86400e3).toISOString().slice(0, 10)

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

// Revenue by day (or by month for "Tudo"): cash + MB WAY stacked (the revenue), card use as a line, the average as a dashed line
const REVENUE_CONFIG = {
  cash: { label: 'Dinheiro', color: '#43b8a8' },
  mbway: { label: 'MB WAY', color: '#6366f1' },
  card: { label: 'Cartão (consumo)', color: '#f6c026' },
}

function RevenueChart({ rangeDays, rangeAvgDaily, byMonth = false }) {
  const unit = byMonth ? 'mensal' : 'diária'
  const monthName = (k) => new Date(k + '-01T12:00:00').toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
  const tick = (k) => byMonth ? new Date(k + '-01T12:00:00').toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' }).replace(' de ', '/') : fmtDay(k)
  if (rangeDays.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="m-0 text-[12.5px] text-[#8a8478] text-center">Sem vendas neste período.</p>
        </CardContent>
      </Card>
    )
  }
  const data = rangeDays.map((d) => ({ key: d.key, cash: d.cash, mbway: d.mbway, card: d.card, total: d.total, count: d.count }))
  return (
    <Card className="h-full flex flex-col">
      <CardContent className="flex-1 flex flex-col gap-3 min-h-[240px]">
        <ChartContainer config={REVENUE_CONFIG} className="flex-1 w-full aspect-auto min-h-[200px]">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              {['cash', 'mbway'].map((k) => (
                <linearGradient key={k} id={`fill-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={`var(--color-${k})`} stopOpacity={0.55} />
                  <stop offset="95%" stopColor={`var(--color-${k})`} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="key" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={tick} />
            <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}€`} />
            <ChartTooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={<ChartTooltipContent
                labelFormatter={(k) => byMonth ? monthName(k).replace(/^./, (c) => c.toUpperCase()) : `${weekdayShort(k).replace(/^./, (c) => c.toUpperCase())}, ${fmtDay(k)}`}
                valueFormatter={fmtEuro}
                total={{ label: 'Receita (dinheiro + MB WAY)', value: (items) => fmtEuro(items.filter((i) => i.dataKey !== 'card').reduce((t, i) => t + (Number(i.value) || 0), 0)) }}
              />}
            />
            {rangeAvgDaily > 0 && <ReferenceLine y={rangeAvgDaily} stroke="#6366f1" strokeDasharray="5 4" strokeOpacity={0.7} label={{ value: `média ${fmtEuro(rangeAvgDaily)}`, position: 'insideTopRight', fill: '#6366f1', fontSize: 10, fontWeight: 700 }} />}
            {byMonth ? (
              // a few months: bars (a line between two points says nothing)
              <>
                <Bar isAnimationActive={false} dataKey="cash" stackId="a" fill="var(--color-cash)" maxBarSize={56} />
                <Bar isAnimationActive={false} dataKey="mbway" stackId="a" fill="var(--color-mbway)" maxBarSize={56} radius={[4, 4, 0, 0]} />
              </>
            ) : (
              <>
                <Area isAnimationActive={false} dataKey="mbway" type="monotone" stackId="a" stroke="var(--color-mbway)" fill="url(#fill-mbway)" />
                <Area isAnimationActive={false} dataKey="cash" type="monotone" stackId="a" stroke="var(--color-cash)" fill="url(#fill-cash)" />
              </>
            )}
            {/* card use is not revenue (it was counted when the card was loaded): a line on its own, not part of the stack */}
            <Line isAnimationActive={false} dataKey="card" type="monotone" stroke="var(--color-card)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ChartContainer>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {Object.entries(REVENUE_CONFIG).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5 whitespace-nowrap"><span className="w-[9px] h-[9px] rounded-[3px] inline-block" style={{ background: v.color }} />{v.label}</span>
          ))}
          {rangeAvgDaily > 0 && <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="w-4 border-t-2 border-dashed border-[#6366f1] inline-block" />Média {unit} ({rangeDays.length} {byMonth ? 'meses' : 'dias'})</span>}
        </div>
      </CardContent>
    </Card>
  )
}

function RhythmSection({ rhythm, rangeLabel }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="text-[17px] font-extrabold">Quando trabalha mais</CardTitle>
          <CardDescription>Ciclos pagos nas máquinas ({rangeLabel}), na hora da loja</CardDescription>
        </div>
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

function MachineUsageTable({ machines, rangeLabel, insights, totalCycles, totalAdmin, totalMachineRevenue }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="text-[17px] font-extrabold">Utilização das máquinas</CardTitle>
          <CardDescription>Receita e nº de ciclos por máquina ({rangeLabel})</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {machines.some((m) => (m.usageCount || 0) + (m.adminStarts || 0) > 0) && (
          <ChartContainer config={{ paid: { label: 'Ciclos pagos', color: '#43b8a8' }, admin: { label: 'Admin', color: '#a78bfa' } }} className="w-full aspect-auto h-[190px]">
            <BarChart data={machines.map((m) => ({ name: m.machineInfo?.name || String(m._id), paid: m.usageCount || 0, admin: m.adminStarts || 0 }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
              <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
              <ChartTooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={<ChartTooltipContent total={{ label: 'Total de ciclos', value: (items) => items.reduce((t, i) => t + (Number(i.value) || 0), 0) }} />} />
              <Bar dataKey="paid" stackId="c" fill="var(--color-paid)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="admin" stackId="c" fill="var(--color-admin)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
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
                  {insights && <th className="py-2 px-2.5 font-semibold">Ocupação</th>}
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
  const [rhythm, setRhythm] = useState(null)
  const [kiosks, setKiosks] = useState([])
  const [loading, setLoading] = useState(true)
  const [insights, setInsights] = useState(null)
  const [range, setRange] = useState('30')
  const todayKey = shopDayKey()
  // the dashboard filter as the days of the shop the server is asked about (Hoje = today; 7 / 30 days = the last N including today; Tudo = everything)
  const rangeObj = React.useMemo(() => {
    if (range === 'all') return { all: true }
    const n = Number(range)
    return { from: shiftKey(todayKey, -(n - 1)), to: todayKey }
  }, [range, todayKey])
  // "Hoje" draws the last 7 days in the chart (to have something to compare it with); the numbers are still today's
  const revenueRange = range === '1' ? { from: shiftKey(todayKey, -6), to: todayKey } : rangeObj
  const rangeLabel = range === 'all' ? 'todo o histórico' : range === '1' ? 'hoje' : `últimos ${range} dias`

  const loadInsights = React.useCallback(() => {
    return api.getAnalyticsInsights(undefined, rangeObj)
      .then((r) => setInsights(r && typeof r === 'object' ? r : null))
      .catch(() => setInsights(null))
  }, [rangeObj])

  useEffect(() => { loadInsights() }, [loadInsights]) // again whenever the filter changes

  // kiosks: once
  useEffect(() => {
    let mounted = true
    api.getKioskHealth().catch(() => []).then((k) => { if (mounted) setKiosks(Array.isArray(k) ? k : []) })
    return () => { mounted = false }
  }, [])

  // everything below follows the filter: the days, the machines and the hours of the day are asked again for the range
  useEffect(() => {
    let mounted = true
    Promise.all([
      api.getAnalyticsRevenue(revenueRange),
      api.getAnalyticsMachines(undefined, rangeObj).catch(() => []),
      api.getAnalyticsRhythm(undefined, rangeObj).catch(() => null),
    ]).then(([rev, mach, rhy]) => {
      if (!mounted) return
      setRevenue(Array.isArray(rev) ? rev : [])
      setMachines(Array.isArray(mach) ? mach : [])
      setRhythm(rhy)
    }).catch((e) => {
      console.error('Failed to load overview analytics', e)
      toast({ title: 'Erro ao carregar visão geral', variant: 'destructive' })
    }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [range]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalCycles = machines.reduce((s, m) => s + (m.usageCount || 0), 0)
  const totalAdmin = machines.reduce((s, m) => s + (m.adminStarts || 0), 0)
  const totalMachineRevenue = machines.reduce((s, m) => s + (m.totalRevenue || 0), 0)

  const totalRevenue30d = revenue.reduce((s, r) => s + (r.total || 0), 0)
  const todayRevenue = revenue.find((r) => r._id === todayKey)?.total || 0

  const days = (() => {
    if (revenue.length === 0) return []
    const byKey = new Map(revenue.map((r) => [r._id, r]))
    const out = []
    const end = new Date(todayKey + 'T12:00:00')
    const startKey = revenueRange.from || revenue[0]._id
    for (let d = new Date(startKey + 'T12:00:00'); d <= end; d.setDate(d.getDate() + 1)) {
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      const r = byKey.get(k) || {}
      out.push({ key: k, cash: r.cash || 0, card: r.card || 0, mbway: r.mbway || 0, total: r.total || 0, count: r.count || 0 })
    }
    return out
  })()

  const rangeDays = range === '1' ? days.slice(-1) : days
  const rangeRevenue = rangeDays.reduce((s, d) => s + d.total, 0)
  const rangeAvgDaily = rangeDays.length ? rangeDays.reduce((s, d) => s + d.total, 0) / rangeDays.length : 0
  const rangeMaxDay = Math.max(1, ...rangeDays.map((d) => d.cash + d.card + d.mbway))

  // "Tudo" = the whole history: one bar per MONTH (hundreds of daily bars are unreadable)
  const byMonth = range === 'all'
  // "Hoje" is one day: the chart keeps the last 7 so there is something to compare it with
  const chartDays = range === '1' ? days.slice(-7) : byMonth
    ? Object.values(rangeDays.reduce((m, d) => {
        const k = String(d.key).slice(0, 7)
        const r = m[k] || (m[k] = { key: k, cash: 0, card: 0, mbway: 0, total: 0, count: 0 })
        r.cash += d.cash; r.card += d.card; r.mbway += d.mbway; r.total += d.total; r.count += d.count || 0
        return m
      }, {})).sort((a, b) => a.key.localeCompare(b.key))
    : rangeDays
  const chartAvg = chartDays.length ? chartDays.reduce((s, d) => s + d.total, 0) / chartDays.length : 0

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
              { id: '1', label: 'Hoje' },
              { id: '7', label: '7 dias' },
              { id: '30', label: '30 dias' },
              { id: 'all', label: 'Tudo' },
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

      <RhythmSection rhythm={rhythm} rangeLabel={rangeLabel} />

      {insights && (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
          <OccupancyHours data={insights} onSaved={loadInsights} />
          <WashVsDry data={insights} />
        </div>
      )}

      <MachineUsageTable
        machines={machines}
        rangeLabel={rangeLabel}
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
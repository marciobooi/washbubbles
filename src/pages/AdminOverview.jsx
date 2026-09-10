import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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

export default function AdminOverview() {
  const [revenue, setRevenue] = useState([])
  const [machines, setMachines] = useState([])
  const [kiosks, setKiosks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const [rev, mach, kiosk] = await Promise.all([
          api.getAnalyticsRevenue(),
          api.getAnalyticsMachines(),
          api.getKioskHealth().catch(() => []), // legacy-only fleet check; absent is fine
        ])
        if (!mounted) return
        setRevenue(Array.isArray(rev) ? rev : [])
        setMachines(Array.isArray(mach) ? mach : [])
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

  const totalRevenue30d = revenue.reduce((s, r) => s + (r.total || 0), 0)
  const todayKey = new Date().toISOString().slice(0, 10)
  const todayRevenue = revenue.find((r) => r._id === todayKey)?.total || 0
  const maxDay = Math.max(1, ...revenue.map((r) => r.total || 0))

  async function exportRevenueCsv() {
    try {
      const blob = await api.exportRevenueCsv()
      api.downloadBlob(blob, `receita-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao exportar CSV', variant: 'destructive' })
    }
  }

  if (loading) return <div className="p-6 text-neutral-500">A carregar…</div>

  return (
    <div className="flex flex-col gap-4 max-w-6xl print:max-w-full">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Hoje</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmtEuro(todayRevenue)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Últimos 30 dias</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold">{fmtEuro(totalRevenue30d)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Quiosques ativos</CardDescription></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kiosks.filter((k) => minutesSince(k.lastSeen) <= 15).length} / {kiosks.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Receita — últimos 30 dias</CardTitle>
            <CardDescription>Dinheiro vs. cartão, por dia</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="print:hidden" onClick={exportRevenueCsv}>Exportar CSV</Button>
        </CardHeader>
        <CardContent>
          {revenue.length === 0 ? (
            <p className="text-sm text-neutral-500">Sem vendas nos últimos 30 dias.</p>
          ) : (
            <div className="flex items-end gap-1 h-40 overflow-x-auto pb-2">
              {revenue.map((r) => {
                const cash = r.cash || 0
                const card = r.card || 0
                const cashPct = Math.round((cash / maxDay) * 100)
                const cardPct = Math.round((card / maxDay) * 100)
                return (
                  <div key={r._id} className="flex flex-col items-center gap-1 shrink-0" style={{ width: 22 }} title={`${fmtDay(r._id)}: ${fmtEuro(r.total)} (${r.count} vendas)`}>
                    <div className="flex flex-col justify-end h-32 w-3 rounded overflow-hidden bg-neutral-100">
                      <div className="bg-amber-400" style={{ height: `${cardPct}%` }} />
                      <div className="bg-primary-500" style={{ height: `${cashPct}%` }} />
                    </div>
                    <div className="text-[10px] text-neutral-500 rotate-0">{fmtDay(r._id)}</div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="flex items-center gap-4 mt-2 text-xs text-neutral-600">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-primary-500" /> Dinheiro</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-amber-400" /> Cartão</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Utilização das máquinas</CardTitle>
          <CardDescription>Receita e nº de ciclos por máquina (todo o histórico)</CardDescription>
        </CardHeader>
        <CardContent>
          {machines.length === 0 ? (
            <p className="text-sm text-neutral-500">Sem dados de utilização ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 border-b">
                    <th className="py-2 pr-4">Máquina</th>
                    <th className="py-2 pr-4">Ciclos</th>
                    <th className="py-2 pr-4">Receita</th>
                  </tr>
                </thead>
                <tbody>
                  {machines.map((m) => (
                    <tr key={m._id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{m.machineInfo?.name || m._id}</td>
                      <td className="py-2 pr-4">{m.usageCount}</td>
                      <td className="py-2 pr-4 font-semibold">{fmtEuro(m.totalRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Frota de quiosques</CardTitle>
          <CardDescription>
            "Online" aqui é a ligação em tempo real (agente legado) — um quiosque
            offline-first pode estar a funcionar normalmente sem ela. Veja a
            última atividade para o sinal real de que ainda está vivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {kiosks.length === 0 ? (
            <p className="text-sm text-neutral-500">Nenhum quiosque registado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-neutral-500 border-b">
                    <th className="py-2 pr-4">Quiosque</th>
                    <th className="py-2 pr-4">Última atividade</th>
                    <th className="py-2 pr-4">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {kiosks.map((k) => {
                    const mins = minutesSince(k.lastSeen)
                    const stale = mins > 15
                    return (
                      <tr key={k.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">{k.name}</td>
                        <td className="py-2 pr-4">
                          {k.lastSeen ? new Date(k.lastSeen).toLocaleString('pt-PT') : 'Nunca'}
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${stale ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                            {stale ? 'Sem atividade recente' : 'Ativo'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

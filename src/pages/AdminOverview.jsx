import React, { useEffect, useState } from 'react'
import { shopDateTime, shopDayKey } from '@/lib/shopTime'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'

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
  const todayKey = shopDayKey()
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
        </div>

        <Panel className="flex flex-col gap-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="m-0 mb-0.5 text-[16px] font-extrabold">Receita — últimos 30 dias</h3>
              <p className="m-0 text-xs text-[#8a8478]">Dinheiro vs. cartão, por dia</p>
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
            <div className="flex items-end gap-1 h-[100px] overflow-x-auto pb-1">
              {revenue.map((r) => {
                const cash = r.cash || 0
                const card = r.card || 0
                const cashPct = Math.round((cash / maxDay) * 100)
                const cardPct = Math.round((card / maxDay) * 100)
                return (
                  <div key={r._id} className="flex flex-col items-center gap-1 shrink-0 w-[22px]" title={`${fmtDay(r._id)}: ${fmtEuro(r.total)} (${r.count} vendas)`}>
                    <div className="flex flex-col justify-end h-20 w-3 rounded overflow-hidden bg-[#eee9df]">
                      <div className="bg-amber-400" style={{ height: `${cardPct}%` }} />
                      <div className="bg-primary-500" style={{ height: `${cashPct}%` }} />
                    </div>
                    <div className="text-[10px] text-[#8a8478]">{fmtDay(r._id)}</div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="flex items-center gap-3.5 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-[9px] h-[9px] rounded-[3px] bg-primary-500 inline-block" />Dinheiro</span>
            <span className="flex items-center gap-1.5"><span className="w-[9px] h-[9px] rounded-[3px] bg-amber-400 inline-block" />Cartão</span>
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
        <h3 className="m-0 mb-[3px] text-[17px] font-extrabold">Utilização das máquinas</h3>
        <p className="m-0 mb-3.5 text-[13px] text-[#8a8478]">Receita e nº de ciclos por máquina (todo o histórico)</p>
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
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => (
                  <tr key={m._id} className="border-t border-black/[0.07]">
                    <td className="py-2.5 px-2.5">{m.machineInfo?.name || m._id}</td>
                    <td className="py-2.5 px-2.5">{m.usageCount}</td>
                    <td className="py-2.5 px-2.5 font-semibold">{fmtEuro(m.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <h3 className="m-0 mb-[3px] text-[17px] font-extrabold">Frota de quiosques</h3>
        <p className="m-0 mb-4 text-[13px] text-[#8a8478] max-w-[760px]">
          "Online" aqui é a ligação em tempo real (agente legado) — um quiosque
          offline-first pode estar a funcionar normalmente sem ela. Veja a
          última atividade para o sinal real de que ainda está vivo.
        </p>
        {kiosks.length === 0 ? (
          <p className="m-0 text-sm text-[#8a8478]">Nenhum quiosque registado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[#8a8478] text-xs">
                  <th className="py-2 px-2.5 font-semibold">Quiosque</th>
                  <th className="py-2 px-2.5 font-semibold">Última atividade</th>
                  <th className="py-2 px-2.5 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {kiosks.map((k) => {
                  const mins = minutesSince(k.lastSeen)
                  const stale = mins > 15
                  return (
                    <tr key={k.id} className="border-t border-black/[0.07]">
                      <td className="py-2.5 px-2.5">{k.name}</td>
                      <td className="py-2.5 px-2.5">
                        {k.lastSeen ? shopDateTime(k.lastSeen) : 'Nunca'}
                      </td>
                      <td className="py-2.5 px-2.5">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${stale ? 'bg-[#fef2f2] text-[#b91c1c]' : 'bg-[#ecfdf5] text-[#047857]'}`}>
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
      </Panel>
    </div>
  )
}

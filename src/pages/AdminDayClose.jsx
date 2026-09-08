import React, { useEffect, useState, useCallback } from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import DayCloseForm from '@/components/dayClose/DayCloseForm'
import { fmt, fmtDenomLabel, DiscrepancyPill } from '@/components/dayClose/shared'

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminDayClose() {
  const [summary, setSummary]               = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [history, setHistory]               = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [expandedId, setExpandedId]         = useState(null)

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      setSummary(await api.getDayCloseSummary())
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar resumo', variant: 'destructive' })
    } finally { setSummaryLoading(false) }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try { setHistory(await api.getDayCloses()) }
    catch (e) { console.error(e) }
    finally { setHistoryLoading(false) }
  }, [])

  useEffect(() => { loadSummary(); loadHistory() }, [loadSummary, loadHistory])

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-heading font-bold text-neutral-800">Fecho de Caixa</h1>
          {summary && !summaryLoading && (
            <p className="text-xs text-neutral-400 mt-0.5">
              Sessao desde {new Date(summary.periodFrom).toLocaleString('pt-PT')}
            </p>
          )}
        </div>
        {summary && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Sessao ativa
          </span>
        )}
      </div>

      <DayCloseForm
        summary={summary}
        summaryLoading={summaryLoading}
        onSubmit={(payload) => api.createDayClose(payload)}
        onClosed={() => { loadSummary(); loadHistory() }}
      />

      {/* ── History ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-neutral-100">
          <h3 className="font-semibold text-sm text-neutral-800">Historico de fechos</h3>
        </div>
        {historyLoading ? (
          <div className="p-6 text-sm text-neutral-400">A carregar...</div>
        ) : history.length === 0 ? (
          <div className="p-6 text-sm text-neutral-400">Sem registos anteriores</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {history.map(dc => {
              const disc = dc.discrepancy || 0
              const isOpen = expandedId === dc._id
              return (
                <div key={dc._id}>
                  {/* Row */}
                  <button
                    type="button"
                    className="w-full text-left px-5 py-4 hover:bg-neutral-50 transition flex flex-wrap items-center gap-x-5 gap-y-1"
                    onClick={() => setExpandedId(prev => prev === dc._id ? null : dc._id)}
                  >
                    <div className="text-xs text-neutral-400 w-32 shrink-0">
                      {new Date(dc.createdAt).toLocaleString('pt-PT', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs text-neutral-500">Esperado <strong className="text-neutral-700">{fmt(dc.expectedCash ?? (Number(dc.openingFloat||0)+Number(dc.totalCash||0)))}&euro;</strong></span>
                      <span className="text-xs text-neutral-500">Contado <strong className="text-neutral-700">{fmt(dc.countedCash)}&euro;</strong></span>
                      <DiscrepancyPill value={disc} />
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      <span className="rounded-full bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-0.5">
                        Banco {fmt(dc.amountToBank)}&euro;
                      </span>
                      <span className="text-neutral-400">{dc.closedByUsername || 'admin'}</span>
                      {dc.source === 'kiosk' ? (
                        <span className="rounded-full bg-blue-50 text-blue-600 font-semibold px-2 py-0.5">Quiosque (auto)</span>
                      ) : null}
                      <span className={`text-primary-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>&#9660;</span>
                    </div>
                  </button>
                  {/* Expanded detail */}
                  {isOpen && (
                    <div className="bg-neutral-50 border-t border-neutral-100 px-5 py-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 text-xs">
                        <DetailBlock title="Periodo">
                          <InfoRow label="Inicio" value={dc.periodFrom ? new Date(dc.periodFrom).toLocaleString('pt-PT') : '-'} />
                          <InfoRow label="Fim" value={new Date(dc.periodTo || dc.createdAt).toLocaleString('pt-PT')} />
                          <InfoRow label="Vendas" value={`${fmt(dc.totalSales)}€ (${fmt(dc.totalCash)} din + ${fmt(dc.totalCard)} cart)`} />
                          <InfoRow label="Fundo inicial" value={`${fmt(dc.openingFloat)}€`} />
                          {dc.totalChangeDispensed > 0 && <InfoRow label="Troco dispensado" value={`${fmt(dc.totalChangeDispensed)}€`} />}
                        </DetailBlock>
                        <DetailBlock title="Reconciliacao">
                          <InfoRow label="Esperado" value={`${fmt(dc.expectedCash ?? (Number(dc.openingFloat||0)+Number(dc.totalCash||0)))}€`} />
                          <InfoRow label="Contado" value={`${fmt(dc.countedCash)}€`} />
                          <div className="flex justify-between pt-0.5">
                            <span className="text-neutral-500">Diferenca</span><DiscrepancyPill value={disc} />
                          </div>
                          {dc.countedDenominations?.length > 0 && (
                            <div className="mt-2 grid grid-cols-3 gap-1">
                              {dc.countedDenominations.map((d, i) => (
                                <div key={i} className="bg-white rounded border px-1 py-0.5 text-center">
                                  <div className="text-neutral-400">{fmtDenomLabel(d.value)}</div>
                                  <div className="font-bold">x{d.count}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </DetailBlock>
                        <DetailBlock title="Hopper">
                          {dc.hopperActualBefore?.length > 0 && (
                            <>
                              <div className="text-neutral-400 mb-1">Antes de repor:</div>
                              {dc.hopperActualBefore.map((d, i) => (
                                <InfoRow key={i} label={fmtDenomLabel(d.value)} value={`x${d.count} = ${fmt(d.total)}€`} />
                              ))}
                              <InfoRow label="Subtotal" value={`${fmt(dc.hopperActualBeforeTotal)}€`} />
                            </>
                          )}
                          {dc.hopperCoins?.length > 0 && (
                            <>
                              <div className="text-neutral-400 mt-2 mb-1">Target reposicao:</div>
                              {dc.hopperCoins.map((d, i) => (
                                <InfoRow key={i} label={fmtDenomLabel(d.value)} value={`x${d.count} = ${fmt(d.total)}€`} />
                              ))}
                              <InfoRow label="Total target" value={`${fmt(dc.hopperTotal)}€`} />
                            </>
                          )}
                        </DetailBlock>
                      </div>
                      {dc.notes && (
                        <div className="mt-3 rounded-xl bg-white border border-neutral-200 px-4 py-2 text-xs text-neutral-600 italic">
                          &ldquo;{dc.notes}&rdquo;
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-neutral-400 shrink-0">{label}</span>
      <span className="text-neutral-700 font-medium text-right truncate">{value}</span>
    </div>
  )
}

function DetailBlock({ title, children }) {
  return (
    <div className="space-y-1">
      <div className="font-semibold text-neutral-700 mb-1.5">{title}</div>
      {children}
    </div>
  )
}

import React, { useEffect, useState, useCallback } from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import Modal from '@/components/ui/Modal'
import { PiggyBank, Trash2 } from 'lucide-react'
import DayCloseForm from '@/components/dayClose/DayCloseForm'
import HopperRefillModal from '@/components/dayClose/HopperRefillModal'
import { fmt, fmtDenomLabel, DiscrepancyPill, ALL_CASH_DENOMS, CoinChipGrid, buildDenomState, denomSum } from '@/components/dayClose/shared'

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminDayClose() {
  const [summary, setSummary]               = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [history, setHistory]               = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [expandedId, setExpandedId]         = useState(null)
  const [floatModalOpen, setFloatModalOpen] = useState(false)
  const [tab, setTab] = useState('fecho') // 'fecho' | 'hopper' | 'historico'
  const [refillOpen, setRefillOpen] = useState(false)
  const [emptying, setEmptying] = useState(false)
  async function emptyHopper() {
    if (!window.confirm('Vão cair TODAS as moedas do hopper para a bandeja do troco. Já tem um recipiente por baixo? Pode demorar alguns minutos.')) return
    setEmptying(true)
    try {
      const r = await api.emptyHopper()
      toast({ title: r.dispensed > 0 ? `Hopper esvaziado: saíram ${fmt(r.dispensed)}€` : 'Não saiu nenhuma moeda', description: r.error || undefined, variant: r.dispensed > 0 ? 'success' : 'destructive' })
    } catch (err) {
      toast({ title: err?.body?.error || 'Erro ao esvaziar o hopper', variant: 'destructive' })
    } finally { setEmptying(false) }
  }

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
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setFloatModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-semibold px-3 py-1.5 transition"
          >
            <PiggyBank className="w-3.5 h-3.5" strokeWidth={1.8} />
            Adicionar fundo inicial
          </button>
          {summary && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Sessao ativa
            </span>
          )}
        </div>
      </div>

      <HopperRefillModal open={refillOpen} onClose={() => setRefillOpen(false)} onSubmit={(p) => api.refillHopper(p)} onDone={() => { setRefillOpen(false); loadSummary(); loadHistory() }} />

      <AddFloatModal
        open={floatModalOpen}
        onClose={() => setFloatModalOpen(false)}
        onAdded={() => { setFloatModalOpen(false); loadSummary(); loadHistory() }}
      />

      {/* the three areas of the day close */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[['fecho', 'Fecho'], ['hopper', 'Hopper e reforço'], ['historico', 'Histórico de fechos']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-xl border whitespace-nowrap transition-colors ${tab === id ? 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800 hover:border-emerald-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'hopper' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
          <p className="text-sm text-emerald-900">Reforço: moedas que traz de fora para o hopper (por exemplo, acabaram as de 1€). Sobe o stock do hopper e entra como fundo, nunca como venda.</p>
          <button type="button" onClick={() => setRefillOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 text-white text-sm font-semibold px-4 py-2 shadow-sm">
            <PiggyBank className="w-4 h-4" strokeWidth={1.8} /> Fazer reforço
          </button>
          <button type="button" disabled={emptying} onClick={emptyHopper} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-white text-rose-700 text-sm font-semibold px-4 py-2 shadow-sm disabled:opacity-60">
            <Trash2 className="w-4 h-4" strokeWidth={1.8} /> {emptying ? 'A esvaziar…' : 'Esvaziar hopper'}
          </button>
        </div>
      )}

      <DayCloseForm
        view={tab === 'hopper' ? 'hopper' : 'fecho'}
        hidden={tab === 'historico'}
        summary={summary}
        summaryLoading={summaryLoading}
        onSubmit={(payload) => api.createDayClose(payload)}
        onClosed={() => { loadSummary(); loadHistory() }}
        onEmail={(id, email) => api.emailDayCloseReceipt(id, email)}
      />

      {/* ── History ─────────────────────────────────────────────────────── */}
      <div className={`bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden ${tab === 'historico' ? '' : 'hidden'}`}>
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
                      ) : dc.source === 'adjustment' ? (
                        <span className="rounded-full bg-violet-50 text-violet-600 font-semibold px-2 py-0.5">Fundo adicionado</span>
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

// Seeds/tops up the float directly (e.g. "50€ as 10× 2€ coins") without it
// ever passing through the bank split — see createFloatAdjustment on the
// backend for why this is a distinct action from a real close.
function AddFloatModal({ open, onClose, onAdded }) {
  const [denoms, setDenoms] = useState(() => buildDenomState(ALL_CASH_DENOMS))
  const [notes, setNotes]   = useState('')
  const [saving, setSaving] = useState(false)
  const total = denomSum(denoms)

  useEffect(() => {
    if (open) { setDenoms(buildDenomState(ALL_CASH_DENOMS)); setNotes('') }
  }, [open])

  function updateCount(i, rawVal) {
    const count = Math.max(0, parseInt(rawVal, 10) || 0)
    setDenoms(prev => prev.map((d, idx) => idx === i ? { ...d, count } : d))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (total <= 0) return toast({ title: 'Indique pelo menos uma moeda ou nota', variant: 'destructive' })
    setSaving(true)
    try {
      await api.addDayCloseFloat({
        denominations: denoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        notes
      })
      toast({ title: `Fundo de ${fmt(total)}€ adicionado` })
      onAdded()
    } catch (err) {
      console.error(err)
      toast({ title: err?.body?.error || 'Erro ao adicionar fundo', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Reforço / fundo">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <h3 className="font-semibold text-sm text-neutral-800">Reforço / fundo</h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            Conte as moedas/notas que vai colocar na caixa. Este valor entra como fundo — nunca como venda a depositar no banco.
          </p>
        </div>
        <CoinChipGrid denoms={denoms} onChange={updateCount} />
        <div className="flex items-center justify-between rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-3 text-sm">
          <span className="text-neutral-500">Total a adicionar</span>
          <span className="text-xl font-extrabold text-neutral-800">{fmt(total)}&euro;</span>
        </div>
        <textarea
          className="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-400 text-neutral-700 placeholder-neutral-300"
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Observacoes opcionais..."
          maxLength={400}
        />
        <button
          type="submit"
          disabled={saving || total <= 0}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white font-semibold py-3 text-sm transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {saving ? 'A guardar...' : `Adicionar ${fmt(total)}€ ao fundo`}
        </button>
      </form>
    </Modal>
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

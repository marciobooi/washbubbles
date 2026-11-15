import React, { useEffect, useState, useCallback } from 'react'
import { shopDateTime } from '@/lib/shopTime'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import Modal from '@/components/ui/Modal'
import { PiggyBank, Trash2, Undo2, Mail, Eye } from 'lucide-react'
import DayCloseForm from '@/components/dayClose/DayCloseForm'
import HopperRefillModal from '@/components/dayClose/HopperRefillModal'
import CashExchangeModal from '@/components/dayClose/CashExchangeModal'
import CashWithdrawModal from '@/components/dayClose/CashWithdrawModal'
import { fmt, fmtDenomLabel, DiscrepancyPill, ALL_CASH_DENOMS, CoinChipGrid, buildDenomState, denomSum } from '@/components/dayClose/shared'

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminDayClose() {
  const [summary, setSummary]               = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [history, setHistory]               = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [expandedId, setExpandedId]         = useState(null)
  const [mailingId, setMailingId]           = useState(null)
  const [preview, setPreview]               = useState(null) // { html, subject } of the report being looked at
  const [previewingId, setPreviewingId]     = useState(null)

  async function showReport(dc) {
    setPreviewingId(dc._id)
    try { setPreview(await api.getDayCloseReport(dc._id)) } catch (e) {
      toast({ title: 'Não foi possível abrir o relatório', description: e?.body?.error || e?.message, variant: 'destructive' })
    } finally { setPreviewingId(null) }
  }

  // The envelope of a close in the history: the report again, to the shop's alerts/support e-mail (asked for when there is none).
  async function resendReport(dc) {
    setMailingId(dc._id)
    try {
      let r
      try { r = await api.emailDayCloseReceipt(dc._id, '') } catch (e) {
        if (e?.body?.code !== 'no-recipient') throw e
        const to = window.prompt('Não há email de alertas nas Definições. Enviar o relatório para que email?')
        if (!to) return
        r = await api.emailDayCloseReceipt(dc._id, to.trim())
      }
      toast({ title: 'Relatório enviado', description: r?.to || '', variant: 'success' })
    } catch (e) {
      toast({ title: 'Erro ao enviar', description: e?.body?.error || e?.message, variant: 'destructive' })
    } finally {
      setMailingId(null)
    }
  }
  const [floatModalOpen, setFloatModalOpen] = useState(false)
  const [tab, setTab] = useState('fecho') // 'fecho' | 'hopper' | 'historico'
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [exchangeOpen, setExchangeOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [emptying, setEmptying] = useState(false)
  async function emptyHopper() {
    if (!window.confirm('Vão cair TODAS as moedas do hopper para a bandeja do troco. Já tem um recipiente por baixo? Pode demorar alguns minutos.')) return
    setEmptying(true)
    try {
      let r = await api.emptyHopper()
      if (r.queued) {
        // Asked of the shop PC through the central server: wait for its answer (it can take minutes with a full hopper).
        toast({ title: 'Pedido enviado à loja', description: 'As moedas vão começar a cair dentro de segundos.' })
        const id = r.commandIds?.[0]
        r = { dispensed: 0, error: 'A loja não respondeu a tempo. Veja se o PC está ligado.' }
        for (let i = 0; i < 240; i++) {
          await new Promise((ok) => setTimeout(ok, 3000))
          const c = await api.adminCommand(id).catch(() => null)
          if (c?.status === 'done') { r = c.result || { dispensed: 0 }; break }
          if (c?.status === 'failed') { r = { dispensed: 0, error: c.error }; break }
        }
      }
      toast({ title: r.dispensed > 0 ? `Hopper esvaziado: saíram ${fmt(r.dispensed)}€` : 'Não saiu nenhuma moeda', description: r.error || (r.dispensed > 0 ? 'Conte as moedas que caíram. Depois de as pôr no hopper, use «Repor».' : undefined), variant: r.dispensed > 0 ? 'success' : 'destructive' })
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
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      {/* The report of a close, as the e-mail shows it: nothing is sent */}
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.subject || 'Relatório do fecho'} maxWidth="900px">
        {preview && (
          <iframe title="Relatório do fecho" srcDoc={preview.html} sandbox="" className="w-full rounded-lg border border-neutral-200" style={{ height: '78vh' }} />
        )}
      </Modal>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-heading font-bold text-neutral-800">Fecho de Caixa</h1>
          {summary && !summaryLoading && (
            <p className="text-xs text-neutral-400 mt-0.5">
              Sessao desde {shopDateTime(summary.periodFrom)}
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
            Adicionar fundo de caixa
          </button>
          <button
            type="button"
            onClick={() => setExchangeOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-semibold px-3 py-1.5 transition"
          >
            Troca de notas por moedas
          </button>
          <button
            type="button"
            onClick={() => setWithdrawOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-semibold px-3 py-1.5 transition"
          >
            Levantamento
          </button>
          {summary && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Sessao ativa
            </span>
          )}
        </div>
      </div>

      <CashExchangeModal open={exchangeOpen} onClose={() => setExchangeOpen(false)} onSubmit={(p) => api.exchangeCash(p)} onDone={() => { setExchangeOpen(false); loadSummary(); loadHistory() }} />
      <HopperRefillModal mode="restore" open={restoreOpen} onClose={() => setRestoreOpen(false)} onSubmit={(p) => api.restoreHopper(p)} onDone={() => { setRestoreOpen(false); loadSummary() }} />

      <CashWithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} expectedCash={summary?.expectedCash} onSubmit={(p) => api.withdrawCash(p)} onDone={() => { setWithdrawOpen(false); loadSummary(); loadHistory() }} />

      <AddFloatModal
        open={floatModalOpen}
        onClose={() => setFloatModalOpen(false)}
        onAdded={() => { setFloatModalOpen(false); loadSummary(); loadHistory() }}
      />

      {/* the three areas of the day close */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[['fecho', 'Fecho'], ['hopper', 'Hopper'], ['historico', 'Histórico de fechos']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-full border whitespace-nowrap transition-colors ${tab === id ? 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800 hover:border-emerald-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'hopper' && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50/60 px-4 py-3">
            <p className="text-sm text-sky-900"><b>Repor</b>: volta a pôr no hopper as mesmas moedas que tirou para contar. O dinheiro não muda, só fica registado o que o hopper tem. Para dinheiro novo, use «Adicionar fundo de caixa» (no topo).</p>
            <button type="button" onClick={() => setRestoreOpen(true)} className="abtn abtn-primary"><Undo2 /> Repor (moedas de volta)</button>
          </div>
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/60 px-4 py-3">
            <p className="text-sm text-rose-900"><b>Esvaziar</b>: o hopper larga todas as moedas no tabuleiro, para as contar. Ponha um recipiente por baixo. Mostra quantas saíram.</p>
            <button type="button" disabled={emptying} onClick={emptyHopper} className="abtn abtn-danger"><Trash2 /> {emptying ? 'A esvaziar…' : 'Esvaziar hopper'}</button>
          </div>
        </div>
      )}

      <DayCloseForm
        view={tab === 'hopper' ? 'hopper' : 'fecho'}
        hidden={tab === 'historico'}
        summary={summary}
        summaryLoading={summaryLoading}
        onSubmit={(payload) => api.createDayClose(payload)}
        onPayoutCoins={(amount) => api.payoutBankCoins({ amount })}
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
                  <div className="flex items-stretch">
                  <button
                    type="button"
                    className={`flex-1 min-w-0 text-left px-5 py-4 hover:bg-neutral-50 transition flex flex-wrap items-center gap-x-5 gap-y-1 ${dc.voided ? 'opacity-50 line-through' : ''}`}
                    onClick={() => setExpandedId(prev => prev === dc._id ? null : dc._id)}
                  >
                    <div className="text-xs text-neutral-400 w-32 shrink-0">
                      {shopDateTime(dc.createdAt, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs text-neutral-500">Esperado <strong className="text-neutral-700">{fmt(dc.expectedCash ?? (Number(dc.openingFloat||0)+Number(dc.totalCash||0)))}&euro;</strong></span>
                      <span className="text-xs text-neutral-500">Contado <strong className="text-neutral-700">{fmt(dc.countedCash)}&euro;</strong></span>
                      {dc.voided ? <span className="rounded-full bg-neutral-200 text-neutral-600 font-semibold px-2 py-0.5 text-xs" title={dc.voidedReason || ''}>Anulado</span> : <DiscrepancyPill value={disc} />}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      <span className="rounded-full bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-0.5">
                        Banco {fmt(dc.amountToBank)}&euro;
                      </span>
                      <span className="text-neutral-400">{dc.closedByUsername || 'admin'}</span>
                      {dc.source === 'kiosk' ? (
                        <span className="rounded-full bg-blue-50 text-blue-600 font-semibold px-2 py-0.5">Quiosque (auto)</span>
                      ) : dc.source === 'adjustment' ? (
                        dc.metadata?.withdrawalAmount > 0
                          ? <span className="rounded-full bg-amber-50 text-amber-700 font-semibold px-2 py-0.5">Levantamento -{fmt(dc.metadata.withdrawalAmount)}&euro;</span>
                          : dc.metadata?.exchange
                            ? <span className="rounded-full bg-sky-50 text-sky-700 font-semibold px-2 py-0.5">Troca de notas por moedas {fmt(dc.metadata.exchange.total)}&euro;</span>
                            : <span className="rounded-full bg-violet-50 text-violet-600 font-semibold px-2 py-0.5">Fundo adicionado</span>
                      ) : null}
                      <span className={`text-primary-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>&#9660;</span>
                    </div>
                  </button>
                  {(dc.source === 'dashboard' || dc.source === 'kiosk') && !dc.voided && (
                    <button
                      type="button"
                      onClick={() => showReport(dc)}
                      disabled={previewingId === dc._id}
                      title="Ver o relatório deste fecho"
                      aria-label="Ver o relatório deste fecho"
                      className="shrink-0 px-3 text-neutral-400 hover:text-primary-600 hover:bg-neutral-50 transition disabled:opacity-40"
                    >
                      <Eye className={`h-4 w-4 ${previewingId === dc._id ? 'animate-pulse' : ''}`} />
                    </button>
                  )}
                  {(dc.source === 'dashboard' || dc.source === 'kiosk') && !dc.voided && (
                    <button
                      type="button"
                      onClick={() => resendReport(dc)}
                      disabled={mailingId === dc._id}
                      title="Enviar o relatório deste fecho por email"
                      aria-label="Enviar o relatório deste fecho por email"
                      className="shrink-0 px-4 text-neutral-400 hover:text-primary-600 hover:bg-neutral-50 transition disabled:opacity-40"
                    >
                      <Mail className={`h-4 w-4 ${mailingId === dc._id ? 'animate-pulse' : ''}`} />
                    </button>
                  )}
                  </div>
                  {/* Expanded detail */}
                  {isOpen && (
                    <div className="bg-neutral-50 border-t border-neutral-100 px-5 py-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 text-xs">
                        <DetailBlock title="Periodo">
                          <InfoRow label="Inicio" value={dc.periodFrom ? shopDateTime(dc.periodFrom) : '-'} />
                          <InfoRow label="Fim" value={shopDateTime(dc.periodTo || dc.createdAt)} />
                          <InfoRow label="Vendas" value={`${fmt(dc.totalSales)}€ (${fmt(dc.totalCash)} din${Number(dc.totalMbway) > 0 ? ` + ${fmt(dc.totalMbway)} MB WAY` : ''} + ${fmt(dc.totalCard)} cart)`} />
                          <InfoRow label="Fundo de caixa" value={`${fmt(Number(dc.openingFloat || 0) + Number(dc.floatAdded || 0))}€`} />
                          {Number(dc.floatAdded) > 0 && <InfoRow label="dos quais fundo adicionado" value={`${fmt(dc.floatAdded)}€`} />}
                          {Number(dc.floatWithdrawn) > 0 && <InfoRow label="Levantamentos" value={`-${fmt(dc.floatWithdrawn)}€`} />}
                          {dc.totalChangeDispensed > 0 && <InfoRow label="Troco dispensado" value={`${fmt(dc.totalChangeDispensed)}€`} />}
                        </DetailBlock>
                        <DetailBlock title="Reconciliacao">
                          <InfoRow label="Esperado" value={`${fmt(dc.expectedCash ?? (Number(dc.openingFloat||0)+Number(dc.totalCash||0)+Number(dc.floatAdded||0)-Number(dc.floatWithdrawn||0)))}€`} />
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
    <Modal open={open} onClose={onClose} title="Adicionar fundo de caixa">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <h3 className="font-semibold text-sm text-neutral-800">Adicionar fundo de caixa</h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            Dinheiro novo que vai pôr na caixa: conte as moedas e as notas. Entra como fundo de caixa, nunca como venda a depositar no banco. (Se são as mesmas moedas que tirou do hopper para contar, use «Repor» no separador Hopper.)
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

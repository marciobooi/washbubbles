import React, { useEffect, useState, useCallback } from 'react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import DayCloseForm from '@/components/dayClose/DayCloseForm'
import HopperRefillModal from '@/components/dayClose/HopperRefillModal'
import CashWithdrawModal from '@/components/dayClose/CashWithdrawModal'
import CashExchangeModal from '@/components/dayClose/CashExchangeModal'

function getKioskApiKey() {
  const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
  return electronKey || (typeof localStorage !== 'undefined' ? localStorage.getItem('kiosk_api_key') : null) || import.meta.env.VITE_KIOSK_API_KEY
}

/**
 * The cash-reconciliation wizard, running on the kiosk itself.
 *
 * `pin` is the staff PIN already verified to reach this screen (see
 * StaffMenu) — reused here rather than asked a second time, since the server
 * independently re-checks it on submit (`routes/pos.js` — a kiosk apiKey alone
 * is not trusted for writing a financial record).
 *
 * Does NOT engage the global kiosk lock: that full-screen "enter PIN to
 * unlock" overlay is for staff having stepped AWAY from the kiosk with no
 * screen of their own open. Here staff are actively present, working inside
 * this very modal — engaging the lock would render the "screen locked"
 * overlay on top of the wizard they just opened. This modal's own backdrop
 * already blocks the background while it's open, same as any other modal.
 */
export default function KioskDayCloseModal({ open, onClose, pin }) {
  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [tab, setTab] = useState('fecho') // 'fecho' | 'hopper'
  const [refillOpen, setRefillOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [exchangeOpen, setExchangeOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [emptying, setEmptying] = useState(false)

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      setSummary(await api.getKioskDayCloseSummary({ apiKey: getKioskApiKey(), pin }))
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar resumo — verifique a ligação', variant: 'destructive' })
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    loadSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function emptyHopper() {
    if (!window.confirm('Vão cair TODAS as moedas do hopper para o tabuleiro do troco, à frente do quiosque. Já tem um recipiente por baixo? Pode demorar alguns minutos.')) return
    setEmptying(true)
    try {
      const r = await api.emptyKioskHopper({ pin }, { apiKey: getKioskApiKey() })
      const out = Number(r?.dispensed || 0)
      toast({ title: out > 0 ? `Hopper esvaziado: saíram ${out.toFixed(2)}€` : 'Não saiu nenhuma moeda', description: r?.error || (out > 0 ? 'Conte as moedas que caíram. Depois de as pôr no hopper, use «Repor».' : undefined), variant: out > 0 ? 'success' : 'destructive' })
      loadSummary()
    } catch (err) {
      toast({ title: err?.body?.error || 'Erro ao esvaziar o hopper', variant: 'destructive' })
    } finally { setEmptying(false) }
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="Fecho de Caixa" maxWidth="min(72vw, 860px)">
      <div className="flex gap-2 mb-4 pr-14">
        {[['fecho', 'Fecho'], ['hopper', 'Hopper']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`h-12 px-6 text-base font-semibold rounded-xl border transition-colors ${tab === id ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-white border-slate-200 text-slate-500'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'fecho' && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button type="button" onClick={() => setWithdrawOpen(true)} className="h-12 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold text-base active:scale-[0.99]">
            Registar levantamento de dinheiro
          </button>
          <button type="button" onClick={() => setExchangeOpen(true)} className="h-12 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold text-base active:scale-[0.99]">
            Troca de notas por moedas
          </button>
        </div>
      )}
      {tab === 'hopper' && (
        <div className="grid gap-3 mb-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <p className="text-sm text-emerald-900 mb-2"><b>Adicionar fundo de caixa</b>: moedas novas que traz de fora. O fundo de caixa sobe esse valor.</p>
            <button type="button" onClick={() => setRefillOpen(true)} className="w-full h-12 rounded-xl bg-emerald-600 text-white font-bold text-base shadow-sm active:scale-[0.99]">Adicionar fundo de caixa (moedas)</button>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3">
            <p className="text-sm text-sky-900 mb-2"><b>Repor</b>: volta a pôr no hopper as mesmas moedas que tirou para contar. O dinheiro não muda, só fica registado o que o hopper tem.</p>
            <button type="button" onClick={() => setRestoreOpen(true)} className="w-full h-12 rounded-xl bg-sky-600 text-white font-bold text-base shadow-sm active:scale-[0.99]">Repor (moedas de volta)</button>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
            <p className="text-sm text-rose-900 mb-2"><b>Esvaziar</b>: o hopper larga todas as moedas no tabuleiro, para as contar. Ponha um recipiente por baixo. Mostra quantas saíram.</p>
            <button type="button" disabled={emptying} onClick={emptyHopper} className="w-full h-12 rounded-xl bg-white border border-rose-300 text-rose-700 font-bold text-base active:scale-[0.99] disabled:opacity-50">{emptying ? 'A esvaziar…' : 'Esvaziar hopper'}</button>
          </div>
        </div>
      )}
      <CashWithdrawModal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} expectedCash={summary?.expectedCash} onSubmit={(p) => api.withdrawKioskCash({ ...p, pin }, { apiKey: getKioskApiKey() })} onDone={() => { setWithdrawOpen(false); loadSummary() }} />
      <CashExchangeModal open={exchangeOpen} onClose={() => setExchangeOpen(false)} onSubmit={(p) => api.exchangeKioskCash({ ...p, pin }, { apiKey: getKioskApiKey() })} onDone={() => { setExchangeOpen(false); loadSummary() }} />
      <HopperRefillModal mode="restore" open={restoreOpen} onClose={() => setRestoreOpen(false)} onSubmit={(p) => api.restoreKioskHopper({ ...p, pin }, { apiKey: getKioskApiKey() })} onDone={() => { setRestoreOpen(false); loadSummary() }} />
      <HopperRefillModal open={refillOpen} onClose={() => setRefillOpen(false)} onSubmit={(p) => api.refillKioskHopper({ ...p, pin }, { apiKey: getKioskApiKey() })} onDone={() => { setRefillOpen(false); loadSummary() }} />
      <DayCloseForm
        view={tab}
        summary={summary}
        summaryLoading={summaryLoading}
        onSubmit={(payload) => api.createKioskDayClose({ ...payload, pin }, { apiKey: getKioskApiKey() })}
        onPayoutCoins={(amount) => api.payoutBankCoinsKiosk({ amount, pin }, { apiKey: getKioskApiKey() })}
        onClosed={() => { loadSummary() }}
        onEmail={(id, email) => api.emailKioskDayCloseReceipt(id, email, { apiKey: getKioskApiKey(), pin })}
        onDone={onClose}
      />
    </Modal>
  )
}

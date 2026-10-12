import React, { useEffect, useState, useCallback } from 'react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import DayCloseForm from '@/components/dayClose/DayCloseForm'
import HopperRefillModal from '@/components/dayClose/HopperRefillModal'

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

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      setSummary(await api.getKioskDayCloseSummary({ apiKey: getKioskApiKey() }))
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
      {tab === 'hopper' && (
        <button type="button" onClick={() => setRefillOpen(true)} className="w-full h-14 mb-4 rounded-xl bg-emerald-600 text-white font-bold text-lg shadow-sm active:scale-[0.99]">
          Fazer reforço do hopper
        </button>
      )}
      <HopperRefillModal open={refillOpen} onClose={() => setRefillOpen(false)} onSubmit={(p) => api.refillKioskHopper({ ...p, pin }, { apiKey: getKioskApiKey() })} onDone={() => { setRefillOpen(false); loadSummary() }} />
      <DayCloseForm
        view={tab}
        summary={summary}
        summaryLoading={summaryLoading}
        onSubmit={(payload) => api.createKioskDayClose({ ...payload, pin }, { apiKey: getKioskApiKey() })}
        onClosed={() => { loadSummary() }}
        onEmail={(id, email) => api.emailKioskDayCloseReceipt(id, email, { apiKey: getKioskApiKey() })}
        onDone={onClose}
      />
    </Modal>
  )
}

import React, { useEffect, useState, useCallback } from 'react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import DayCloseForm from '@/components/dayClose/DayCloseForm'

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
    <Modal open={open} onClose={onClose} title="Fecho de Caixa">
      <DayCloseForm
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

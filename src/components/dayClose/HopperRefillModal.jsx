import React, { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { COIN_DENOMS, CoinChipGrid, buildDenomState, denomSum, fmt, fmtDenomLabel } from './shared'

/** Coins brought from outside into the hopper. `onSubmit({ coins, notes })` talks to the right endpoint. */
export default function HopperRefillModal({ open, onClose, onSubmit, onDone }) {
  const [denoms, setDenoms] = useState(() => buildDenomState(COIN_DENOMS))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const total = denomSum(denoms)

  useEffect(() => { if (open) { setDenoms(buildDenomState(COIN_DENOMS)); setNotes('') } }, [open])

  async function submit(e) {
    e.preventDefault()
    if (total <= 0) return toast({ title: 'Indique pelo menos uma moeda', variant: 'destructive' })
    setSaving(true)
    try {
      const r = await onSubmit({ coins: denoms.filter((d) => d.count > 0).map((d) => ({ value: d.value, count: d.count })), notes })
      const missing = r?.noHopper || []
      toast({
        title: `Reforço de ${fmt(total)}€ registado`,
        description: missing.length ? `Sem hopper configurado para: ${missing.map((m) => fmtDenomLabel(m.value)).join(', ')} (entrou só no fundo)` : 'O stock do hopper foi atualizado.',
        variant: missing.length ? 'warning' : 'success',
      })
      onDone && onDone(r)
    } catch (err) {
      toast({ title: err?.body?.error || 'Erro ao registar o reforço', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Reforço do hopper" maxWidth="min(72vw, 760px)">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h3 className="font-bold text-lg text-neutral-900">Reforço do hopper</h3>
          <p className="text-sm text-neutral-500 mt-0.5">Conte as moedas que vai colocar. Entram no stock do hopper e no fundo (nunca como venda).</p>
        </div>
        <CoinChipGrid denoms={denoms} onChange={(i, raw) => setDenoms((p) => p.map((d, k) => (k === i ? { ...d, count: Math.max(0, parseInt(raw, 10) || 0) } : d)))} />
        <div className="flex items-center justify-between rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-3">
          <span className="text-neutral-500">Total do reforço</span>
          <span className="text-2xl font-extrabold text-neutral-800">{fmt(total)}&euro;</span>
        </div>
        <textarea className="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm resize-none" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações (opcional)" maxLength={300} />
        <button type="submit" disabled={saving || total <= 0} className="w-full h-14 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-bold text-base shadow-sm disabled:opacity-50">
          {saving ? 'A registar...' : `Registar reforço de ${fmt(total)}€`}
        </button>
      </form>
    </Modal>
  )
}

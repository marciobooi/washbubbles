import React, { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { fmt } from './shared'

/**
 * Cash taken out of the machine between closes (to the bank, to the owner). `onSubmit({ amount, notes })` talks to the right
 * endpoint. It is not a close: it only lowers what the next count expects, so the expected cash follows what is really inside.
 */
export default function CashWithdrawModal({ open, onClose, onSubmit, onDone, expectedCash }) {
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const value = Number(String(amount).replace(',', '.'))

  useEffect(() => { if (open) { setAmount(''); setNotes('') } }, [open])

  async function submit(e) {
    e.preventDefault()
    if (!(value > 0)) return toast({ title: 'Indique o valor que retirou', variant: 'destructive' })
    setSaving(true)
    try {
      const r = await onSubmit({ amount: Math.round(value * 100) / 100, notes })
      toast({ title: `Levantamento de ${fmt(value)}€ registado`, description: `Esperado em caixa agora: ${fmt(r?.expectedCash ?? 0)}€`, variant: 'success' })
      onDone && onDone(r)
    } catch (err) {
      toast({ title: err?.body?.error || 'Erro ao registar o levantamento', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Levantamento" maxWidth="min(72vw, 560px)">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h3 className="font-bold text-lg text-neutral-900">Levantamento de dinheiro</h3>
          <p className="text-sm text-neutral-500 mt-0.5">
            Registe o dinheiro que retirou da máquina. Não é um fecho: só baixa o valor esperado em caixa
            {expectedCash != null ? ` (agora ${fmt(expectedCash)}€)` : ''}.
          </p>
        </div>
        <label className="block">
          <span className="text-sm text-neutral-600">Valor retirado (€)</span>
          <input
            type="text" inputMode="decimal" autoFocus
            className="mt-1 w-full h-14 rounded-xl border border-neutral-200 px-4 text-2xl font-extrabold text-neutral-800"
            value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0.00"
          />
        </label>
        <textarea className="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm resize-none" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações (opcional): para o banco, para o dono..." />
        <button type="submit" disabled={saving || !(value > 0)} className="w-full h-14 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-bold text-base shadow-sm disabled:opacity-50">
          {saving ? 'A registar...' : `Registar levantamento de ${value > 0 ? fmt(value) : '0.00'}€`}
        </button>
      </form>
    </Modal>
  )
}

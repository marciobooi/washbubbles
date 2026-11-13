import React, { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { COIN_DENOMS, CoinChipGrid, buildDenomState, denomSum, fmt, fmtDenomLabel } from './shared'

/**
 * Two things that look alike and are not (mode):
 *  - 'refill' (Reforço): coins brought from OUTSIDE. They go into the hopper and the cash float goes up by that money.
 *  - 'restore' (Repor): the SAME coins that were taken out of the hopper (to count them) go back in. The money does not change.
 * `onSubmit({ coins, notes })` talks to the right endpoint.
 */
export default function HopperRefillModal({ open, onClose, onSubmit, onDone, mode = 'refill' }) {
  const restore = mode === 'restore'
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
        title: restore ? `Reposição de ${fmt(total)}€ registada` : `Reforço de ${fmt(total)}€ registado`,
        description: restore ? 'O dinheiro não mudou. O hopper abre agora com esta contagem.' : (missing.length ? `Sem hopper configurado para: ${missing.map((m) => fmtDenomLabel(m.value)).join(', ')} (entrou só no fundo)` : 'O stock do hopper foi atualizado.'),
        variant: !restore && missing.length ? 'warning' : 'success',
      })
      onDone && onDone(r)
    } catch (err) {
      toast({ title: err?.body?.error || (restore ? 'Erro ao registar a reposição' : 'Erro ao registar o reforço'), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={restore ? 'Repor moedas no hopper' : 'Reforço do hopper'} maxWidth="min(72vw, 760px)">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h3 className="font-bold text-lg text-neutral-900">{restore ? 'Repor moedas no hopper' : 'Reforço do hopper'}</h3>
          <p className="text-sm text-neutral-500 mt-0.5">{restore
            ? 'Use depois de esvaziar o hopper para contar. Escreva as moedas que vai voltar a pôr lá dentro. São as mesmas que já estão no fundo de caixa: o dinheiro não muda, só fica registado o que o hopper tem.'
            : 'Use quando traz moedas novas de fora (por exemplo, acabaram as de 1€). Conte as que vai pôr. O fundo de caixa sobe esse valor (nunca conta como venda).'}</p>
        </div>
        <CoinChipGrid denoms={denoms} onChange={(i, raw) => setDenoms((p) => p.map((d, k) => (k === i ? { ...d, count: Math.max(0, parseInt(raw, 10) || 0) } : d)))} />
        <div className="flex items-center justify-between rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-3">
          <span className="text-neutral-500">{restore ? 'Total a repor' : 'Total do reforço'}</span>
          <span className="text-2xl font-extrabold text-neutral-800">{fmt(total)}&euro;</span>
        </div>
        <textarea className="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm resize-none" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações (opcional)" maxLength={300} />
        <button type="submit" disabled={saving || total <= 0} className="w-full h-14 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-bold text-base shadow-sm disabled:opacity-50">
          {saving ? 'A registar...' : restore ? `Registar reposição de ${fmt(total)}€` : `Registar reforço de ${fmt(total)}€`}
        </button>
      </form>
    </Modal>
  )
}

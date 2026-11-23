import React, { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { COIN_DENOMS, BILL_DENOMS, CoinChipGrid, buildDenomState, denomSum, fmt } from './shared'

/**
 * Notes taken out of the box and the SAME amount put in as coins (e.g. 50€ of notes for 25 coins of 2€ for the hopper).
 * No money is added or taken: only what the box holds by kind is kept true. `onSubmit({ notesOut, coinsIn, notes })`.
 */
export default function CashExchangeModal({ open, onClose, onSubmit, onDone }) {
  const [notesOut, setNotesOut] = useState(() => buildDenomState(BILL_DENOMS))
  const [coinsIn, setCoinsIn] = useState(() => buildDenomState(COIN_DENOMS))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const totalOut = denomSum(notesOut)
  const totalIn = denomSum(coinsIn)
  const equal = totalOut > 0 && Math.abs(totalOut - totalIn) < 0.005

  useEffect(() => { if (open) { setNotesOut(buildDenomState(BILL_DENOMS)); setCoinsIn(buildDenomState(COIN_DENOMS)); setNotes('') } }, [open])

  const set = (setter) => (i, raw) => setter((p) => p.map((d, k) => (k === i ? { ...d, count: Math.max(0, parseInt(raw, 10) || 0) } : d)))
  const pick = (arr) => arr.filter((d) => d.count > 0).map((d) => ({ value: d.value, count: d.count }))

  async function submit(e) {
    e.preventDefault()
    if (!equal) return toast({ title: 'Os dois lados têm de ter o mesmo valor', variant: 'destructive' })
    setSaving(true)
    try {
      const r = await onSubmit({ notesOut: pick(notesOut), coinsIn: pick(coinsIn), notes })
      toast({ title: `Troca de ${fmt(totalOut)}€ registada`, description: 'O dinheiro não mudou: só as notas e as moedas da caixa.', variant: 'success' })
      onDone && onDone(r)
    } catch (err) {
      toast({ title: err?.body?.error || 'Erro ao registar a troca', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Troca de notas por moedas" maxWidth="min(72vw, 760px)">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h3 className="font-bold text-lg text-neutral-900">Troca de notas por moedas</h3>
          <p className="text-sm text-neutral-500 mt-0.5">Use quando tira notas da caixa e as troca por moedas (por exemplo para o hopper). Não é dinheiro novo: o fundo de caixa não muda, só as notas e as moedas que a caixa tem.</p>
        </div>
        <div>
          <div className="text-sm font-semibold text-neutral-700 mb-1">Notas que saíram</div>
          <CoinChipGrid denoms={notesOut} onChange={set(setNotesOut)} />
        </div>
        <div>
          <div className="text-sm font-semibold text-neutral-700 mb-1">Moedas que entraram</div>
          <CoinChipGrid denoms={coinsIn} onChange={set(setCoinsIn)} />
        </div>
        <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${equal ? 'bg-emerald-50 border-emerald-200' : 'bg-neutral-50 border-neutral-100'}`}>
          <span className="text-neutral-600">Notas {fmt(totalOut)}€ · Moedas {fmt(totalIn)}€</span>
          <span className={`text-sm font-bold ${equal ? 'text-emerald-700' : 'text-amber-700'}`}>{equal ? 'Valores iguais' : totalOut === 0 && totalIn === 0 ? '' : `Diferença ${fmt(Math.abs(totalOut - totalIn))}€`}</span>
        </div>
        <textarea className="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm resize-none" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações (opcional)" maxLength={300} />
        <button type="submit" disabled={saving || !equal} className="abtn abtn-primary w-full">
          {saving ? 'A registar...' : equal ? `Registar troca de ${fmt(totalOut)}€` : 'Os dois lados têm de ter o mesmo valor'}
        </button>
      </form>
    </Modal>
  )
}

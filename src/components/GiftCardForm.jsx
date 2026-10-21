import React, { useState } from 'react'

/**
 * Form for handing out a gift card: a card for a customer, free of charge, with a starting credit that is ZERO unless
 * staff choose otherwise. Used on the kiosk (behind the staff PIN, credit only) and in the admin (with optional details).
 */
export default function GiftCardForm({ onSubmit, onCancel, busy = false, withDetails = false, maxCredit = 100 }) {
  const [credit, setCredit] = useState(0)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const set = (v) => setCredit(Math.min(maxCredit, Math.max(0, Math.round(v * 100) / 100)))
  const field = 'w-full px-3 py-2 rounded-lg border border-neutral-300'
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">
        O cartão sai do distribuidor sem custo. Depois, coloque-o no leitor para o ativar. Crédito inicial grátis (por defeito 0 €).
      </p>
      <div className="flex items-center justify-center gap-4">
        <button type="button" aria-label="Menos 1 euro" disabled={busy || credit <= 0} onClick={() => set(credit - 1)} className="w-14 h-14 rounded-full border text-3xl font-bold disabled:opacity-40">−</button>
        <div className="text-center min-w-[120px]">
          <div className="text-4xl font-extrabold tabular-nums">{credit.toFixed(2)} €</div>
          <div className="text-xs text-neutral-500">crédito oferecido</div>
        </div>
        <button type="button" aria-label="Mais 1 euro" disabled={busy || credit >= maxCredit} onClick={() => set(credit + 1)} className="w-14 h-14 rounded-full border text-3xl font-bold disabled:opacity-40">+</button>
      </div>
      <div className="flex justify-center gap-2">
        {[0, 5, 10].map((v) => (
          <button key={v} type="button" disabled={busy} onClick={() => set(v)} className={`px-4 py-1.5 rounded-full border text-sm font-semibold ${credit === v ? 'bg-teal-600 text-white border-teal-600' : ''}`}>{v} €</button>
        ))}
      </div>
      {withDetails && (
        <div className="space-y-2">
          <input className={field} placeholder="Nome (opcional)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={field} placeholder="Email (opcional)" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={field} placeholder="Telefone (opcional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="flex-1 py-2 rounded-lg border">Cancelar</button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit({ credit, ...(withDetails ? { customerName: name.trim(), customerEmail: email.trim(), customerPhone: phone.trim() } : {}) })}
          className={`flex-1 py-2 rounded-lg ${busy ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}
        >
          {busy ? 'A emitir…' : 'Emitir cartão'}
        </button>
      </div>
    </div>
  )
}

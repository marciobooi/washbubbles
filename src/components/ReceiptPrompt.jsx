import React, { useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Mail } from 'lucide-react'

/**
 * Small opt-in card offered after a successful (network-settled) payment —
 * not a modal, since most customers won't want to stop and type an email for
 * a €3 wash. Dismissible; never blocks anything else on screen.
 */
export default function ReceiptPrompt({ batchId, kioskKey, onClose }) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)

  if (!batchId) return null

  async function send() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: 'Email inválido', variant: 'destructive' })
      return
    }
    setSending(true)
    try {
      await api.emailReceipt(batchId, email, { apiKey: kioskKey })
      toast({ title: 'Recibo enviado', description: email, variant: 'success' })
      onClose()
    } catch (e) {
      toast({ title: 'Erro ao enviar recibo', description: e?.message, variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 bg-white rounded-xl shadow-2xl border border-neutral-200 p-4 max-w-xs">
      <div className="flex items-center gap-2 text-primary-700 mb-2">
        <Mail className="h-5 w-5" />
        <span className="font-semibold text-sm">Quer o recibo por email?</span>
      </div>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="o.seu@email.com"
          className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded-lg border border-neutral-300"
        />
        <button
          onClick={send}
          disabled={sending}
          className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          {sending ? '...' : 'Enviar'}
        </button>
      </div>
      <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-600 mt-2 underline underline-offset-2">
        Não, obrigado
      </button>
    </div>
  )
}

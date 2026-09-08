import React, { useState } from 'react'
import api from '@/services/api'
import * as localApi from '@/services/local-api'
import { formatReceiptText } from '@/lib/receipt'
import { toast } from '@/components/ui/Toast'
import { Mail, Printer } from 'lucide-react'

/**
 * Small opt-in card offered after a successful payment — not a modal, since
 * most customers won't want to stop and type an email for a €3 wash.
 * Dismissible; never blocks anything else on screen.
 *
 * Print and email are independently available: printing is purely local
 * hardware (works for a locally-settled sale too, no server round trip), so
 * it shows whenever the kiosk has `items` for this sale. Email needs the
 * sale to already exist server-side (the route looks it up by batch), so it
 * only shows when `batchId` came from a network-settled payment.
 */
export default function ReceiptPrompt({ items, batchId, kioskKey, onClose }) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [printing, setPrinting] = useState(false)

  const canPrint = localApi.isElectron && items && items.length > 0
  const canEmail = Boolean(batchId)
  if (!canPrint && !canEmail) return null

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

  async function print() {
    setPrinting(true)
    try {
      const ok = await localApi.printReceipt(formatReceiptText(items))
      if (ok) {
        toast({ title: 'Recibo impresso', variant: 'success' })
        if (!canEmail) onClose()
      } else {
        toast({ title: 'Impressora indisponível', description: 'Verifique a ligação — contacte o balcão.', variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: 'Erro ao imprimir recibo', description: e?.message, variant: 'destructive' })
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 bg-white rounded-xl shadow-2xl border border-neutral-200 p-4 max-w-xs">
      <div className="flex items-center gap-2 text-primary-700 mb-2">
        <Mail className="h-5 w-5" />
        <span className="font-semibold text-sm">Quer o recibo?</span>
      </div>

      {canPrint && (
        <button
          onClick={print}
          disabled={printing}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-sm font-semibold disabled:opacity-50 mb-2"
        >
          <Printer className="h-4 w-4" />
          {printing ? 'A imprimir…' : 'Imprimir'}
        </button>
      )}

      {canEmail && (
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
      )}

      <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-600 mt-2 underline underline-offset-2">
        Não, obrigado
      </button>
    </div>
  )
}

import React, { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import * as localApi from '@/services/local-api'
import { formatDayCloseReceiptText } from '@/lib/receipt'
import { Printer, Mail } from 'lucide-react'
import { fmt } from './shared'

/**
 * Popup offered right after a close (or float top-up) succeeds — print on the
 * kiosk's local thermal printer and/or email a copy of the Z-report summary.
 * Print only shows inside Electron (`localApi.isElectron`); email always does,
 * since the admin dashboard has no local printer to talk to.
 */
export default function DayCloseReceiptModal({ dc, onEmail, onClose }) {
  const [email, setEmail]     = useState('')
  const [sending, setSending] = useState(false)
  const [printing, setPrinting] = useState(false)

  const canPrint = localApi.isElectron

  async function print() {
    setPrinting(true)
    try {
      const ok = await localApi.printReceipt(formatDayCloseReceiptText(dc))
      toast(ok
        ? { title: 'Recibo impresso', variant: 'success' }
        : { title: 'Impressora indisponível', description: 'Verifique a ligação.', variant: 'destructive' })
    } catch (e) {
      toast({ title: 'Erro ao imprimir', description: e?.message, variant: 'destructive' })
    } finally {
      setPrinting(false)
    }
  }

  async function send() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: 'Email inválido', variant: 'destructive' })
      return
    }
    setSending(true)
    try {
      await onEmail(dc._id, email)
      toast({ title: 'Resumo enviado', description: email, variant: 'success' })
      setEmail('')
    } catch (e) {
      toast({ title: 'Erro ao enviar', description: e?.body?.error || e?.message, variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  if (!dc) return null

  return (
    <Modal open={Boolean(dc)} onClose={onClose} title="Fecho concluído">
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold text-sm text-neutral-800">Sessão fechada com sucesso</h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            Contado {fmt(dc.countedCash)}&euro; &middot; Banco {fmt(dc.amountToBank)}&euro; &middot; Fundo {fmt(dc.floatLeft)}&euro;
          </p>
        </div>

        {canPrint && (
          <button
            type="button"
            onClick={print}
            disabled={printing}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-sm font-semibold text-neutral-700 disabled:opacity-50 transition"
          >
            <Printer className="h-4 w-4" />
            {printing ? 'A imprimir…' : 'Imprimir recibo'}
          </button>
        )}

        <div>
          <label className="block text-xs font-semibold text-neutral-600 mb-1.5">Enviar por email</label>
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
              className="flex-1 min-w-0 px-3 py-2 text-sm rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5 transition"
            >
              <Mail className="h-3.5 w-3.5" />
              {sending ? '...' : 'Enviar'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-2"
        >
          Fechar
        </button>
      </div>
    </Modal>
  )
}

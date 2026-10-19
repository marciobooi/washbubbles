import React, { useState, useEffect } from 'react'
import api from '@/services/api'
import * as localApi from '@/services/local-api'
import { formatReceiptText } from '@/lib/receipt'
import { toast } from '@/components/ui/Toast'
import { Mail, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
export default function ReceiptPrompt({ items, batchId, kioskKey, onClose, onHold }) {
  const { t } = useTranslation('cart')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [focused, setFocused] = useState(false)
  // The countdown that closes this popup (in App) stops while the customer is typing, or a send / print is running.
  const busy = focused || email.length > 0 || sending || printing
  useEffect(() => { onHold?.(busy) }, [busy])
  useEffect(() => () => onHold?.(false), [])

  const canPrint = localApi.isElectron && items && items.length > 0
  const canEmail = Boolean(batchId)
  if (!canPrint && !canEmail) return null

  async function send() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: t('rcInvalidEmail'), variant: 'destructive' })
      return
    }
    setSending(true)
    try {
      await api.emailReceipt(batchId, email, { apiKey: kioskKey })
      toast({ title: t('rcSent'), description: email, variant: 'success' })
      onClose()
    } catch (e) {
      toast({ title: t('rcSendError'), description: e?.message, variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  async function print() {
    setPrinting(true)
    try {
      const ok = await localApi.printReceipt(formatReceiptText(items))
      if (ok) {
        toast({ title: t('rcPrinted'), variant: 'success' })
        if (!canEmail) onClose()
      } else {
        toast({ title: t('rcPrinterDown'), description: t('rcPrinterDownHint'), variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: t('rcPrintError'), description: e?.message, variant: 'destructive' })
    } finally {
      setPrinting(false)
    }
  }

  return (
    // While the email is being typed the on-screen keyboard covers the bottom of the screen: the card moves to the top, big,
    // so what is typed stays in view.
    <div className={busy
      ? "fixed top-28 left-1/2 -translate-x-1/2 z-[70] w-[min(90vw,760px)] bg-white rounded-2xl shadow-2xl border border-neutral-200 p-6"
      : "fixed bottom-4 right-4 z-40 bg-white rounded-xl shadow-2xl border border-neutral-200 p-4 max-w-xs"}>
      <div className="flex items-center gap-2 text-primary-700 mb-2">
        <Mail className="h-5 w-5" />
        <span className="font-semibold text-sm">{t('rcWant')}</span>
      </div>

      {canPrint && (
        <button
          onClick={print}
          disabled={printing}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-sm font-semibold disabled:opacity-50 mb-2"
        >
          <Printer className="h-4 w-4" />
          {printing ? t('rcPrinting') : t('rcPrint')}
        </button>
      )}

      {canEmail && (
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="o.seu@email.com"
            className={busy ? "flex-1 min-w-0 px-4 py-3 text-2xl rounded-xl border-2 border-primary-400" : "flex-1 min-w-0 px-2 py-1.5 text-sm rounded-lg border border-neutral-300"}
          />
          <button
            onClick={send}
            disabled={sending}
            className={busy ? "px-6 py-3 rounded-xl bg-primary-600 text-white text-2xl font-semibold disabled:opacity-50" : "px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-50"}
          >
            {sending ? '...' : t('rcSend')}
          </button>
        </div>
      )}

      <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-600 mt-2 underline underline-offset-2">
        {t('rcNoThanks')}
      </button>
    </div>
  )
}

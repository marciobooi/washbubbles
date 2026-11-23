import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MessageCircle } from 'lucide-react'

export default function WhatsAppTab() {
  const [whatsappEnabled, setWhatsappEnabled] = useState(false)
  const [savingWhatsappToggle, setSavingWhatsappToggle] = useState(false)
  const [whatsappStatus, setWhatsappStatus] = useState({ connected: false, qr: null })
  const [disconnectingWhatsapp, setDisconnectingWhatsapp] = useState(false)

  async function loadWhatsappSettings() {
    try {
      const enabled = await api.getSetting('whatsapp.enabled').catch(() => null)
      setWhatsappEnabled(Boolean(enabled && enabled.value))
    } catch (e) { console.warn('loadWhatsappSettings failed', e) }
  }

  useEffect(() => { loadWhatsappSettings() }, [])

  // While WhatsApp is enabled but not yet connected, poll for the QR code /
  // connection state — same "poll a status endpoint while pairing" idea the
  // toggle itself relies on to reflect what the backend's Baileys socket is
  // actually doing (a live connection, not something this page controls
  // directly). Runs while this tab is active.
  useEffect(() => {
    if (!whatsappEnabled) return
    let cancelled = false
    async function poll() {
      try {
        const s = await api.getWhatsappStatus()
        if (!cancelled) setWhatsappStatus(s)
      } catch (e) { /* transient — next poll retries */ }
    }
    poll()
    const id = setInterval(poll, 4000)
    return () => { cancelled = true; clearInterval(id) }
  }, [whatsappEnabled])

  async function toggleWhatsappEnabled(nextEnabled) {
    setSavingWhatsappToggle(true)
    setWhatsappEnabled(nextEnabled)
    try {
      await api.setSetting({ key: 'whatsapp.enabled', value: nextEnabled })
      toast({ title: nextEnabled ? 'WhatsApp ativado' : 'WhatsApp desativado', variant: 'success' })
      if (!nextEnabled) setWhatsappStatus({ connected: false, qr: null })
    } catch (e) {
      console.error(e)
      setWhatsappEnabled(!nextEnabled)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally {
      setSavingWhatsappToggle(false)
    }
  }

  async function disconnectWhatsapp() {
    if (!confirm('Desligar o WhatsApp? Vai precisar de ler o QR novamente para reativar.')) return
    setDisconnectingWhatsapp(true)
    try {
      await api.disconnectWhatsapp()
      setWhatsappStatus({ connected: false, qr: null })
      toast({ title: 'WhatsApp desligado', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao desligar', variant: 'destructive' })
    } finally {
      setDisconnectingWhatsapp(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp</CardTitle>
        <CardDescription>Avisa o cliente por WhatsApp quando a lavagem/secagem termina</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 max-w-xl">
          <div>
            <div className="font-medium text-sm">Ativar notificações por WhatsApp</div>
            <p className="text-xs text-muted-foreground mt-1">
              Usa um número de WhatsApp real, ligado por QR code (como o WhatsApp
              Web) — sem custos, mas não é a API oficial: em uso muito intenso o
              número pode ser sinalizado pelo WhatsApp. Requer que o cartão do
              cliente tenha um número de telemóvel guardado.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={whatsappEnabled}
            onClick={() => toggleWhatsappEnabled(!whatsappEnabled)}
            disabled={savingWhatsappToggle}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50
              ${whatsappEnabled ? 'bg-primary-600' : 'bg-neutral-300'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${whatsappEnabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>

        {whatsappEnabled && (
          <div className="border-t pt-4 max-w-xs">
            {whatsappStatus.connected ? (
              <div className="space-y-2">
                <p className="text-sm text-green-700 font-medium">Ligado ✓</p>
                <Button type="button" variant="outline" size="sm" onClick={disconnectWhatsapp} disabled={disconnectingWhatsapp}>
                  {disconnectingWhatsapp ? 'A desligar…' : 'Desligar'}
                </Button>
              </div>
            ) : whatsappStatus.qr ? (
              <div className="space-y-2">
                <p className="text-sm">Leia este código com o WhatsApp do número que quer usar:</p>
                <img src={whatsappStatus.qr} alt="QR code do WhatsApp" className="w-48 h-48 border rounded" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">A gerar QR code…</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

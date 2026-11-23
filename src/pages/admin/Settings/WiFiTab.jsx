import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function WiFiTab() {
  const [wifiEnabled, setWifiEnabled] = useState(false)
  const [savingWifiToggle, setSavingWifiToggle] = useState(false)
  const [wifiDuration, setWifiDuration] = useState('60')
  const [wifiSsid, setWifiSsid] = useState('')
  const [savingWifi, setSavingWifi] = useState(false)

  async function loadWifiSettings() {
    try {
      const enabled = await api.getSetting('wifi.enabled').catch(() => null)
      const duration = await api.getSetting('wifi.durationMinutes').catch(() => null)
      const ssid = await api.getSetting('wifi.ssid').catch(() => null)
      setWifiEnabled(Boolean(enabled && enabled.value))
      setWifiDuration(duration && duration.value != null ? String(duration.value) : '60')
      setWifiSsid(ssid && ssid.value != null ? String(ssid.value) : '')
    } catch (e) { console.warn('loadWifiSettings failed', e) }
  }

  useEffect(() => { loadWifiSettings() }, [])

  async function toggleWifiEnabled(nextEnabled) {
    setSavingWifiToggle(true)
    setWifiEnabled(nextEnabled)
    try {
      await api.setSetting({ key: 'wifi.enabled', value: nextEnabled })
      toast({ title: nextEnabled ? 'WiFi grátis ativado' : 'WiFi grátis desativado', variant: 'success' })
    } catch (e) {
      console.error(e)
      setWifiEnabled(!nextEnabled)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally {
      setSavingWifiToggle(false)
    }
  }

  async function saveWifiDetails(e) {
    e.preventDefault()
    const minutes = Number(wifiDuration)
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return toast({ title: 'Duração inválida — indique os minutos de acesso', variant: 'destructive' })
    }
    setSavingWifi(true)
    try {
      await api.setSetting({ key: 'wifi.durationMinutes', value: minutes })
      await api.setSetting({ key: 'wifi.ssid', value: wifiSsid || '' })
      toast({ title: 'Definições de WiFi guardadas', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao guardar definições de WiFi', variant: 'destructive' })
    } finally {
      setSavingWifi(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>WiFi grátis</CardTitle>
        <CardDescription>Voucher de acesso à internet oferecido após lavagem/secagem</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start justify-between gap-4 max-w-xl">
          <div>
            <div className="font-medium text-sm">Oferecer WiFi após a compra</div>
            <p className="text-xs text-muted-foreground mt-1">
              Quando ativo, o quiosque mostra um QR code com um código de acesso
              à rede convidado assim que uma lavagem ou secagem é paga.
              Requer um controlador UniFi configurado no servidor.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={wifiEnabled}
            onClick={() => toggleWifiEnabled(!wifiEnabled)}
            disabled={savingWifiToggle}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50
              ${wifiEnabled ? 'bg-primary-600' : 'bg-neutral-300'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${wifiEnabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>

        <form onSubmit={saveWifiDetails} className="border-t pt-4 space-y-3 max-w-xs">
          <div className="space-y-2">
            <Label htmlFor="wifiDuration">Duração do acesso (minutos)</Label>
            <Input
              id="wifiDuration"
              type="number"
              min="1"
              placeholder="Ex: 60"
              value={wifiDuration}
              onChange={(e) => setWifiDuration(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Tempo até o cliente ser desligado da rede, a partir da primeira ligação.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wifiSsid">Nome da rede (SSID)</Label>
            <Input
              id="wifiSsid"
              type="text"
              placeholder="Ex: Washbubbles-Guest"
              value={wifiSsid}
              onChange={(e) => setWifiSsid(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Mostrado ao cliente como instrução — não configura a rede em si.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={savingWifi}>
              {savingWifi ? 'A guardar…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

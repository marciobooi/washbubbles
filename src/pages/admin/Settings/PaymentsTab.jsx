import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Eye, EyeOff } from 'lucide-react'

export default function PaymentsTab() {
  const [mbwayEnabled, setMbwayEnabled] = useState(false)
  // MB WAY (Eupago): OFF until the admin switches it on here
  const [mbwayQr, setMbwayQr] = useState(true)       // the two ways to give the number at the kiosk; both on unless switched off
  const [mbwayTyped, setMbwayTyped] = useState(true)
  const [mbwayEnv, setMbwayEnv] = useState('sandbox')
  const [mbwayKey, setMbwayKey] = useState('')
  const [mbwayShowKey, setMbwayShowKey] = useState(false)
  const [savingMbway, setSavingMbway] = useState(false)
  const [savingWifiToggle, setSavingWifiToggle] = useState(false)

  async function loadMbwaySettings() {
    try {
      const en = await api.getSetting('payments.mbway.enabled').catch(() => null)
      const env = await api.getSetting('payments.mbway.env').catch(() => null)
      const key = await api.getSetting('payments.mbway.apiKey').catch(() => null)
      const qr = await api.getSetting('payments.mbway.qr').catch(() => null)
      const typed = await api.getSetting('payments.mbway.typed').catch(() => null)
      const on = (r) => !(r && (r.value === false || r.value === 'false'))
      setMbwayQr(on(qr)); setMbwayTyped(on(typed))
      setMbwayEnabled(Boolean(en && (en.value === true || en.value === 'true')))
      setMbwayEnv(env && env.value === 'production' ? 'production' : 'sandbox')
      setMbwayKey(key && key.value ? String(key.value) : '')
    } catch (e) { console.warn('loadMbwaySettings failed', e) }
  }

  useEffect(() => { loadMbwaySettings() }, [])

  async function saveMbwayConfig(e) {
    e?.preventDefault?.()
    setSavingMbway(true)
    try {
      await api.setSetting({ key: 'payments.mbway.env', value: mbwayEnv })
      await api.setSetting({ key: 'payments.mbway.apiKey', value: mbwayKey.trim() })
      toast({ title: 'Definições do MB WAY guardadas', description: 'A loja recebe-as em poucos minutos.', variant: 'success' })
    } catch (err) { console.error(err); toast({ title: 'Erro ao guardar', variant: 'destructive' }) }
    finally { setSavingMbway(false) }
  }

  // One of the two ways to give the number (QR code / number box at the kiosk). At least one has to stay on.
  async function toggleMbwayWay(which, next) {
    const other = which === 'qr' ? mbwayTyped : mbwayQr
    if (!next && !other) { toast({ title: 'Tem de ficar pelo menos uma forma ligada', description: 'Para desligar o MB WAY de vez, use o interruptor de cima.', variant: 'destructive' }); return }
    const set = which === 'qr' ? setMbwayQr : setMbwayTyped
    set(next); setSavingMbway(true)
    try {
      await api.setSetting({ key: which === 'qr' ? 'payments.mbway.qr' : 'payments.mbway.typed', value: next })
      toast({ title: 'Guardado', description: 'O quiosque atualiza em poucos minutos.', variant: 'success' })
    } catch (err) { console.error(err); set(!next); toast({ title: 'Erro ao guardar', variant: 'destructive' }) }
    finally { setSavingMbway(false) }
  }

  async function toggleMbway(next) {
    if (next && !mbwayKey.trim()) { toast({ title: 'Escreva primeiro a chave API do Eupago e guarde', variant: 'destructive' }); return }
    setSavingMbway(true)
    setMbwayEnabled(next)
    try {
      await api.setSetting({ key: 'payments.mbway.env', value: mbwayEnv })
      await api.setSetting({ key: 'payments.mbway.apiKey', value: mbwayKey.trim() })
      await api.setSetting({ key: 'payments.mbway.enabled', value: next })
      toast({ title: next ? 'MB WAY ativado' : 'MB WAY desativado', description: 'O quiosque atualiza em poucos minutos.', variant: 'success' })
    } catch (err) { console.error(err); setMbwayEnabled(!next); toast({ title: 'Erro ao guardar', variant: 'destructive' }) }
    finally { setSavingMbway(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MB WAY (Eupago)</CardTitle>
        <CardDescription>Pagamento das máquinas no telemóvel do cliente</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start justify-between gap-4 max-w-xl">
          <div>
            <div className="font-medium text-sm">Aceitar MB WAY no quiosque</div>
            <p className="text-xs text-muted-foreground mt-1">
              Desligado por omissão. Quando ligado, a janela de pagamento oferece MB WAY: o cliente escreve o número no quiosque ou lê um código QR com o
              telemóvel (ver as duas formas abaixo) e aprova na app (tem 5 minutos); depois a máquina arranca, ou o cartão é entregue ou
              carregado. Serve para pagar máquinas, comprar um cartão e carregar um cartão. Mínimo 1,00€. O quiosque confirma o pagamento
              diretamente no Eupago, sem precisar de webhook.
            </p>
          </div>
          <button type="button" role="switch" aria-checked={mbwayEnabled} onClick={() => toggleMbway(!mbwayEnabled)} disabled={savingMbway}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${mbwayEnabled ? 'bg-primary-600' : 'bg-neutral-300'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${mbwayEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="border-t pt-4 space-y-4 max-w-xl">
          <div className="text-sm font-medium">Como o cliente indica o número no quiosque</div>
          {[
            { id: 'typed', on: mbwayTyped, title: 'Caixa para escrever o número', text: 'O cliente escreve o número do MB WAY no ecrã do quiosque e aprova na app. É a forma mais simples e funciona com qualquer telemóvel.' },
            { id: 'qr', on: mbwayQr, title: 'Código QR', text: 'O cliente lê o código com a câmara normal do telemóvel (não com o leitor da app MB WAY) e escreve o número no próprio telemóvel.' },
          ].map((w) => (
            <div key={w.id} className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium text-sm">{w.title}</div>
                <p className="text-xs text-muted-foreground mt-1">{w.text}</p>
              </div>
              <button type="button" role="switch" aria-checked={w.on} aria-label={w.title} onClick={() => toggleMbwayWay(w.id, !w.on)} disabled={savingMbway}
                className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${w.on ? 'bg-primary-600' : 'bg-neutral-300'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${w.on ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Com as duas ligadas, o cliente escolhe. Com uma só, o quiosque abre diretamente essa forma.</p>
        </div>

        <form onSubmit={saveMbwayConfig} className="border-t pt-4 space-y-3 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="mbwayEnv">Ambiente</Label>
            <select id="mbwayEnv" value={mbwayEnv} onChange={(e) => setMbwayEnv(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
              <option value="sandbox">Teste (sandbox): os pagamentos não são reais</option>
              <option value="production">Produção: dinheiro real</option>
            </select>
            {mbwayEnv === 'production' && <p className="text-xs text-amber-700">Produção: cada pagamento é dinheiro real. Confirme que a chave é a da conta de produção.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mbwayKey">Chave API do Eupago</Label>
            <div className="flex justify-end gap-2">
              <Input id="mbwayKey" type={mbwayShowKey ? 'text' : 'password'} autoComplete="off" placeholder="xxxx-xxxx-xxxx-xxxx-xxxx" value={mbwayKey} onChange={(e) => setMbwayKey(e.target.value)} />
              <Button type="button" variant="outline" size="sm" onClick={() => setMbwayShowKey((s) => !s)} aria-label="Mostrar ou esconder a chave">{mbwayShowKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Encontra-se no backoffice do Eupago: Canais → Listagem de Canais. A chave de teste só funciona no ambiente de teste.</p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={savingMbway}>{savingMbway ? 'A guardar…' : 'Guardar'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

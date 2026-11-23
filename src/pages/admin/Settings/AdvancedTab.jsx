import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Settings hidden from the raw "Avançado" list below — either because they
// already have a dedicated, friendlier UI elsewhere (so a second raw/rawer
// editor for the same value just invites confusing drift between the two),
// because they're a credential that shouldn't sit in a scrollable list next
// to unrelated config (adminPin), or because they're internal state the app
// maintains itself and was never meant to be hand-edited (cashDrawerLedger,
// hopperTarget — corrupting either just silently breaks an auto-fill, with
// no obvious symptom pointing back at "someone edited a raw setting").
// Still settable directly by typing the exact key into the Add form above —
// that's a deliberate technical action, unlike stumbling across it in a list.
const HIDDEN_ADVANCED_KEYS = new Set([
  'adminPin',
  'cashDrawerLedger',
  'hopperTarget',
  'coinEqTable', 'billEqTable', 'rechargeCoinBonus', 'rechargeBillBonus', 'autoCharge',
  'hopperCoinValue', 'hopperMaxDispenseCoins', 'creditRefundSeconds', 'campaign.email',
  'branding.companyName', 'branding.logo', 'branding.primaryColor', 'branding.accentColor',
  'banners',
  'legal.info',
  'landingPage.content',
  'wifi.enabled',
  'whatsapp.enabled',
  'loyaltyCard.cost', 'loyaltyCard.credit', 'loyaltyCard.minRecharge',
  'payments.mbway.enabled', 'payments.mbway.qr', 'payments.mbway.typed', 'payments.mbway.env', 'payments.mbway.apiKey', 'sync.pendingKey', 'sync.pendingKeyResult',
])

export default function AdvancedTab() {
  const [list, setList] = useState([])
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')

  async function load() {
    try {
      const data = await api.getSettings()
      setList(data)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar definições', variant: 'destructive' })
    }
  }

  useEffect(() => { load() }, [])

  async function save(e) {
    e.preventDefault()
    try {
      // The field is labelled "aceita JSON" — parse it as JSON when possible
      // (numbers, booleans, arrays, objects) so e.g. `123` or `["a","b"]`
      // land as real typed values, not the literal string. Falls back to the
      // raw text for anything that isn't valid JSON, like a plain word.
      let parsedValue = value
      try { parsedValue = JSON.parse(value) } catch { /* not JSON — store as plain text */ }
      await api.setSetting({ key, value: parsedValue })
      toast({ title: 'Definição salva', variant: 'success' })
      setKey('')
      setValue('')
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro', variant: 'destructive' })
    }
  }

  async function remove(k) {
    if (!confirm('Remover definição?')) return
    try {
      await api.deleteSetting(k)
      toast({ title: 'Definição removida', variant: 'success' })
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro', variant: 'destructive' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configurações Avançadas</CardTitle>
        <CardDescription>Só para chaves de configuração pontuais, fora do que já é gerido nos outros separadores.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={save} className="flex gap-2">
          <Input
            placeholder="Nome da chave"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="w-64"
          />
          <Input
            placeholder="Valor (aceita JSON)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1"
          />
          <Button type="submit">Adicionar</Button>
        </form>

        <div className="border rounded-lg">
          {list.filter(s => !HIDDEN_ADVANCED_KEYS.has(s.key)).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">
              Nenhuma configuração avulsa — as definições comuns têm o seu próprio separador acima.
            </p>
          ) : (
            <ul className="divide-y">
              {list.filter(s => !HIDDEN_ADVANCED_KEYS.has(s.key)).map((s) => (
                <li key={s._id} className="p-3 flex justify-between items-center hover:bg-muted/50">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{s.key}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-1">
                      {JSON.stringify(s.value)}
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(s.key)}
                  >
                    Eliminar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

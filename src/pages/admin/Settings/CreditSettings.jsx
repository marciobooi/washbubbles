import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** Two settings about the customer's money in the kiosk: save the cash on the card when it is taken out, and give back unused cash. */
export default function CreditSettings() {
  const [autoCharge, setAutoCharge] = useState(false)
  const [refundSeconds, setRefundSeconds] = useState(120)
  const [saving, setSaving] = useState(false)

  async function load() {
    const a = await api.getSetting('autoCharge').catch(() => null)
    const r = await api.getSetting('creditRefundSeconds').catch(() => null)
    setAutoCharge(a && a.value ? Boolean(a.value) : false)
    setRefundSeconds(r && r.value != null ? Number(r.value) : 120)
  }
  useEffect(() => { load() }, [])

  async function saveOne(e, entries, okTitle) {
    e.preventDefault()
    setSaving(true)
    try {
      for (const [key, value] of entries) await api.setSetting({ key, value })
      toast({ title: okTitle, variant: 'success' })
      load()
    } catch (err) {
      console.error(err)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  function saveAutoCharge(e) { return saveOne(e, [['autoCharge', autoCharge]], 'Guardado') }
  function saveRefund(e) {
    if (!Number.isInteger(refundSeconds) || refundSeconds < 0 || refundSeconds > 3600) {
      e.preventDefault()
      toast({ title: 'A devolução automática tem de ser entre 0 e 3600 segundos (0 = nunca devolver)', variant: 'destructive' })
      return
    }
    return saveOne(e, [['creditRefundSeconds', refundSeconds]], 'Guardado')
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Carregar cartão ao remover</CardTitle>
          <CardDescription>O que acontece ao dinheiro quando o cliente tira o cartão do leitor</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveAutoCharge} className="space-y-4 max-w-xl">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input id="autoCharge" type="checkbox" checked={autoCharge} onChange={(e) => setAutoCharge(e.target.checked)} className="w-4 h-4" />
                <Label htmlFor="autoCharge" className="cursor-pointer">Carregar cartão automaticamente ao remover</Label>
              </div>
              <p className="text-xs text-muted-foreground ml-6">Guardar automaticamente o saldo em dinheiro no cartão quando este é removido (vale para moedas e notas)</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={saving}>Guardar</Button>
              <Button type="button" variant="outline" onClick={() => { load(); toast({ title: 'Revertido', variant: 'success' }) }}>Reverter</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Devolução automática do crédito</CardTitle>
          <CardDescription>O dinheiro que o cliente deixa no quiosque sem usar</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveRefund} className="space-y-4 max-w-xl">
            <div className="space-y-2">
              <Label htmlFor="creditRefundSeconds">Devolver o dinheiro não usado ao fim de (segundos)</Label>
              <Input id="creditRefundSeconds" type="number" step="1" min="0" max="3600" value={refundSeconds} onChange={(e) => setRefundSeconds(Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">
                Se o cliente inserir moedas/notas e deixar o quiosque sem tocar neste tempo, o dinheiro é devolvido pelo hopper.
                Cada moeda, nota ou toque no ecrã reinicia a contagem. <strong>0 = nunca devolver.</strong> Por omissão: 120 (2 minutos).
                A alteração chega ao quiosque em poucos minutos.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={saving}>Guardar</Button>
              <Button type="button" variant="outline" onClick={() => { load(); toast({ title: 'Revertido', variant: 'success' }) }}>Reverter</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

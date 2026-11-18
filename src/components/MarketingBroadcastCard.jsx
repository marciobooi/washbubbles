import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** An e-mail campaign to the customers who accepted marketing when they bought their card. Lives with the other e-mail settings. */
export default function MarketingBroadcastCard() {
  const [optInCount, setOptInCount] = useState(null)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    api.getMarketingOptInCount().then(({ count }) => setOptInCount(count)).catch((e) => console.warn('loadOptInCount failed', e))
  }, [])

  async function sendBroadcast(e) {
    e.preventDefault()
    if (!subject.trim() || !message.trim()) return toast({ title: 'Preencha assunto e mensagem', variant: 'destructive' })
    if (!confirm(`Enviar para ${optInCount ?? '?'} clientes? Esta ação não pode ser desfeita.`)) return
    setSending(true)
    try {
      const res = await api.sendMarketingBroadcast({ subject: subject.trim(), message: message.trim() })
      toast({ title: `Enviado: ${res.sent} · Falhados: ${res.failed}`, variant: 'success' })
      setSubject('')
      setMessage('')
    } catch (err) {
      console.error(err)
      toast({ title: 'Erro ao enviar campanha', variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campanha por email aos clientes</CardTitle>
        <CardDescription>
          Enviado apenas a clientes que aceitaram receber marketing na compra do cartão.
          {optInCount != null && <span className="font-medium"> {optInCount} clientes elegíveis.</span>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={sendBroadcast} className="space-y-3 max-w-xl">
          <div>
            <Label htmlFor="broadcast-subject">Assunto</Label>
            <Input id="broadcast-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="broadcast-message">Mensagem</Label>
            <textarea id="broadcast-message" className="w-full border rounded p-2 text-sm" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <Button type="submit" disabled={sending || !optInCount}>{sending ? 'A enviar…' : 'Enviar campanha'}</Button>
        </form>
      </CardContent>
    </Card>
  )
}

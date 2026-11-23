import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const errText = (err, fb) => err?.body?.error || err?.message || fb

/** The shop's own e-mail identity: the support address and (optionally) its own mailbox, so mail comes from the shop's address. */
export default function ShopMailForm() {
  const [d, setD] = useState(null)
  const [pass, setPass] = useState('')
  const [own, setOwn] = useState(false)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    api.request('/admin/shop-mail', { method: 'GET', expect: 'json' })
      .then((r) => { setD(r); setOwn(!!(r.account.host || r.account.hasPassword)) })
      .catch(() => setD({ supportEmail: '', account: { host: '', port: '', user: '', from: '', hasPassword: false } }))
  }, [])
  if (!d) return null
  const setAcc = (k) => (e) => setD({ ...d, account: { ...d.account, [k]: e.target.value } })

  async function save(e) {
    e.preventDefault()
    setBusy('save')
    try {
      const body = { supportEmail: d.supportEmail, account: own ? { ...d.account, pass } : { clear: true } }
      const r = await api.request('/admin/shop-mail', { method: 'PUT', json: body, expect: 'json' })
      setD(r); setPass(''); setOwn(!!(r.account.host || r.account.hasPassword))
      toast({ title: 'Email da loja guardado', variant: 'success' })
    } catch (err) { toast({ title: errText(err, 'Não foi possível guardar'), variant: 'destructive' }) }
    finally { setBusy('') }
  }
  async function test() {
    setBusy('test')
    try {
      const r = await api.request('/admin/shop-mail/test', { method: 'POST', json: {}, expect: 'json' })
      toast({ title: `Email de teste enviado para ${r.to}${r.viaOwnMailbox ? ' (pela sua caixa de email)' : ''}`, variant: 'success' })
    } catch (err) { toast({ title: errText(err, 'O teste falhou'), variant: 'destructive' }) }
    finally { setBusy('') }
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Email da loja</CardTitle>
        <CardDescription>O email de suporte da loja e, se quiser, a sua própria caixa de email para enviar</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3 max-w-xl">
          <div className="space-y-1">
            <Label htmlFor="supportEmail">Email de suporte</Label>
            <Input id="supportEmail" type="email" placeholder="geral@minhaloja.pt" value={d.supportEmail} onChange={(e) => setD({ ...d, supportEmail: e.target.value })} />
            <p className="text-xs text-muted-foreground">Recebe os alertas da loja (se não definir um email só para alertas, abaixo), é para onde vão as respostas dos clientes e é o contacto que aparece nos emails.</p>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} /> Enviar os emails pela minha própria caixa de email
          </label>
          <p className="text-xs text-muted-foreground -mt-1">Assim os clientes recebem os emails vindos de <b>o seu endereço</b> (por exemplo geral@minhaloja.pt). Se não preencher, enviamos em nome da sua loja pela nossa caixa, e as respostas vão para o email de suporte.</p>

          {own && (
            <div className="grid grid-cols-3 gap-2 rounded-lg border p-3">
              <div className="col-span-2 space-y-1"><Label htmlFor="sm-host">Servidor de envio (SMTP)</Label><Input id="sm-host" placeholder="smtp.amen.pt  ·  smtp.gmail.com" value={d.account.host} onChange={setAcc('host')} /></div>
              <div className="space-y-1"><Label htmlFor="sm-port">Porta</Label><Input id="sm-port" placeholder="587" value={d.account.port} onChange={setAcc('port')} /></div>
              <div className="space-y-1"><Label htmlFor="sm-user">Utilizador</Label><Input id="sm-user" autoComplete="off" placeholder="geral@minhaloja.pt" value={d.account.user} onChange={setAcc('user')} /></div>
              <div className="space-y-1"><Label htmlFor="sm-pass">Palavra-passe</Label><Input id="sm-pass" type="password" autoComplete="new-password" placeholder={d.account.hasPassword ? '•••••• (guardada)' : ''} value={pass} onChange={(e) => setPass(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="sm-from">Endereço de envio</Label><Input id="sm-from" placeholder="(igual ao utilizador)" value={d.account.from} onChange={setAcc('from')} /></div>
              <p className="col-span-3 text-xs text-muted-foreground">Google: use a porta 587 e uma «palavra-passe de aplicação» (Conta Google → Segurança), não a palavra-passe normal. Amen: o servidor e a porta estão no painel da caixa de email. A palavra-passe fica guardada cifrada e nunca é mostrada.</p>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" size="sm" disabled={busy === 'save'}>{busy === 'save' ? 'A guardar…' : 'Guardar'}</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy === 'test' || !d.supportEmail} onClick={test}>{busy === 'test' ? 'A enviar…' : 'Enviar email de teste'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

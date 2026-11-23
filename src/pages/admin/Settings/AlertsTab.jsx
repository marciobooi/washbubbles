import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ShopMailForm from '@/components/ShopMailForm'
import AlertPrefsCard from '@/components/AlertPrefsCard'

/** The address the customers' answers to a campaign go to. The campaign itself is written and sent in the Campanhas menu. */
function CampaignEmailCard() {
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api.getSetting('campaign.email').then((r) => { const v = typeof r?.value === 'string' ? r.value : ''; setEmail(v); setSaved(v) }).catch(() => {})
  }, [])
  async function save(e) {
    e.preventDefault()
    const v = email.trim()
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { toast({ title: 'Email inválido', variant: 'destructive' }); return }
    setSaving(true)
    try {
      await api.setSetting({ key: 'campaign.email', value: v })
      setEmail(v); setSaved(v)
      toast({ title: v ? 'Email das campanhas guardado' : 'Email das campanhas removido', variant: 'success' })
    } catch (err) {
      console.error(err)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally { setSaving(false) }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email das campanhas</CardTitle>
        <CardDescription>Para onde vão as respostas dos clientes às campanhas</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-2 max-w-md">
          <Label htmlFor="campaignEmail">Email das campanhas</Label>
          <Input id="campaignEmail" type="email" placeholder="campanhas@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="text-xs text-muted-foreground">Deixe em branco para usar o email de suporte da loja. A campanha em si escreve-se e envia-se no menu <strong>Cupões e Campanhas</strong>.</p>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={saving || email.trim() === saved}>{saving ? 'A guardar…' : 'Guardar'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export default function AlertsTab() {
  const [alertsEmail, setAlertsEmail] = useState('')
  const [savingAlertsEmail, setSavingAlertsEmail] = useState(false)

  async function loadAlertsSettings() {
    try {
      const email = await api.getSetting('alerts.email').catch(() => null)
      setAlertsEmail(email && email.value != null ? String(email.value) : '')
    } catch (e) { console.warn('loadAlertsSettings failed', e) }
  }

  useEffect(() => { loadAlertsSettings() }, [])

  async function saveAlertsEmail(e) {
    e.preventDefault()
    if (alertsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertsEmail)) {
      return toast({ title: 'Endereço de email inválido', variant: 'destructive' })
    }
    setSavingAlertsEmail(true)
    try {
      await api.setSetting({ key: 'alerts.email', value: alertsEmail || null })
      toast({ title: alertsEmail ? 'Email de alertas guardado' : 'Alertas por email desativados', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally {
      setSavingAlertsEmail(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Quem recebe o quê</CardTitle>
          <CardDescription>Todos os emails do sistema, num só sítio</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-2 text-slate-700">
            <li><strong>Alertas</strong> (avarias, quiosques offline, máquinas que não arrancam): para o <em>email para alertas</em> abaixo; se estiver vazio, para o <em>email de suporte</em>. Em <em>O que quer receber</em> escolhe-se cada um.</li>
            <li><strong>Relatório de fecho de caixa</strong>: para o mesmo endereço dos alertas, quando se confirma cada fecho. No histórico de fechos, o ícone do envelope reenvia-o e o do olho mostra-o sem enviar.</li>
            <li><strong>Recibos e emails aos clientes</strong>: saem da caixa de email da loja (se estiver configurada) ou da plataforma em nome da loja; as respostas vão para o email de suporte.</li>
            <li><strong>Campanhas</strong> (menu Cupões e Campanhas): só para clientes que aceitaram receber marketing. As respostas dos clientes vão para o <em>email das campanhas</em> abaixo.</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-3">O nome, o logótipo e os contactos que aparecem em todos os emails vêm de Website &gt; Branding e Legal / RGPD.</p>
        </CardContent>
      </Card>
      <ShopMailForm />
      <Card>
        <CardHeader>
          <CardTitle>Alertas por email</CardTitle>
          <CardDescription>Avisos automáticos de avarias e quiosques offline</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveAlertsEmail} className="space-y-2 max-w-xs">
            <Label htmlFor="alertsEmail">Email para alertas</Label>
            <Input
              id="alertsEmail"
              type="email"
              placeholder="operador@exemplo.com"
              value={alertsEmail}
              onChange={(e) => setAlertsEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Recebe um email quando um quiosque não comunica com o servidor há
              mais de 15 minutos, ou quando um quiosque reporta uma avaria de
              hardware (hopper vazio, leitor desligado, etc.) enquanto está
              online. Deixe em branco para desativar. Não afeta o quiosque
              offline em si — só o aviso.
            </p>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={savingAlertsEmail}>
                {savingAlertsEmail ? 'A guardar…' : 'Guardar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <AlertPrefsCard />
      <CampaignEmailCard />
    </>
  )
}

import React, { useEffect, useState } from 'react'
import { shopDateTime } from '@/lib/shopTime'
import api from '@/services/api'
import PageHeader from '@/components/PageHeader'
import { toast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function AdminMaintenance() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('open')
  const [resolvingId, setResolvingId] = useState(null)
  const [reiniting, setReiniting] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [keeping, setKeeping] = useState(false)
  const [health, setHealth] = useState(null)

  useEffect(() => {
    let alive = true
    const tick = () => api.getHardwareHealth().then((h) => { if (alive) setHealth(h) }).catch(() => {})
    tick()
    const id = setInterval(tick, 15000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  async function keepCredit() {
    const v = health?.running !== false && Number.isFinite(health?.credit) ? ` (${health.credit.toFixed(2).replace('.', ',')} €)` : ''
    if (!window.confirm(`O dinheiro inserido e não gasto${v} FICA na máquina: não é devolvido e não fica como crédito. Fica registado como entrada de dinheiro. Continuar?`)) return
    setKeeping(true)
    try {
      let r = await api.keepCredit()
      if (r.queued) {
        const id = r.commandIds?.[0]
        r = { success: false, error: 'A loja não respondeu a tempo. Veja se o PC está ligado.' }
        for (let i = 0; i < 20; i++) {
          await new Promise((ok) => setTimeout(ok, 3000))
          const c = await api.adminCommand(id).catch(() => null)
          if (c?.status === 'done') { r = c.result || { success: true }; break }
          if (c?.status === 'failed') { r = { success: false, error: c.error }; break }
        }
      }
      toast({ title: r.success ? 'Dinheiro mantido na máquina' : 'Não foi possível manter o dinheiro', description: r.success ? `${Number(r.kept || 0).toFixed(2).replace('.', ',')} € ficaram na máquina e foram registados.` : (r.error || r.reason), variant: r.success ? 'success' : 'destructive' })
    } catch (err) {
      toast({ title: err?.body?.error || 'Erro ao manter o dinheiro', variant: 'destructive' })
    } finally { setKeeping(false) }
  }

  async function resetLink() {
    setResetting(true)
    try {
      let r = await api.resetControllerLink()
      if (r.queued) {
        const id = r.commandIds?.[0]
        r = { success: false, error: 'A loja não respondeu a tempo. Veja se o PC está ligado.' }
        for (let i = 0; i < 20; i++) {
          await new Promise((ok) => setTimeout(ok, 3000))
          const c = await api.adminCommand(id).catch(() => null)
          if (c?.status === 'done') { r = c.result || { success: true }; break }
          if (c?.status === 'failed') { r = { success: false, error: c.error }; break }
        }
      }
      toast({ title: r.success ? 'Nova ligação pedida' : 'Não foi possível pedir a nova ligação', description: r.success ? 'Se o controlador responder, as máquinas voltam a arrancar dentro de segundos. Faça um arranque de teste.' : (r.error || r.reason), variant: r.success ? 'success' : 'destructive' })
    } catch (err) {
      toast({ title: err?.body?.error || 'Erro ao pedir a nova ligação', variant: 'destructive' })
    } finally { setResetting(false) }
  }

  async function reinitHardware() {
    setReiniting(true)
    try {
      let r = await api.reinitHardware()
      if (r.queued) {
        const id = r.commandIds?.[0]
        r = { success: false, error: 'A loja não respondeu a tempo. Veja se o PC está ligado.' }
        for (let i = 0; i < 20; i++) {
          await new Promise((ok) => setTimeout(ok, 3000))
          const c = await api.adminCommand(id).catch(() => null)
          if (c?.status === 'done') { r = c.result || { success: true }; break }
          if (c?.status === 'failed') { r = { success: false, error: c.error }; break }
        }
      }
      toast({ title: r.success ? 'Leitores reiniciados' : 'Não foi possível reiniciar os leitores', description: r.success ? 'Notas, moedas, hopper e cartões voltam a ficar prontos dentro de alguns segundos.' : (r.error || r.reason), variant: r.success ? 'success' : 'destructive' })
    } catch (err) {
      toast({ title: err?.body?.error || 'Erro ao reiniciar os leitores', variant: 'destructive' })
    } finally { setReiniting(false) }
  }

  async function load() {
    setLoading(true)
    try {
      const data = await api.getMaintenanceTickets(statusFilter)
      setTickets(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar manutenção', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [statusFilter])

  async function resolve(id) {
    setResolvingId(id)
    try {
      await api.resolveMaintenanceTicket(id)
      toast({ title: 'Ticket resolvido', variant: 'success' })
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao resolver', variant: 'destructive' })
    } finally {
      setResolvingId(null)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-[1180px] mx-auto space-y-4">
      <PageHeader title="Manutenção" />
      <Card>
        <CardHeader>
          <CardTitle>Dinheiro inserido no quiosque</CardTitle>
          <CardDescription>Normalmente o dinheiro que não é gasto é devolvido. Se quiser que fique na máquina (não devolver, sem ficar como crédito), carregue aqui: o valor fica registado como entrada de dinheiro. Se não carregar, tudo funciona como sempre.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {health?.running !== false && Number.isFinite(health?.credit) && <p className="text-sm">Dinheiro inserido agora: <b>{health.credit.toFixed(2).replace('.', ',')} €</b></p>}
          <Button disabled={keeping} onClick={keepCredit}>{keeping ? 'A registar…' : 'Ficar com o dinheiro (não devolver)'}</Button>
        </CardContent>
      </Card>
      <Card className={health?.silent ? 'border-red-500' : ''}>
        <CardHeader>
          <CardTitle>Ligação ao controlador (máquinas)</CardTitle>
          <CardDescription>Se as máquinas não arrancam e nada responde, use isto. O sistema também tenta sozinho e avisa por e-mail quando o controlador fica sem responder. Se não resolver, desligue a energia da caixa do controlador, espere 30 segundos e volte a ligar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {health?.silent && <p className="text-sm font-semibold text-red-600">O controlador não responde há {Math.max(1, Math.round((Date.now() - new Date(health.since).getTime()) / 60000))} min — as máquinas não arrancam.</p>}
          {health && health.running === false && <p className="text-sm text-[#8a8478]">O estado em direto só aparece no PC da loja; o pedido segue para lá.</p>}
          <Button disabled={resetting} onClick={resetLink}>{resetting ? 'A pedir…' : 'Reiniciar ligação ao controlador'}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Leitores do quiosque</CardTitle>
          <CardDescription>Se o leitor de cartões, de notas ou de moedas deixar de responder, use isto antes de reiniciar o PC. Só funciona com o quiosque livre (sem dinheiro nem cartão). Faz sozinho de 3 em 3 horas.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button disabled={reiniting} onClick={reinitHardware}>{reiniting ? 'A reiniciar…' : 'Reiniciar leitores'}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Avarias reportadas</CardTitle>
          <CardDescription>Criadas automaticamente quando uma máquina reporta uma avaria de hardware.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filtrar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Abertas</SelectItem>
                <SelectItem value="resolved">Resolvidas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="text-sm text-[#8a8478]">A carregar…</div>
          ) : tickets.length === 0 ? (
            <div className="text-sm text-[#8a8478] text-center p-6">
              {statusFilter === 'open' ? 'Sem avarias abertas.' : 'Sem tickets resolvidos.'}
            </div>
          ) : (
            <div className="border rounded-lg divide-y divide-black/[0.06]">
              {tickets.map((t) => (
                <div key={t._id} className="p-3 flex items-center justify-between gap-4 hover:bg-neutral-50/50">
                  <div>
                    <div className="font-medium text-sm">{t.machineId?.name || 'Máquina removida'}</div>
                    <div className="text-xs text-[#8a8478]">{t.description}</div>
                    <div className="text-xs text-[#8a8478] mt-1">
                      {t.source === 'manual' ? 'Manual' : 'Automático'} · {shopDateTime(t.createdAt)}
                    </div>
                  </div>
                  {t.status === 'open' && (
                    <Button size="sm" onClick={() => resolve(t._id)} disabled={resolvingId === t._id}>
                      {resolvingId === t._id ? 'A resolver…' : 'Resolver'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
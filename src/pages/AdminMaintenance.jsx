import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function AdminMaintenance() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('open')
  const [resolvingId, setResolvingId] = useState(null)

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
    <div className="p-4 space-y-4">
      <h2 className="text-2xl font-bold">Manutenção</h2>
      <Card>
        <CardHeader>
          <CardTitle>Avarias reportadas</CardTitle>
          <CardDescription>Criadas automaticamente quando uma máquina reporta uma avaria de hardware.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <select className="border p-2 rounded text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="open">Abertas</option>
              <option value="resolved">Resolvidas</option>
            </select>
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground">A carregar…</div>
          ) : tickets.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center p-6">
              {statusFilter === 'open' ? 'Sem avarias abertas.' : 'Sem tickets resolvidos.'}
            </div>
          ) : (
            <div className="border rounded-lg divide-y">
              {tickets.map((t) => (
                <div key={t._id} className="p-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-sm">{t.machineId?.name || 'Máquina removida'}</div>
                    <div className="text-xs text-muted-foreground">{t.description}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {t.source === 'manual' ? 'Manual' : 'Automático'} · {new Date(t.createdAt).toLocaleString('pt-PT')}
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

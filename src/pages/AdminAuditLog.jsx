import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const ACTION_LABELS = {
  'transaction.refund': 'Reembolso',
  'card.balance_override': 'Saldo de cartão alterado diretamente',
  'user.role_change': 'Cargo de utilizador alterado',
  'card.gift_issued': 'Cartão de oferta atribuído',
  'card.gift_requested': 'Cartão de oferta pedido no admin (a loja emite)',
}

function actionLabel(action) {
  return ACTION_LABELS[action] || action
}

export default function AdminAuditLog() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState({})
  const [actionFilter, setActionFilter] = useState('')

  async function load() {
    setLoading(true)
    try {
      const data = await api.getAuditLog(actionFilter ? { action: actionFilter } : undefined)
      setEntries(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar registo de auditoria', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [actionFilter])

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-2xl font-bold">Auditoria</h2>
      <Card>
        <CardHeader>
          <CardTitle>Ações recentes</CardTitle>
          <CardDescription>Quem fez o quê — preços, saldos, utilizadores e reembolsos. Últimas 200 entradas.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <select
              className="border p-2 rounded text-sm"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              <option value="">Todas as ações</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground">A carregar…</div>
          ) : entries.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center p-6">Sem registos.</div>
          ) : (
            <div className="border rounded-lg divide-y">
              {entries.map((e) => (
                <div key={e._id} className="p-3 hover:bg-muted/50">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <span className="font-medium text-sm">{actionLabel(e.action)}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        por {e.actorUsername || 'desconhecido'} · {e.targetType} {e.targetId}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString('pt-PT')}</span>
                      {e.details != null && (
                        <button
                          className="text-xs underline"
                          onClick={() => setExpanded((s) => ({ ...s, [e._id]: !s[e._id] }))}
                        >
                          {expanded[e._id] ? 'Ocultar' : 'Detalhes'}
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded[e._id] && (
                    <pre className="mt-2 text-xs bg-neutral-50 rounded p-2 overflow-x-auto">
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
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

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/services/api'
import { useAuth } from '@/context/AuthContext'

export default function AdminTransactions() {
  const [tx, setTx] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [refundTarget, setRefundTarget] = useState(null) // { _id, amount }
  const [refundReason, setRefundReason] = useState('')
  const [refunding, setRefunding] = useState(false)
  const [filters, setFilters] = useState({ from: '', to: '', type: '' })
  const navigate = useNavigate()
  const { role } = useAuth()
  const canRefund = role === 'ADMIN' || role === 'SUPERADMIN'

  async function load() {
    setLoading(true)
    try {
      const data = await api.getTransactions()
      setTx(data)
    } catch (e) {
      console.error(e)
      // Handle unauthorized explicitly
      if (e && e.status === 401) {
        toast({ title: 'Unauthorized - please login', variant: 'destructive' })
        navigate('/admin')
        return
      }
      toast({ title: 'Erro ao carregar transacções', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function submitRefund(e) {
    e.preventDefault()
    if (!refundReason.trim()) return toast({ title: 'Indique um motivo para o reembolso', variant: 'destructive' })
    setRefunding(true)
    try {
      await api.refundTransaction(refundTarget._id, refundReason.trim())
      toast({ title: 'Reembolso efetuado', variant: 'success' })
      setRefundTarget(null)
      setRefundReason('')
      load()
    } catch (e) {
      console.error(e)
      toast({ title: e?.body?.error || 'Erro ao reembolsar', variant: 'destructive' })
    } finally {
      setRefunding(false)
    }
  }

  async function exportCsv() {
    try {
      const query = {}
      if (filters.from) query.from = filters.from
      if (filters.to) query.to = filters.to
      if (filters.type) query.type = filters.type
      const blob = await api.exportTransactionsCsv(query)
      api.downloadBlob(blob, `transacoes-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao exportar CSV', variant: 'destructive' })
    }
  }

  return (
    <div className="p-4 print:p-0">
      <div className="flex items-center justify-between mb-4 print:hidden">
        <h2 className="text-lg font-semibold">Transacções</h2>
        <Button variant="outline" size="sm" onClick={exportCsv}>Exportar CSV</Button>
      </div>

      <div className="bg-white rounded shadow p-4 mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">De</label>
          <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="w-40" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Até</label>
          <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="w-40" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Tipo</label>
          <select className="border p-2 rounded h-10 text-sm" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
            <option value="">Todos</option>
            <option value="payment">Pagamento</option>
            <option value="recharge">Recarga</option>
            <option value="card_purchase">Compra de cartão</option>
            <option value="admin_start">Início manual</option>
            <option value="refund">Reembolso</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded shadow p-4">
        {loading ? (
          <div>A carregar...</div>
        ) : (
          <table className="w-full text-sm table-auto">
            <thead>
              <tr>
                <th className="text-left p-2">Hora</th>
                <th className="text-left p-2">Tipo</th>
                <th className="text-left p-2">Máquina</th>
                <th className="text-left p-2">Método</th>
                <th className="text-left p-2">Valor</th>
                <th className="text-left p-2">Inserido</th>
                <th className="text-left p-2">Troco</th>
                <th className="text-left p-2 print:hidden">Itens</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let filtered = tx
                if (filters.from) filtered = filtered.filter((t) => new Date(t.createdAt) >= new Date(filters.from))
                if (filters.to) filtered = filtered.filter((t) => new Date(t.createdAt) <= new Date(filters.to + 'T23:59:59'))
                if (filters.type) filtered = filtered.filter((t) => (t.type || 'payment') === filters.type)

                // Agrupar transacções por batchId (fallback para second-level timestamp para entradas antigas)
                const groups = Object.values(filtered.reduce((acc, t) => {
                  const key = t.batchId || new Date(t.createdAt).toISOString().slice(0,19)
                  if (!acc[key]) acc[key] = { key, createdAt: t.createdAt, method: t.method, type: t.type || 'payment', items: [], amount: 0, inserted: 0, change: 0 }
                  acc[key].items.push(t)
                  acc[key].amount += Number(t.amount || 0)
                  acc[key].inserted += Number(t.inserted || 0)
                  acc[key].change += Number(t.change || 0)
                  return acc
                }, {}))

                const typeLabel = (type) => type === 'payment' ? 'Pagamento' : type === 'recharge' ? 'Recarga' : type === 'refund' ? 'Reembolso' : type

                // render grouped rows with expandable details
                return groups.map((g) => {
                  const refundable = canRefund && g.type !== 'refund' && g.items.every((i) => i.status !== 'refunded') && g.items.length === 1
                  const isRefunded = g.items.some((i) => i.status === 'refunded')
                  return (
                  <React.Fragment key={g.key}>
                    <tr className="border-t">
                      <td className="p-2">{new Date(g.createdAt).toLocaleString()}</td>
                      <td className="p-2">
                        {typeLabel(g.type)}
                        {g.type === 'refund' && <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-xs">Reembolso</span>}
                        {isRefunded && <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-xs">Reembolsado</span>}
                      </td>
                      <td className="p-2">{g.items.map(i => (i.machineId ? i.machineId.name : (Array.isArray(i.items) && i.items[0] && (i.items[0].name || i.items[0].type)) || '-')).join(', ')}</td>
                      <td className="p-2">{(g.items[0] && (g.items[0].method === 'card' ? 'Cartão' : (g.items[0].method === 'cash' ? 'Dinheiro' : g.items[0].method))) || '-'}</td>
                      <td className="p-2">{typeof g.amount === 'number' ? g.amount.toFixed(2) : g.amount}</td>
                      <td className="p-2">{g.inserted ? g.inserted.toFixed(2) : '-'}</td>
                      <td className="p-2">{g.change ? g.change.toFixed(2) : '-'}</td>
                      <td className="p-2 print:hidden flex items-center gap-2">
                        <button onClick={() => setExpanded((s)=>({...s,[g.key]:!s[g.key]}))} className="text-sm underline">{expanded[g.key] ? 'Ocultar' : 'Detalhes'}</button>
                        {refundable && (
                          <button
                            onClick={() => setRefundTarget(g.items[0])}
                            className="text-sm text-red-600 underline"
                          >
                            Reembolsar
                          </button>
                        )}
                      </td>
                    </tr>

                    {expanded[g.key] && (
                      <tr>
                        <td colSpan={8} className="p-2 bg-neutral-50">
                          <div className="space-y-2">
                            {g.items.map((t) => (
                              <div key={t._id} className="p-2 bg-white border rounded flex items-center justify-between">
                                <div>
                                  <div className="font-semibold">{t.machineId ? t.machineId.name : '-'}</div>
                                  <div className="text-xs text-neutral-500">{t.items ? (Array.isArray(t.items) ? t.items.map(it=>it.name||it.type).join(', ') : JSON.stringify(t.items)) : ''}</div>
                                  {t.refundReason && <div className="text-xs text-red-600 mt-1">Motivo: {t.refundReason}</div>}
                                </div>
                                <div className="text-right">
                                  <div>{t.method === 'card' ? 'Cartão' : (t.method === 'cash' ? 'Dinheiro' : t.method)}</div>
                                  <div className="font-semibold">{Number(t.amount).toFixed(2)}€</div>
                                  <div className="text-xs">Inserido: {t.inserted ?? '-'} Troco: {t.change ?? '-'}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )})
              })()}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!refundTarget} onClose={() => { setRefundTarget(null); setRefundReason('') }} title="Reembolsar transacção">
        <form onSubmit={submitRefund} className="space-y-3">
          <h3 className="font-semibold text-lg">Reembolsar transacção</h3>
          {refundTarget && (
            <p className="text-sm text-muted-foreground">
              Valor: <span className="font-medium">{Number(refundTarget.amount).toFixed(2)}€</span>
              {refundTarget.cardCode ? ' — devolvido ao saldo do cartão.' : ' — dinheiro, pagamento manual na gaveta.'}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Motivo</label>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={3}
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="Ex: máquina avariada, cliente não recebeu o serviço"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setRefundTarget(null); setRefundReason('') }}>Cancelar</Button>
            <Button type="submit" variant="destructive" disabled={refunding}>{refunding ? 'A processar…' : 'Confirmar reembolso'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

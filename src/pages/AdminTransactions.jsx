import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'

export default function AdminTransactions() {
  const [tx, setTx] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState({})
  const navigate = useNavigate()

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

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Transacções</h2>
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
                <th className="text-left p-2">Itens</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Agrupar transacções por batchId (fallback para second-level timestamp para entradas antigas)
                const groups = Object.values(tx.reduce((acc, t) => {
                  const key = t.batchId || new Date(t.createdAt).toISOString().slice(0,19)
                  if (!acc[key]) acc[key] = { key, createdAt: t.createdAt, method: t.method, type: t.type || 'payment', items: [], amount: 0, inserted: 0, change: 0 }
                  acc[key].items.push(t)
                  acc[key].amount += Number(t.amount || 0)
                  acc[key].inserted += Number(t.inserted || 0)
                  acc[key].change += Number(t.change || 0)
                  return acc
                }, {}))

                // render grouped rows with expandable details
                return groups.map((g) => (
                  <React.Fragment key={g.key}>
                    <tr className="border-t">
                      <td className="p-2">{new Date(g.createdAt).toLocaleString()}</td>
                      <td className="p-2">{g.type === 'payment' ? 'Pagamento' : (g.type === 'recharge' ? 'Recarga' : g.type)}</td>
                      <td className="p-2">{g.items.map(i => (i.machineId ? i.machineId.name : (Array.isArray(i.items) && i.items[0] && (i.items[0].name || i.items[0].type)) || '-')).join(', ')}</td>
                      <td className="p-2">{(g.items[0] && (g.items[0].method === 'card' ? 'Cartão' : (g.items[0].method === 'cash' ? 'Dinheiro' : g.items[0].method))) || '-'}</td>
                      <td className="p-2">{typeof g.amount === 'number' ? g.amount.toFixed(2) : g.amount}</td>
                      <td className="p-2">{g.inserted ? g.inserted.toFixed(2) : '-'}</td>
                      <td className="p-2">{g.change ? g.change.toFixed(2) : '-'}</td>
                      <td className="p-2">
                        <button onClick={() => setExpanded((s)=>({...s,[g.key]:!s[g.key]}))} className="text-sm underline">{expanded[g.key] ? 'Ocultar' : 'Detalhes'}</button>
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
                ))
              })()}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
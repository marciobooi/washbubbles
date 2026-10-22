import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/services/api'
import { useAuth } from '@/context/AuthContext'

// Today's calendar day (local time) as YYYY-MM-DD: the day the list opens on.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const EMPTY_COLS = { machine: '', card: '', method: '', amountMin: '', change: '', timeFrom: '', timeTo: '' }
const methodLabel = (m) => (m === 'card' ? 'Cartão' : m === 'cash' ? 'Dinheiro' : m === 'gift' ? 'Oferta' : m === 'mbway' ? 'MB WAY' : m || '-')
// What a movement was for: sales store `items` as a list (machines) or as a single object (a card recharge).
const itemList = (t) => (Array.isArray(t.items) ? t.items : t.items && typeof t.items === 'object' ? [t.items] : [])
const itemName = (t) => itemList(t).map((it) => it.name || it.type).filter(Boolean).join(', ')
// The card a movement belongs to: its code, plus the holder's name when we have one (cardId is populated by the server).
const cardLabel = (t) => [t.cardCode || t.cardId?.code || '', t.cardId?.name || ''].filter((x) => String(x).trim()).join(' ')
const fmtDate = (iso) => new Date(iso).toLocaleDateString('pt-PT')
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function AdminTransactions() {
  const [tx, setTx] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [refundTarget, setRefundTarget] = useState(null) // { _id, amount }
  const [refundReason, setRefundReason] = useState('')
  const [refunding, setRefunding] = useState(false)
  // Opens on today's transactions; "Todos os dias" clears the dates.
  const [filters, setFilters] = useState(() => ({ from: today(), to: today(), type: '' }))
  const [sortDir, setSortDir] = useState('desc') // 'desc' = newest first (default), 'asc' = oldest first
  const [cols, setCols] = useState(EMPTY_COLS) // per-column filters (the row under the headings)
  const setCol = (k, v) => setCols((c) => ({ ...c, [k]: v }))
  const navigate = useNavigate()
  const { role } = useAuth()
  const canRefund = role === 'ADMIN' || role === 'SUPERADMIN'

  async function load() {
    setLoading(true)
    try {
      // Ask for the chosen days only (local midnight to 23:59:59), so an older day is not cut off by the server's row cap.
      const query = {}
      if (filters.from) query.from = new Date(filters.from + 'T00:00:00').toISOString()
      if (filters.to) query.to = new Date(filters.to + 'T23:59:59.999').toISOString()
      const data = await api.getTransactions(query)
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

  useEffect(() => { load() }, [filters.from, filters.to])

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
        {/* Today is the default and shows as selected; picking any other dates leaves both buttons off. */}
        <div className="inline-flex rounded-md border overflow-hidden h-10" role="group" aria-label="Período">
          {[['Hoje', filters.from === today() && filters.to === today(), () => setFilters((f) => ({ ...f, from: today(), to: today() }))], ['Todos os dias', !filters.from && !filters.to, () => setFilters((f) => ({ ...f, from: '', to: '' }))]].map(([label, active, onClick]) => (
            <button key={label} type="button" onClick={onClick} aria-pressed={active} className={`px-4 text-sm font-semibold ${active ? 'bg-teal-600 text-white' : 'bg-white text-neutral-700 hover:bg-neutral-50'}`}>{label}</button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))} aria-label="Ordem">{sortDir === 'desc' ? 'Mais recentes primeiro ↓' : 'Mais antigas primeiro ↑'}</Button>
        <Button variant="outline" size="sm" onClick={() => { setCols(EMPTY_COLS); setFilters((f) => ({ ...f, type: '' })) }}>Limpar filtros das colunas</Button>
      </div>

      <div className="bg-white rounded shadow p-4">
        {loading ? (
          <div>A carregar...</div>
        ) : (
          <table className="w-full text-sm table-auto">
            <thead>
              <tr>
                <th className="text-left p-2 cursor-pointer select-none" onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))} title="Clique para inverter a ordem">Data {sortDir === 'desc' ? '↓' : '↑'}</th>
                <th className="text-left p-2 cursor-pointer select-none" onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))} title="Clique para inverter a ordem">Hora {sortDir === 'desc' ? '↓' : '↑'}</th>
                <th className="text-left p-2">Tipo</th>
                <th className="text-left p-2">Máquina</th>
                <th className="text-left p-2">Cartão</th>
                <th className="text-left p-2">Método</th>
                <th className="text-left p-2">Valor</th>
                <th className="text-left p-2">Inserido</th>
                <th className="text-left p-2">Troco</th>
                <th className="text-left p-2 print:hidden">Itens</th>
              </tr>
              {/* Filters, one per column */}
              <tr className="print:hidden border-b">
                <th className="p-1" />
                <th className="p-1 font-normal">
                  <div className="flex items-center gap-1">
                    <input type="time" aria-label="Hora desde" value={cols.timeFrom} onChange={(e) => setCol('timeFrom', e.target.value)} className="w-[5.5rem] border rounded px-1 h-8 text-xs" />
                    <span className="text-xs text-neutral-400">–</span>
                    <input type="time" aria-label="Hora até" value={cols.timeTo} onChange={(e) => setCol('timeTo', e.target.value)} className="w-[5.5rem] border rounded px-1 h-8 text-xs" />
                  </div>
                </th>
                <th className="p-1 font-normal">
                  <select aria-label="Filtrar por tipo" className="border rounded h-8 text-xs w-full" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
                    <option value="">Todos</option>
                    <option value="payment">Pagamento</option>
                    <option value="recharge">Recarga</option>
                    <option value="card_purchase">Compra de cartão</option>
                    <option value="gift_card">Cartão de oferta</option>
                    <option value="admin_start">Início manual</option>
                    <option value="refund">Reembolso</option>
                  </select>
                </th>
                <th className="p-1 font-normal"><input type="text" aria-label="Filtrar por máquina" placeholder="Ex: Secar 9" value={cols.machine} onChange={(e) => setCol('machine', e.target.value)} className="w-full border rounded px-2 h-8 text-xs" /></th>
                <th className="p-1 font-normal"><input type="text" aria-label="Filtrar por cartão" placeholder="Código ou nome" value={cols.card} onChange={(e) => setCol('card', e.target.value)} className="w-full border rounded px-2 h-8 text-xs" /></th>
                <th className="p-1 font-normal">
                  <select aria-label="Filtrar por método" className="border rounded h-8 text-xs w-full" value={cols.method} onChange={(e) => setCol('method', e.target.value)}>
                    <option value="">Todos</option>
                    <option value="cash">Dinheiro</option>
                    <option value="card">Cartão</option>
                    <option value="mbway">MB WAY</option>
                    <option value="gift">Oferta</option>
                  </select>
                </th>
                <th className="p-1 font-normal"><input type="number" min="0" step="0.01" aria-label="Valor mínimo" placeholder="≥ €" value={cols.amountMin} onChange={(e) => setCol('amountMin', e.target.value)} className="w-20 border rounded px-2 h-8 text-xs" /></th>
                <th className="p-1" />
                <th className="p-1 font-normal">
                  <select aria-label="Filtrar por troco" className="border rounded h-8 text-xs w-full" value={cols.change} onChange={(e) => setCol('change', e.target.value)}>
                    <option value="">Todos</option>
                    <option value="with">Com troco</option>
                    <option value="without">Sem troco</option>
                  </select>
                </th>
                <th className="p-1 print:hidden" />
              </tr>
            </thead>
            <tbody>
              {(() => {
                let filtered = tx
                // Day filters use the calendar day on this computer's clock (local midnight to 23:59:59).
                if (filters.from) filtered = filtered.filter((t) => new Date(t.createdAt) >= new Date(filters.from + 'T00:00:00'))
                if (filters.to) filtered = filtered.filter((t) => new Date(t.createdAt) <= new Date(filters.to + 'T23:59:59.999'))
                if (filters.type) filtered = filtered.filter((t) => (t.type || 'payment') === filters.type)
                // Column filters
                const hhmm = (t) => { const d = new Date(t.createdAt); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
                if (cols.timeFrom) filtered = filtered.filter((t) => hhmm(t) >= cols.timeFrom)
                if (cols.timeTo) filtered = filtered.filter((t) => hhmm(t) <= cols.timeTo)
                if (cols.method) filtered = filtered.filter((t) => (t.method || '') === cols.method)
                if (cols.card.trim()) {
                  const q = cols.card.trim().toLowerCase()
                  filtered = filtered.filter((t) => cardLabel(t).toLowerCase().includes(q))
                }
                if (cols.machine.trim()) {
                  const q = cols.machine.trim().toLowerCase()
                  filtered = filtered.filter((t) => String(t.machineId?.name || itemName(t) || '').toLowerCase().includes(q))
                }

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
                  .filter((g) => (cols.amountMin === '' || g.amount >= Number(cols.amountMin)) && (cols.change === '' || (cols.change === 'with' ? g.change > 0 : g.change <= 0)))
                groups.sort((a, b) => (sortDir === 'asc' ? 1 : -1) * (new Date(a.createdAt) - new Date(b.createdAt)))
                const totalShown = groups.reduce((s, g) => s + g.amount, 0)

                const typeLabel = (type) => type === 'payment' ? 'Pagamento' : type === 'recharge' ? 'Recarga' : type === 'refund' ? 'Reembolso' : type === 'card_purchase' ? 'Compra de cartão' : type === 'gift_card' ? 'Cartão de oferta' : type === 'admin_start' ? 'Início manual' : type

                // render grouped rows with expandable details
                const rows = groups.map((g) => {
                  const refundable = canRefund && g.type !== 'refund' && g.items.every((i) => i.status !== 'refunded') && g.items.length === 1
                  const isRefunded = g.items.some((i) => i.status === 'refunded')
                  return (
                  <React.Fragment key={g.key}>
                    <tr className="border-t">
                      <td className="p-2 whitespace-nowrap">{fmtDate(g.createdAt)}</td>
                      <td className="p-2 whitespace-nowrap tabular-nums">{fmtTime(g.createdAt)}</td>
                      <td className="p-2">
                        {typeLabel(g.type)}
                        {g.type === 'refund' && <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-xs">Reembolso</span>}
                        {isRefunded && <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-xs">Reembolsado</span>}
                      </td>
                      <td className="p-2">{g.items.map(i => (i.machineId ? i.machineId.name : itemName(i) || '-')).join(', ')}</td>
                      <td className="p-2 whitespace-nowrap">{(() => {
                        const codes = [...new Set(g.items.map((i) => i.cardCode || i.cardId?.code).filter(Boolean))]
                        if (codes.length === 0) return '-'
                        const name = g.items.find((i) => i.cardId?.name && String(i.cardId.name).trim())?.cardId.name
                        return <span title={codes.join(', ')}><span className="font-medium">{codes.join(', ')}</span>{name ? <span className="block text-xs text-neutral-500">{name}</span> : null}</span>
                      })()}</td>
                      <td className="p-2">{(g.items[0] && methodLabel(g.items[0].method)) || '-'}</td>
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
                        <td colSpan={10} className="p-2 bg-neutral-50">
                          <div className="space-y-2">
                            {g.items.map((t) => (
                              <div key={t._id} className="p-2 bg-white border rounded flex items-center justify-between">
                                <div>
                                  <div className="font-semibold">{t.machineId ? t.machineId.name : itemName(t) || '-'}</div>
                                  {cardLabel(t) && <div className="text-xs text-neutral-600">Cartão: {cardLabel(t)}</div>}
                                  <div className="text-xs text-neutral-500">{t.machineId && itemName(t) ? itemName(t) : ''}</div>
                                  {t.refundReason && <div className="text-xs text-red-600 mt-1">Motivo: {t.refundReason}</div>}
                                </div>
                                <div className="text-right">
                                  <div>{t.method === 'card' ? 'Cartão' : (t.method === 'cash' ? 'Dinheiro' : t.method === 'gift' ? 'Oferta' : t.method)}</div>
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
                return (
                  <>
                    <tr className="print:hidden"><td colSpan={10} className="px-2 pt-2 pb-1 text-xs text-neutral-500">{groups.length} {groups.length === 1 ? 'transacção' : 'transacções'} · total {totalShown.toFixed(2)} €</td></tr>
                    {rows.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-neutral-500">Nenhuma transacção com estes filtros.</td></tr>}
                    {rows}
                  </>
                )
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

import React, { useEffect, useState, useMemo } from 'react'
import { shopDate, shopTime, shopDayKey, shopHHMM, shopInstant } from '@/lib/shopTime'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import api from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronRight, ChevronDown, AlertTriangle, Check, Search, RefreshCw } from 'lucide-react'

const today = () => shopDayKey()
const EMPTY_COLS = { machine: '', card: '', method: '__all__', amountMin: '', change: '__all__', timeFrom: '', timeTo: '' }

const methodLabel = (m) => (m === 'card' ? 'Cartão' : m === 'cash' ? 'Dinheiro' : m === 'gift' ? 'Oferta' : m === 'mbway' ? 'MB WAY' : m || '-')
const itemList = (t) => (Array.isArray(t.items) ? t.items : t.items && typeof t.items === 'object' ? [t.items] : [])
const itemName = (t) => itemList(t).map((it) => it.name || it.type).filter(Boolean).join(', ')
const cardLabel = (t) => [t.cardCode || t.cardId?.code || '', t.cardId?.name || ''].filter((x) => String(x).trim()).join(' ')
const fmtDate = (iso) => shopDate(iso)
const fmtTime = (iso) => shopTime(iso)
const money = (n) => Number(n || 0).toFixed(2).replace('.', ',') + ' €'

const typeOptions = [
  { value: '__all__', label: 'Todos os tipos' },
  { value: 'payment', label: 'Pagamento' },
  { value: 'recharge', label: 'Recarga' },
  { value: 'card_purchase', label: 'Compra de cartão' },
  { value: 'gift_card', label: 'Cartão de oferta' },
  { value: 'admin_start', label: 'Início manual' },
  { value: 'refund', label: 'Reembolso' },
]

const changeOptions = [
  { value: '__all__', label: 'Todos' },
  { value: 'with', label: 'Com troco' },
  { value: 'without', label: 'Sem troco' },
]

const methodOptions = [
  { value: '__all__', label: 'Todos os métodos' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'card', label: 'Cartão' },
  { value: 'mbway', label: 'MB WAY' },
  { value: 'gift', label: 'Oferta' },
]

export default function AdminTransactions() {
  const [tx, setTx] = useState([])
  const [loading, setLoading] = useState(false)
  const [openItems, setOpenItems] = useState({})
  const [refundTarget, setRefundTarget] = useState(null)
  const [refundReason, setRefundReason] = useState('')
  const [refunding, setRefunding] = useState(false)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundPayout, setRefundPayout] = useState(false)
  const [filters, setFilters] = useState(() => ({ from: today(), to: today(), type: '__all__', problems: false }))
  const [sortDir, setSortDir] = useState('desc')
  const [cols, setCols] = useState(EMPTY_COLS)
  const [searchTerm, setSearchTerm] = useState('')
  const navigate = useNavigate()
  const { role } = useAuth()
  const canRefund = role === 'ADMIN' || role === 'SUPERADMIN'

  const loadedCard = (t) => Boolean(t) && ['recharge', 'card_purchase'].includes(t.type) && Boolean(t.cardCode || t.cardId)
  const isCashSale = (t) => Boolean(t) && t.method === 'cash' && (loadedCard(t) || (!t.cardCode && !t.cardId))

  async function load() {
    setLoading(true)
    try {
      const query = {}
      if (filters.from) query.from = shopInstant(filters.from, '00:00:00').toISOString()
      if (filters.to) query.to = shopInstant(filters.to, '23:59:59', 999).toISOString()
      const data = await api.getTransactions(query)
      setTx(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
      if (e && e.status === 401) {
        toast({ title: 'Sessão expirada', variant: 'destructive' })
        navigate('/admin')
        return
      }
      toast({ title: 'Erro ao carregar transacções', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filters.from, filters.to])

  const toggleAccordion = (key) => {
    setOpenItems((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const toggleAllAccordions = () => {
    const allKeys = filteredGroups.map(g => g.key)
    const anyClosed = allKeys.some(k => !openItems[k])
    const newOpen = {}
    if (anyClosed) {
      allKeys.forEach(k => { newOpen[k] = true })
    }
    setOpenItems(newOpen)
  }

  function openRefund(t) {
    setRefundTarget(t)
    setRefundAmount(Number(t.amount).toFixed(2))
    setRefundPayout(isCashSale(t))
  }

  function closeRefund() { setRefundTarget(null); setRefundReason(''); setRefundAmount(''); setRefundPayout(false) }

  async function submitRefund(e) {
    e.preventDefault()
    if (!refundReason.trim()) return toast({ title: 'Indique um motivo para o reembolso', variant: 'destructive' })
    const amount = Number(String(refundAmount).replace(',', '.'))
    if (!(amount > 0) || amount > Number(refundTarget.amount) + 0.001) return toast({ title: `O valor deve estar entre 0,01 € e ${money(refundTarget.amount)}`, variant: 'destructive' })
    setRefunding(true)
    try {
      const payout = refundPayout && isCashSale(refundTarget)
      const r = await api.refundTransaction(refundTarget._id, refundReason.trim(), { amount, payout })
      if (r?.payout) {
        const p = r.payout
        toast(p.owed > 0
          ? { title: `Pago ${money(p.dispensed)} pelo hopper; FALTAM ${money(p.owed)}`, description: 'Pague a diferença em mão ao cliente.', variant: 'destructive' }
          : { title: `Reembolso efetuado: ${money(p.dispensed)} pagos pelo hopper`, variant: 'success' })
      } else {
        toast({ title: 'Reembolso efetuado', variant: 'success' })
      }
      closeRefund()
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
      if (filters.type && filters.type !== '__all__') query.type = filters.type
      const blob = await api.exportTransactionsCsv(query)
      api.downloadBlob(blob, `transacoes-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao exportar CSV', variant: 'destructive' })
    }
  }

  const filteredGroups = useMemo(() => {
    let filtered = tx
    if (filters.from) filtered = filtered.filter((t) => new Date(t.createdAt) >= shopInstant(filters.from, '00:00:00'))
    if (filters.to) filtered = filtered.filter((t) => new Date(t.createdAt) <= shopInstant(filters.to, '23:59:59', 999))
    if (filters.type && filters.type !== '__all__') filtered = filtered.filter((t) => (t.type || 'payment') === filters.type)
    if (filters.problems) filtered = filtered.filter((t) => t.status === 'failed' || t.change > 0 || t.items?.some(i => i.status === 'refunded'))

    const hhmm = (t) => shopHHMM(t.createdAt)
    if (cols.timeFrom) filtered = filtered.filter((t) => hhmm(t) >= cols.timeFrom)
    if (cols.timeTo) filtered = filtered.filter((t) => hhmm(t) <= cols.timeTo)
    if (cols.method && cols.method !== '__all__') filtered = filtered.filter((t) => (t.method || '') === cols.method)
    if (cols.card.trim()) {
      const q = cols.card.trim().toLowerCase()
      filtered = filtered.filter((t) => cardLabel(t).toLowerCase().includes(q))
    }
    if (cols.machine.trim()) {
      const q = cols.machine.trim().toLowerCase()
      filtered = filtered.filter((t) => String(t.machineId?.name || itemName(t) || '').toLowerCase().includes(q))
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase()
      filtered = filtered.filter((t) => cardLabel(t).toLowerCase().includes(q) || String(t.machineId?.name || itemName(t) || '').toLowerCase().includes(q) || String(t.amount).includes(q))
    }

    const groups = Object.values(filtered.reduce((acc, t) => {
      const key = t.batchId || t._id || new Date(t.createdAt).toISOString().slice(0,19)
      if (!acc[key]) acc[key] = { key, createdAt: t.createdAt, method: t.method, type: t.type || 'payment', items: [], amount: 0, inserted: 0, change: 0, status: t.status || 'done' }
      acc[key].items.push(t)
      acc[key].amount += Number(t.amount || 0)
      acc[key].inserted += Number(t.inserted || 0)
      acc[key].change += Number(t.change || 0)
      return acc
    }, {}))

    if (cols.amountMin !== '') {
      const min = Number(cols.amountMin)
      filtered = groups.filter(g => g.amount >= min)
    } else {
      filtered = groups
    }
    if (cols.change && cols.change !== '__all__') {
      filtered = filtered.filter(g => cols.change === 'with' ? g.change > 0 : g.change <= 0)
    }

    filtered.sort((a, b) => (sortDir === 'asc' ? 1 : -1) * (new Date(a.createdAt) - new Date(b.createdAt)))
    return filtered
  }, [tx, filters, cols, sortDir, searchTerm])

  const totalShown = filteredGroups.reduce((s, g) => s + g.amount, 0)
  const problemsCount = tx.filter(t => t.status === 'failed' || t.change > 0).length

  return (
    <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 text-slate-800 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Transacções</h1>
          <p className="text-sm text-slate-500 mt-0.5">Histórico completo de pagamentos, recargas, ciclos de máquinas e fechos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
            <span>Atualizado agora</span>
          </div>
          <Button variant="outline" size="sm" onClick={load} className="gap-2">
            <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </Button>
          <Button onClick={exportCsv} className="gap-2 bg-teal-600 hover:bg-teal-700 text-white">
            <span>Exportar (CSV)</span>
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Período:</span>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-1">
              <div className="flex items-center gap-1.5 px-2">
                <label className="text-xs text-slate-400 font-medium">De</label>
                <Input type="date" value={filters.from} onChange={(e) => setFilters(f => ({ ...f, from: e.target.value }))} className="border-0 bg-transparent p-0 text-sm font-medium text-slate-700 focus:ring-0 cursor-pointer h-7 w-32" />
              </div>
              <span className="text-slate-300 font-light">até</span>
              <div className="flex items-center gap-1.5 px-2 border-l border-slate-200">
                <label className="text-xs text-slate-400 font-medium">Até</label>
                <Input type="date" value={filters.to} onChange={(e) => setFilters(f => ({ ...f, to: e.target.value }))} className="border-0 bg-transparent p-0 text-sm font-medium text-slate-700 focus:ring-0 cursor-pointer h-7 w-32" />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-400 mr-1 hidden sm:inline">Atalhos:</span>
            <Button variant={filters.from === today() && filters.to === today() ? 'default' : 'outline'} size="sm" onClick={() => setFilters(f => ({ ...f, from: today(), to: today() }))} className="text-xs h-8">Hoje</Button>
            <Button variant={!filters.from && !filters.to ? 'default' : 'outline'} size="sm" onClick={() => setFilters(f => ({ ...f, from: '', to: '' }))} className="text-xs h-8">Todo o período</Button>
            <Button variant="outline" size="sm" onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} className="text-xs h-8">
              {sortDir === 'desc' ? 'Mais recentes ↓' : 'Mais antigas ↑'}
            </Button>
          </div>
        </div>

        {/* Dropdowns & Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de Transacção</label>
            <Select value={filters.type} onValueChange={(v) => setFilters(f => ({ ...f, type: v }))}>
              <SelectTrigger className="w-full text-sm bg-slate-50/50">
                <SelectValue placeholder="Todos os tipos" />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Método de Pagamento</label>
            <Select value={cols.method} onValueChange={(v) => setCols(c => ({ ...c, method: v }))}>
              <SelectTrigger className="w-full text-sm bg-slate-50/50">
                <SelectValue placeholder="Todos os métodos" />
              </SelectTrigger>
              <SelectContent>
                {methodOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Máquina</label>
            <Input placeholder="Ex: Secar 8..." value={cols.machine} onChange={(e) => setCols(c => ({ ...c, machine: e.target.value }))} className="bg-slate-50/50 text-sm h-9" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status / Troco</label>
            <Select value={cols.change} onValueChange={(v) => setCols(c => ({ ...c, change: v }))}>
              <SelectTrigger className="w-full text-sm bg-slate-50/50">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                {changeOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="relative w-full sm:max-w-md">
            <Input placeholder="Procurar por máquina, cartão, valor..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 text-sm" />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>
          <label className={`flex items-center gap-2 cursor-pointer select-none border px-3.5 py-1.5 rounded-lg transition self-start sm:self-auto ${filters.problems ? 'bg-rose-100 border-rose-300' : 'bg-rose-50 hover:bg-rose-100/80 border-rose-200'}`}>
            <input type="checkbox" checked={filters.problems} onChange={(e) => setFilters(f => ({ ...f, problems: e.target.checked }))} className="w-4 h-4 text-rose-600 rounded border-rose-300 focus:ring-rose-500" />
            <span className="text-xs font-semibold text-rose-800 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              Exibir apenas com problemas / troco
            </span>
            {problemsCount > 0 && <span className="bg-rose-200 text-rose-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{problemsCount}</span>}
          </label>
        </div>
      </div>

      {/* Accordion Timeline List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700 uppercase tracking-wider">Transacções Registadas</span>
            <span className="bg-slate-200 text-slate-700 text-xs font-bold px-2 py-0.5 rounded-full">{filteredGroups.length}</span>
          </div>
          <button type="button" onClick={toggleAllAccordions} className="text-teal-700 hover:text-teal-900 font-medium transition cursor-pointer">
            Expandir / Recolher Todos
          </button>
        </div>

        {loading ? (
          <SkeletonTable rows={6} cols={5} />
        ) : filteredGroups.length === 0 ? (
          <Card className="p-8 text-center text-slate-500">Nenhuma transacção encontrada com estes filtros.</Card>
        ) : (
          filteredGroups.map((g) => {
            const isOpen = Boolean(openItems[g.key])
            const hasError = g.status === 'failed' || g.change > 0 || g.items.some(i => i.status === 'refunded')
            const refundable = canRefund && g.type !== 'refund' && g.items.every((i) => i.status !== 'refunded') && g.items.length === 1

            return (
              <div key={g.key} className={`bg-white rounded-2xl border transition duration-150 overflow-hidden ${hasError ? 'border-rose-200/90 hover:border-rose-300' : 'border-slate-200/90 hover:border-slate-300'}`}>
                <button type="button" onClick={() => toggleAccordion(g.key)} className={`w-full text-left px-5 py-3.5 flex items-center gap-4 transition ${hasError ? 'bg-rose-50/20 hover:bg-rose-50/50' : 'hover:bg-slate-50/50'}`}>
                  <span className={`text-slate-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                    <ChevronRight className="w-4 h-4" />
                  </span>
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 shadow-xs border ${hasError ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>
                    {hasError ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                  </span>
                  <div className="w-24 flex-shrink-0 leading-tight">
                    <div className="font-mono text-xs font-semibold text-slate-800">{shopTime(g.createdAt)}</div>
                    <div className="text-[11px] text-slate-400">{shopDate(g.createdAt)}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900 text-sm tracking-tight truncate">
                      {g.items.map(i => i.machineId?.name || itemName(i) || 'Operação').join(', ')} · {methodLabel(g.method)} · {money(g.amount)}
                      {g.change > 0 ? ` · troco ${money(g.change)}` : ''}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Tipo: {g.type} {cardLabel(g.items[0]) ? `· Cartão: ${cardLabel(g.items[0])}` : ''}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 px-6 sm:px-12 py-5 bg-white space-y-4">
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-xs text-slate-600 pb-4 border-b border-slate-100">
                      <div>Estado: <strong className="text-slate-900 font-semibold">{g.status}</strong></div>
                      <div>Valor: <strong className="text-slate-900 font-semibold">{money(g.amount)}</strong></div>
                      <div>Inserido: <strong className="text-slate-900 font-semibold">{g.inserted ? money(g.inserted) : '—'}</strong></div>
                      <div>Troco: <strong className="text-slate-900 font-semibold">{g.change ? money(g.change) : '0,00 €'}</strong></div>
                      {refundable && (
                        <Button variant="outline" size="sm" onClick={() => openRefund(g.items[0])} className="ml-auto text-rose-600 hover:text-rose-700">
                          Reembolsar
                        </Button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {g.items.map((t, idx) => (
                        <div key={t._id || idx} className="p-3 bg-slate-50 rounded-lg text-xs space-y-1">
                          <div className="flex justify-between font-semibold">
                            <span>{t.machineId?.name || itemName(t) || 'Item'}</span>
                            <span>{money(t.amount)}</span>
                          </div>
                          {cardLabel(t) && <div className="text-slate-500">Cartão: {cardLabel(t)}</div>}
                          {t.refundReason && <div className="text-rose-600">Motivo reembolso: {t.refundReason}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}

        <div className="px-5 py-3.5 rounded-xl border border-slate-200 flex items-center justify-between bg-white text-xs text-slate-600 shadow-xs">
          <span>Total mostrado: <strong>{money(totalShown)}</strong> ({filteredGroups.length} transacções)</span>
        </div>
      </div>

      <RefundModal
        refundTarget={refundTarget}
        refundAmount={refundAmount}
        setRefundAmount={setRefundAmount}
        refundReason={refundReason}
        setRefundReason={setRefundReason}
        refundPayout={refundPayout}
        setRefundPayout={setRefundPayout}
        refunding={refunding}
        onSubmit={submitRefund}
        onClose={closeRefund}
        loadedCard={loadedCard}
        isCashSale={isCashSale}
        money={money}
      />
    </div>
  )
}

function RefundModal({ 
  refundTarget, 
  refundAmount, 
  setRefundAmount, 
  refundReason, 
  setRefundReason, 
  refundPayout, 
  setRefundPayout, 
  refunding, 
  onSubmit, 
  onClose,
  loadedCard,
  isCashSale,
  money 
}) {
  if (!refundTarget) return null

  return (
    <Modal open={true} onClose={refunding ? () => {} : onClose} title="Reembolsar transacção">
      <form onSubmit={onSubmit} className="space-y-4">
        <h3 className="font-semibold text-lg">Reembolsar transacção</h3>
        <p className="text-sm text-muted-foreground">
          Valor: <span className="font-medium">{money(refundTarget.amount)}</span>
          {loadedCard(refundTarget) ? ' — o saldo carregado é retirado do cartão.' : refundTarget.cardCode ? ' — devolvido ao saldo do cartão.' : isCashSale(refundTarget) ? ' — dinheiro.' : ''}
        </p>
        <div>
          <Label>Valor a devolver (€)</Label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              type="text"
              inputMode="decimal"
              className="w-32 text-lg font-semibold"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              aria-label="Valor a devolver"
            />
            <Button type="button" variant="outline" onClick={() => setRefundAmount(Number(refundTarget.amount).toFixed(2))}>
              Valor total ({money(refundTarget.amount)})
            </Button>
          </div>
        </div>
        {isCashSale(refundTarget) && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={refundPayout} onChange={(e) => setRefundPayout(e.target.checked)} />
            <span>
              <b>Pagar este valor agora pelo hopper</b> (as moedas saem na loja).
            </span>
          </label>
        )}
        <div>
          <Label>Motivo</Label>
          <textarea
            className="w-full border rounded p-2 text-sm mt-1"
            rows={3}
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            placeholder="Ex: máquina avariada, cliente não recebeu o serviço"
          />
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button type="button" variant="outline" disabled={refunding} onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="destructive" disabled={refunding}>
            {refunding ? 'A processar…' : 'Confirmar reembolso'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

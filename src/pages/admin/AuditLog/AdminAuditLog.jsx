import React, { useEffect, useState } from 'react'
import { shopDate, shopTime, shopDayKey, shopInstant } from '@/lib/shopTime'
import api from '@/services/api'
import PageHeader from '@/components/PageHeader'
import { toast } from '@/components/ui/Toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronRight, ChevronDown, RefreshCw, AlertTriangle, Check, Search, Download, ClipboardList, Settings } from 'lucide-react'
import { STATUS_BOX } from '@/components/admin/statusBox'

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

function AdminActionsPanel() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [openItems, setOpenItems] = useState({})
  const [actionFilter, setActionFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

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

  const toggleAccordion = (key) => {
    setOpenItems((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const filteredEntries = entries.filter(e => {
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase()
      return (e.actorUsername?.toLowerCase().includes(q) || e.targetType?.toLowerCase().includes(q) || JSON.stringify(e.details).toLowerCase().includes(q))
    }
    return true
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          {/* Filter Row */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-col gap-1">
                <label className="block text-xs font-medium text-slate-600">Tipo de Ação</label>
                <Select value={actionFilter} onValueChange={(v) => setActionFilter(v)}>
                  <SelectTrigger className="w-full sm:w-64 text-sm bg-slate-50/50">
                    <SelectValue placeholder="Todas as ações" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Todas as ações</SelectItem>
                    {Object.entries(ACTION_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 h-[52px] pb-0.5">
                <Button variant="outline" size="sm" onClick={load} className="gap-2 h-9">
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  Atualizar
                </Button>
                <Button variant="outline" size="sm" onClick={() => api.downloadBlob(new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' }), `audit-${new Date().toISOString().slice(0, 10)}.json`)} className="gap-2 h-9">
                  <Download className="w-4 h-4" />
                  Exportar JSON
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1 sm:max-w-md w-full">
              <label className="block text-xs font-medium text-slate-600">Procurar</label>
              <div className="relative">
                <Input placeholder="Procurar por utilizador, tipo, detalhes..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 text-sm bg-slate-50/50" />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>
          </div>

          {/* Counter */}
          <div className="flex items-center justify-between px-1 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700 uppercase tracking-wider">Ações de Administração</span>
              <span className="bg-slate-200 text-slate-700 text-xs font-bold px-2 py-0.5 rounded-full">{filteredEntries.length}</span>
            </div>
          </div>

          {/* List */}
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-slate-200/90 p-5 animate-pulse space-y-2">
                  <div className="h-4 bg-slate-200 rounded w-1/4" />
                  <div className="h-3 bg-slate-200 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-sm text-slate-500 text-center p-8 bg-white rounded-xl border">Sem registos.</div>
          ) : (
            <div className="space-y-3">
              {filteredEntries.map((e) => {
                const isOpen = Boolean(openItems[e._id])
                const hasError = e.action === 'transaction.refund'

                return (
                  <div key={e._id} className={`bg-white rounded-2xl border transition duration-150 overflow-hidden ${hasError ? 'border-rose-200/90 hover:border-rose-300' : 'border-slate-200/90 hover:border-slate-300'}`}>
                    <button type="button" onClick={() => toggleAccordion(e._id)} className={`w-full text-left px-5 py-3.5 flex items-center gap-4 transition ${hasError ? 'bg-rose-50/20 hover:bg-rose-50/50' : 'hover:bg-slate-50/50'}`}>
                      <span className={`text-slate-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                        <ChevronRight className="w-4 h-4" />
                      </span>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 shadow-xs border ${STATUS_BOX[hasError ? 'error' : 'ok']}`}>
                        {hasError ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                      </span>
                      <div className="w-28 flex-shrink-0 leading-tight">
                        <div className="font-mono text-xs font-semibold text-slate-800">{shopTime(e.createdAt)}</div>
                        <div className="text-[11px] text-slate-400">{shopDate(e.createdAt)}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-900 text-sm tracking-tight truncate">{actionLabel(e.action)}</div>
                        <div className="text-xs text-slate-500 mt-0.5">por {e.actorUsername || 'desconhecido'} · {e.targetType} {e.targetId}</div>
                      </div>
                    </button>

                    {isOpen && e.details != null && (
                      <div className="border-t border-slate-100 px-6 sm:px-12 py-5 bg-white">
                        <pre className="text-xs bg-slate-50 rounded p-4 overflow-x-auto text-slate-700">
                          {JSON.stringify(e.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function AdminAuditLog() {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('audit.tab') || 'flows' } catch { return 'flows' } })
  const pick = (t) => { setTab(t); try { localStorage.setItem('audit.tab', t) } catch { /* optional */ } }

  return (
    <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 text-slate-800 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Auditoria</h1>
          <p className="text-sm text-slate-500 mt-0.5">Histórico completo de eventos, pagamentos, ciclos de máquinas e intervenções administrativas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
            <span>Atualizado agora</span>
          </div>
        </div>
      </div>

      {/* Tabs: the same buttons as the rest of the admin (filled when selected, outlined otherwise) */}
      <div className="flex items-center justify-between">
        <nav aria-label="Seções de Auditoria" className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={tab === 'flows' ? 'default' : 'outline'} onClick={() => pick('flows')} className="gap-2" aria-current={tab === 'flows' ? 'page' : undefined}>
            <ClipboardList className="w-4 h-4 shrink-0" />
            <span>Fluxos do Quiosque</span>
          </Button>
          <Button type="button" size="sm" variant={tab === 'actions' ? 'default' : 'outline'} onClick={() => pick('actions')} className="gap-2" aria-current={tab === 'actions' ? 'page' : undefined}>
            <Settings className="w-4 h-4 shrink-0" />
            <span>Ações de Administração</span>
          </Button>
        </nav>
        <span className="hidden sm:inline-block text-xs text-slate-400">Ambiente de Produção</span>
      </div>

      {tab === 'flows' ? <FlowsPanel /> : <AdminActionsPanel />}
    </div>
  )
}

function FlowsPanel() {
  const today = shopDayKey()
  const [f, setF] = useState({ from: today, to: today, kind: '', method: '', problems: false, machine: '', q: '' })
  const [debounced, setDebounced] = useState(f.q)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState({})
  const seq = React.useRef(0)

  useEffect(() => { const t = setTimeout(() => setDebounced(f.q), 350); return () => clearTimeout(t) }, [f.q])

  const query = React.useCallback((pg) => {
    const q = { limit: 50, page: pg }
    if (f.from) q.from = shopInstant(f.from, '00:00:00').toISOString()
    if (f.to) q.to = shopInstant(f.to, '23:59:59', 999).toISOString()
    if (f.kind) q.kind = f.kind
    if (f.method) q.method = f.method
    if (f.problems) q.problems = '1'
    if (f.machine.trim()) q.machine = f.machine.trim()
    if (debounced.trim()) q.q = debounced.trim()
    return q
  }, [f.from, f.to, f.kind, f.method, f.problems, f.machine, debounced])

  const load = React.useCallback(async (pg = 0) => {
    const my = ++seq.current
    setLoading(true)
    try {
      const r = await api.request('/admin/flows', { method: 'GET', query: query(pg), expect: 'json' })
      if (my !== seq.current) return
      setRows((prev) => (pg === 0 ? r.flows : [...prev, ...r.flows]))
      setTotal(r.total); setPage(pg)
    } catch (e) { if (my === seq.current) toast({ title: e?.body?.error || e?.message || 'Erro', variant: 'destructive' }) }
    finally { if (my === seq.current) setLoading(false) }
  }, [query])

  useEffect(() => { load(0) }, [load])

  async function toggle(row) {
    const id = row.flowId
    if (open[id]) { setOpen((o) => { const n = { ...o }; delete n[id]; return n }); return }
    setOpen((o) => ({ ...o, [id]: { loading: true } }))
    try {
      const flow = await api.request(`/admin/flows/${encodeURIComponent(id)}`, { method: 'GET', expect: 'json' })
      setOpen((o) => ({ ...o, [id]: { flow } }))
    } catch (e) { setOpen((o) => ({ ...o, [id]: { error: e?.body?.error || e?.message || 'Erro' } })) }
  }

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const quick = (from, to) => setF((x) => ({ ...x, from, to }))
  const addDays = (key, n) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  const problemsCount = rows.filter((r) => r.problems > 0).length

  const dur = (a, b) => {
    if (!a || !b) return ''
    const s = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000))
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, '0')}s`
  }
  const offset = (t0, t) => {
    const s = Math.max(0, (new Date(t) - new Date(t0)) / 1000)
    return `+${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }
  const STEP_DOT = (s) => (s.ok === false ? 'bg-rose-500'
    : s.type.startsWith('cash') ? 'bg-emerald-500'
    : s.type.startsWith('impulse') || s.type === 'admin_start' ? 'bg-sky-500'
    : s.type.startsWith('change') || s.type.startsWith('credit') ? 'bg-amber-500'
    : s.type.startsWith('sale') || s.type === 'card_sold' || s.type === 'recharge_done' || s.type === 'mbway_paid' ? 'bg-emerald-600'
    : s.type.startsWith('mbway') ? 'bg-red-400'
    : 'bg-neutral-400')
  const STATUS_TONE = { done: 'ok', problem: 'error', open: 'warn', interrupted: 'warn' }
  const STATUS_DOT = { done: 'bg-emerald-500', problem: 'bg-rose-500', open: 'bg-amber-400', interrupted: 'bg-amber-500' }
  const STATUS_LABEL = { done: 'Concluído', problem: 'Com problemas', open: 'Em curso', interrupted: 'Interrompido' }
  const KINDS = [['', 'Todos os tipos'], ['machine_payment', 'Máquinas'], ['card_purchase', 'Compra de cartão'], ['recharge', 'Carregamento de cartão'], ['mbway', 'MB WAY'], ['refund', 'Devolução de crédito'], ['admin', 'Staff / admin'], ['card', 'Só cartão'], ['other', 'Outros']]
  const KIND_LABEL = Object.fromEntries(KINDS)

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Período:</span>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-1">
              <div className="flex items-center gap-1.5 px-2">
                <label className="text-xs text-slate-400 font-medium">De</label>
                <input type="date" value={f.from} onChange={set('from')} className="border-0 bg-transparent p-0 text-sm font-medium text-slate-700 focus:ring-0 cursor-pointer h-7 w-32" />
              </div>
              <span className="text-slate-300 font-light">até</span>
              <div className="flex items-center gap-1.5 px-2 border-l border-slate-200">
                <label className="text-xs text-slate-400 font-medium">Até</label>
                <input type="date" value={f.to} onChange={set('to')} className="border-0 bg-transparent p-0 text-sm font-medium text-slate-700 focus:ring-0 cursor-pointer h-7 w-32" />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-400 mr-1 hidden sm:inline">Atalhos:</span>
            <Button variant={f.from === today && f.to === today ? 'default' : 'outline'} size="sm" onClick={() => quick(today, today)} className="text-xs h-8">Hoje</Button>
            <Button variant="outline" size="sm" onClick={() => quick(addDays(today, -1), addDays(today, -1))} className="text-xs h-8">Ontem</Button>
            <Button variant="outline" size="sm" onClick={() => quick(addDays(today, -6), today)} className="text-xs h-8">7 dias</Button>
            <Button variant="outline" size="sm" onClick={() => quick('', '')} className="text-xs h-8">Tudo</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de Fluxo</label>
            <Select value={f.kind || '__all__'} onValueChange={(v) => setF((x) => ({ ...x, kind: v === '__all__' ? '' : v }))}>
              <SelectTrigger className="w-full text-sm bg-slate-50/50">
                <SelectValue placeholder="Todos os tipos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os tipos</SelectItem>
                <SelectItem value="machine_payment">Máquinas</SelectItem>
                <SelectItem value="card_purchase">Compra de cartão</SelectItem>
                <SelectItem value="recharge">Carregamento de cartão</SelectItem>
                <SelectItem value="mbway">MB WAY</SelectItem>
                <SelectItem value="refund">Devolução de crédito</SelectItem>
                <SelectItem value="admin">Staff / admin</SelectItem>
                <SelectItem value="card">Só cartão</SelectItem>
                <SelectItem value="other">Outros</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Método</label>
            <Select value={f.method || '__all__'} onValueChange={(v) => setF((x) => ({ ...x, method: v === '__all__' ? '' : v }))}>
              <SelectTrigger className="w-full text-sm bg-slate-50/50">
                <SelectValue placeholder="Todos os métodos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os métodos</SelectItem>
                <SelectItem value="cash">Dinheiro</SelectItem>
                <SelectItem value="card">Cartão</SelectItem>
                <SelectItem value="mbway">MB WAY</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Máquina</label>
            <Input placeholder="Ex: Secar 9..." value={f.machine} onChange={set('machine')} className="w-full text-sm bg-slate-50/50 h-9" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <Select value={f.problems ? 'problems' : '__all__'} onValueChange={(v) => setF((x) => ({ ...x, problems: v === 'problems' }))}>
              <SelectTrigger className="w-full text-sm bg-slate-50/50">
                <SelectValue placeholder="Todos os status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os status</SelectItem>
                <SelectItem value="problems">Só com problemas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="relative w-full sm:max-w-md">
            <Input placeholder="Procurar (cartão, texto…)" value={f.q} onChange={set('q')} className="pl-9 text-sm" />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>
          <label className={`flex items-center gap-2 cursor-pointer select-none border px-3.5 py-1.5 rounded-lg transition self-start sm:self-auto ${f.problems ? 'bg-rose-100 border-rose-300' : 'bg-rose-50 hover:bg-rose-100/80 border-rose-200'}`}>
            <input type="checkbox" checked={f.problems} onChange={set('problems')} className="w-4 h-4 text-rose-600 rounded border-rose-300 focus:ring-rose-500" />
            <span className="text-xs font-semibold text-rose-800 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              Exibir apenas com problemas
            </span>
            {problemsCount > 0 && <span className="bg-rose-200 text-rose-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{problemsCount}</span>}
          </label>
        </div>
      </div>

      {/* Accordion List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700 uppercase tracking-wider">Fluxos Registados</span>
            <span className="bg-slate-200 text-slate-700 text-xs font-bold px-2 py-0.5 rounded-full">{total}</span>
          </div>
          <button type="button" className="text-teal-700 hover:text-teal-900 font-medium transition cursor-pointer" onClick={() => {
            const anyClosed = rows.some(r => !open[r.flowId])
            const newOpen = {}
            if (anyClosed) rows.forEach(r => { newOpen[r.flowId] = true })
            setOpen(newOpen)
          }}>
            Expandir / Recolher Todos
          </button>
        </div>

        {loading && rows.length === 0 ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200/90 p-5 animate-pulse space-y-2">
                <div className="h-4 bg-slate-200 rounded w-1/4" />
                <div className="h-3 bg-slate-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Card className="p-8 text-center text-slate-500">Sem fluxos para estes filtros. Os fluxos do quiosque chegam aqui alguns minutos depois de terminarem.</Card>
        ) : (
          rows.map((r) => {
            const o = open[r.flowId]
            const isOpen = Boolean(o)
            const hasError = r.problems > 0 || r.status === 'problem' || r.status === 'interrupted'

            return (
              <div key={r.flowId} className={`bg-white rounded-2xl border transition duration-150 overflow-hidden ${hasError ? 'border-rose-200/90 hover:border-rose-300' : 'border-slate-200/90 hover:border-slate-300'}`}>
                <button type="button" onClick={() => toggle(r)} className={`w-full text-left px-5 py-3.5 flex items-center gap-4 transition ${hasError ? 'bg-rose-50/20 hover:bg-rose-50/50' : 'hover:bg-slate-50/50'}`}>
                  <span className={`text-slate-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                    <ChevronRight className="w-4 h-4" />
                  </span>
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 shadow-xs border ${STATUS_BOX[STATUS_TONE[r.status] || 'ok']}`}>
                    {STATUS_DOT[r.status] === 'bg-rose-500' ? <AlertTriangle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                  </span>
                  <div className="w-24 flex-shrink-0 leading-tight">
                    <div className="font-mono text-xs font-semibold text-slate-800">{shopTime(r.startedAt)}</div>
                    <div className="text-[11px] text-slate-400">{shopDate(r.startedAt)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 text-sm tracking-tight truncate">{r.title || 'Atividade no quiosque'}</div>
                    <div className="text-xs text-slate-500">{KIND_LABEL[r.kind] || r.kind}{dur(r.startedAt, r.endedAt || r.lastAt) ? ` · ${dur(r.startedAt, r.endedAt || r.lastAt)}` : ''}</div>
                  </div>
                  {r.problems > 0 && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-800"><AlertTriangle className="w-3 w-3" />{r.problems}</span>}
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 px-6 sm:px-12 py-5 bg-white space-y-4">
                    {o.loading && <div className="text-sm text-slate-500">A abrir…</div>}
                    {o.error && <div className="text-sm text-rose-700">{o.error}</div>}
                    {o.flow && (
                      <>
                        <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-slate-600 pb-4 border-b border-slate-100">
                          <span>Estado: <b>{STATUS_LABEL[o.flow.status] || o.flow.status}</b></span>
                          {o.flow.amount > 0 && <span>Valor: <b>{o.flow.amount.toFixed(2).replace('.', ',')} €</b></span>}
                          {o.flow.inserted > 0 && <span>Inserido: <b>{o.flow.inserted.toFixed(2).replace('.', ',')} €</b></span>}
                          {o.flow.change > 0 && <span>Troco: <b>{o.flow.change.toFixed(2).replace('.', ',')} €</b></span>}
                          {o.flow.cardCode && <span>Cartão: <b>•••{o.flow.cardCode}</b></span>}
                        </div>
                        <div className="relative border-l-2 border-slate-200 ml-1.5 space-y-2.5 pl-4 sm:pl-6 before:absolute before:left-[19px] sm:before:left-[27px] before:top-3.5 before:bottom-3.5 before:w-0.5 before:bg-slate-200">
                          {o.flow.steps.map((s, i) => (
                            <div key={i} className="relative flex items-baseline justify-between py-2.5">
                              <div className="flex items-baseline gap-3 pr-4">
                                <span className={`absolute -left-[19px] sm:-left-[27px] top-4 w-2.5 h-2.5 rounded-full ring-4 ring-white ${STEP_DOT(s)}`} />
                                <span className="font-mono text-xs text-slate-400 w-11 flex-shrink-0">{offset(o.flow.startedAt, s.at)}</span>
                                <div>
                                  <span className={`text-sm ${s.ok === false ? 'text-rose-700 font-medium' : 'text-slate-900'}`}>{s.text}</span>
                                  {s.data && Object.values(s.data).some((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length)) && (
                                    <details className="ml-[3.75rem]"><summary className="text-[11px] text-slate-400 cursor-pointer">dados</summary><pre className="text-[11px] bg-white border rounded p-2 mt-1 overflow-x-auto">{JSON.stringify(s.data, null, 2)}</pre></details>
                                  )}
                                </div>
                              </div>
                              <span className="font-mono text-xs text-slate-400 whitespace-nowrap">{shopTime(s.at)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}

        {rows.length < total && (
          <div className="text-center py-4">
            <Button variant="outline" disabled={loading} onClick={() => load(page + 1)}>
              {loading ? 'A carregar…' : `Mostrar mais (${total - rows.length})`}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
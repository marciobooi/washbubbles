import React, { useCallback, useEffect, useRef, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { ChevronRight, ChevronDown, AlertTriangle, Search, RefreshCw } from 'lucide-react'
import { shopDate, shopTime, shopDayKey, shopInstant } from '@/lib/shopTime'

const KINDS = [
  ['', 'Todos os tipos'],
  ['machine_payment', 'Máquinas'],
  ['card_purchase', 'Compra de cartão'],
  ['recharge', 'Carregamento de cartão'],
  ['mbway', 'MB WAY'],
  ['refund', 'Devolução de crédito'],
  ['admin', 'Staff / admin'],
  ['card', 'Só cartão'],
  ['other', 'Outros'],
]
const KIND_LABEL = Object.fromEntries(KINDS)
const METHODS = [['', 'Todos os métodos'], ['cash', 'Dinheiro'], ['card', 'Cartão'], ['mbway', 'MB WAY']]
const STATUS_DOT = { done: 'bg-emerald-500', problem: 'bg-rose-500', open: 'bg-amber-400', interrupted: 'bg-amber-500' }
const STATUS_LABEL = { done: 'Concluído', problem: 'Com problemas', open: 'Em curso', interrupted: 'Interrompido' }
// a colour for the kind of step, so a long timeline can be read at a glance
const STEP_DOT = (s) => (s.ok === false ? 'bg-rose-500'
  : s.type.startsWith('cash') ? 'bg-emerald-500'
  : s.type.startsWith('impulse') || s.type === 'admin_start' ? 'bg-sky-500'
  : s.type.startsWith('change') || s.type.startsWith('credit') ? 'bg-amber-500'
  : s.type.startsWith('sale') || s.type === 'card_sold' || s.type === 'recharge_done' || s.type === 'mbway_paid' ? 'bg-emerald-600'
  : s.type.startsWith('mbway') ? 'bg-red-400'
  : 'bg-neutral-400')

const dur = (a, b) => {
  if (!a || !b) return ''
  const s = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, '0')}s`
}
const offset = (t0, t) => {
  const s = Math.max(0, (new Date(t) - new Date(t0)) / 1000)
  return `+${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
const addDays = (key, n) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const errText = (e) => e?.body?.error || e?.message || 'Erro'

export default function FlowsPanel() {
  const today = shopDayKey()
  const [f, setF] = useState({ from: today, to: today, kind: '', method: '', problems: false, machine: '', q: '' })
  const [debounced, setDebounced] = useState(f.q)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState({}) // flowId -> { loading, flow }
  const seq = useRef(0)

  useEffect(() => { const t = setTimeout(() => setDebounced(f.q), 350); return () => clearTimeout(t) }, [f.q])

  const query = useCallback((pg) => {
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

  const load = useCallback(async (pg = 0) => {
    const my = ++seq.current
    setLoading(true)
    try {
      const r = await api.request('/admin/flows', { method: 'GET', query: query(pg), expect: 'json' })
      if (my !== seq.current) return
      setRows((prev) => (pg === 0 ? r.flows : [...prev, ...r.flows]))
      setTotal(r.total); setPage(pg)
    } catch (e) { if (my === seq.current) toast({ title: errText(e), variant: 'destructive' }) }
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
    } catch (e) { setOpen((o) => ({ ...o, [id]: { error: errText(e) } })) }
  }

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const quick = (from, to) => setF((x) => ({ ...x, from, to }))
  const problemsCount = rows.filter((r) => r.problems > 0).length

  return (
    <div className="space-y-4">
      {/* filters */}
      <div className="bg-white rounded-xl border p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-neutral-500">De<input type="date" value={f.from} onChange={set('from')} className="block border rounded px-2 py-1.5 text-sm mt-0.5" /></label>
        <label className="text-xs text-neutral-500">Até<input type="date" value={f.to} onChange={set('to')} className="block border rounded px-2 py-1.5 text-sm mt-0.5" /></label>
        <div className="flex gap-1.5">
          <button type="button" className="abtn abtn-sm" onClick={() => quick(today, today)}>Hoje</button>
          <button type="button" className="abtn abtn-sm" onClick={() => quick(addDays(today, -1), addDays(today, -1))}>Ontem</button>
          <button type="button" className="abtn abtn-sm" onClick={() => quick(addDays(today, -6), today)}>7 dias</button>
          <button type="button" className="abtn abtn-sm" onClick={() => quick('', '')}>Tudo</button>
        </div>
        <select value={f.kind} onChange={set('kind')} className="border rounded px-2 py-1.5 text-sm">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select value={f.method} onChange={set('method')} className="border rounded px-2 py-1.5 text-sm">{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input placeholder="Máquina (ex.: Secar 9)" value={f.machine} onChange={set('machine')} className="border rounded px-2 py-1.5 text-sm w-44" />
        <div className="relative"><Search className="h-4 w-4 absolute left-2 top-2 text-neutral-400" /><input placeholder="Procurar (cartão, texto…)" value={f.q} onChange={set('q')} className="border rounded pl-8 pr-2 py-1.5 text-sm w-56" /></div>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={f.problems} onChange={set('problems')} /> Só com problemas</label>
        <button type="button" className="abtn abtn-sm" onClick={() => load(0)}><RefreshCw /> Atualizar</button>
      </div>

      <div className="text-sm text-neutral-500 px-1">
        {loading && rows.length === 0 ? 'A carregar…' : `${total} fluxo${total === 1 ? '' : 's'}${problemsCount ? ` · ${problemsCount} com problemas nesta lista` : ''}`}
      </div>

      {/* list */}
      <div className="space-y-2">
        {rows.map((r) => {
          const o = open[r.flowId]
          return (
            <div key={r.flowId} className="bg-white rounded-xl border overflow-hidden">
              <button type="button" onClick={() => toggle(r)} className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-neutral-50">
                {o ? <ChevronDown className="h-4 w-4 text-neutral-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-neutral-400 shrink-0" />}
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_DOT[r.status] || 'bg-neutral-300'}`} title={STATUS_LABEL[r.status]} />
                <div className="w-[7.5rem] shrink-0 text-xs text-neutral-500 tabular-nums"><div className="font-medium text-neutral-700">{shopTime(r.startedAt)}</div><div>{shopDate(r.startedAt)}</div></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{r.title || 'Atividade no quiosque'}</div>
                  <div className="text-xs text-neutral-500">{KIND_LABEL[r.kind] || r.kind}{dur(r.startedAt, r.endedAt || r.lastAt) ? ` · ${dur(r.startedAt, r.endedAt || r.lastAt)}` : ''}</div>
                </div>
                {r.problems > 0 && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-800"><AlertTriangle className="h-3 w-3" />{r.problems}</span>}
              </button>
              {o && (
                <div className="border-t bg-neutral-50/60 px-4 py-3">
                  {o.loading && <div className="text-sm text-neutral-500">A abrir…</div>}
                  {o.error && <div className="text-sm text-rose-700">{o.error}</div>}
                  {o.flow && (
                    <>
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-600 mb-3">
                        <span>Estado: <b>{STATUS_LABEL[o.flow.status] || o.flow.status}</b></span>
                        {o.flow.amount > 0 && <span>Valor: <b>{o.flow.amount.toFixed(2).replace('.', ',')} €</b></span>}
                        {o.flow.inserted > 0 && <span>Inserido: <b>{o.flow.inserted.toFixed(2).replace('.', ',')} €</b></span>}
                        {o.flow.change > 0 && <span>Troco: <b>{o.flow.change.toFixed(2).replace('.', ',')} €</b></span>}
                        {o.flow.cardCode && <span>Cartão: <b>•••{o.flow.cardCode}</b></span>}
                      </div>
                      <ol className="relative border-l-2 border-neutral-200 ml-1.5 space-y-2.5">
                        {o.flow.steps.map((s, i) => (
                          <li key={i} className="ml-4 relative">
                            <span className={`absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${STEP_DOT(s)}`} />
                            <div className="flex items-baseline gap-3">
                              <span className="text-xs tabular-nums text-neutral-400 w-12 shrink-0">{offset(o.flow.startedAt, s.at)}</span>
                              <span className={`text-sm ${s.ok === false ? 'text-rose-700 font-medium' : 'text-neutral-800'}`}>{s.text}</span>
                              <span className="text-[11px] text-neutral-400 tabular-nums ml-auto shrink-0">{shopTime(s.at)}</span>
                            </div>
                            {s.data && Object.keys(s.data).length > 0 && (
                              <details className="ml-[3.75rem]"><summary className="text-[11px] text-neutral-400 cursor-pointer">dados</summary><pre className="text-[11px] bg-white border rounded p-2 mt-1 overflow-x-auto">{JSON.stringify(s.data, null, 2)}</pre></details>
                            )}
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {!loading && rows.length === 0 && <div className="text-sm text-neutral-500 text-center p-8 bg-white rounded-xl border">Sem fluxos para estes filtros. Os fluxos do quiosque chegam aqui alguns minutos depois de terminarem.</div>}
      </div>

      {rows.length < total && (
        <div className="text-center"><button type="button" className="abtn" disabled={loading} onClick={() => load(page + 1)}>{loading ? 'A carregar…' : `Mostrar mais (${total - rows.length})`}</button></div>
      )}
    </div>
  )
}

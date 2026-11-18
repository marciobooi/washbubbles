/**
 * Flows: every customer action recorded as ONE log with its steps (models/flow.js).
 *
 *   step(tenantId, type, text, data, opts)   add a step to the flow that is open for this shop (or open a new one)
 *   flowRoute(label)                         Express middleware: records "<label> requested" and the answer (ok / refused + why)
 *   closeIdle()                              flows idle for IDLE_MS are closed (done/problem), and handed to the central uplink
 *
 * It NEVER throws and never waits for the database: a problem here must not touch a payment.
 * A new customer (money or a card arriving after the last flow was paid) starts a new flow.
 */
import crypto from 'crypto'
import Flow from '../models/flow.js'
import modelEvents from './modelEvents.js'

const IDLE_MS = 90_000
const MAX_STEPS = 300
const open = new Map() // tenantId -> in-memory copy of the open flow

const eur = (n) => `${Number(n || 0).toFixed(2).replace('.', ',')} €`
export { eur as _eur }

/** Steps that mean "the money part of this flow is over": whatever arrives next that starts something is a NEW customer. */
const PAID_TYPES = new Set(['sale_recorded', 'recharge_done', 'card_sold', 'mbway_paid'])
/** Steps that start something (a new customer). */
const STARTERS = new Set(['cash_in', 'card_in', 'cart_selected', 'pay_requested'])

function kindOf(type, current, recharge) {
  if (type === 'card_sold' || type === 'card_purchase_requested') return 'card_purchase'
  if (type === 'recharge_done' || type === 'recharge_requested') return 'recharge'
  if (type.startsWith('mbway')) return current === 'other' || current === 'machine_payment' ? 'mbway' : current
  if (type === 'sale_recorded' && recharge && (current === 'other' || current === 'card' || current === 'machine_payment')) return 'recharge'
  if (type === 'impulse_sent' || type === 'sale_recorded') return current === 'other' || current === 'card' ? 'machine_payment' : current
  if (type === 'credit_refunded' || type === 'credit_refund_short') return current === 'other' ? 'refund' : current
  if (type === 'admin_start' || type === 'admin_release') return 'admin'
  if (type === 'card_in' && current === 'other') return 'card'
  return current
}

function newFlow(tenantId, at) {
  return { tenantId, flowId: crypto.randomUUID(), kind: 'other', status: 'open', startedAt: at, lastAt: at, title: '', machines: [], cardCode: '', method: '', amount: 0, inserted: 0, change: 0, problems: 0, steps: [], paid: false, dirty: true }
}

function titleOf(f) {
  const names = f.machines.length ? f.machines.join(', ') : ''
  const how = f.method === 'mbway' ? 'MB WAY' : f.method === 'card' ? 'cartão' : f.method === 'cash' ? 'dinheiro' : ''
  switch (f.kind) {
    case 'machine_payment': return `${names || 'Máquina'}${how ? ` · pago com ${how}` : ''}${f.amount ? ` · ${eur(f.amount)}` : ''}${f.change ? ` · troco ${eur(f.change)}` : ''}`
    case 'card_purchase': return `Compra de cartão${f.cardCode ? ` •••${f.cardCode}` : ''}${how ? ` · ${how}` : ''}${f.amount ? ` · ${eur(f.amount)}` : ''}`
    case 'recharge': return `Carregamento de cartão${f.cardCode ? ` •••${f.cardCode}` : ''}${f.amount ? ` · ${eur(f.amount)}` : ''}${how ? ` · ${how}` : ''}${f.change ? ` · troco ${eur(f.change)}` : ''}`
    case 'mbway': return `MB WAY${names ? ` · ${names}` : ''}${f.amount ? ` · ${eur(f.amount)}` : ''}`
    case 'refund': return `Devolução de crédito${f.change ? ` · ${eur(f.change)}` : ''}`
    case 'admin': return `Ação do staff${names ? ` · ${names}` : ''}`
    case 'card': return `Cartão${f.cardCode ? ` •••${f.cardCode}` : ''}`
    default: return f.inserted ? `Dinheiro inserido · ${eur(f.inserted)}` : 'Atividade no quiosque'
  }
}

// Saves of one flow never overlap: the LAST state always wins (concurrent upserts could finish in any order and leave an older one).
function persist(f) {
  if (f.saving) { f.saveAgain = true; return f.saving }
  f.saving = (async () => {
    do { f.saveAgain = false; await persistNow(f) } while (f.saveAgain)
  })().finally(() => { f.saving = null })
  return f.saving
}

function persistNow(f) {
  const doc = {
    kind: f.kind, status: f.status, lastAt: f.lastAt, endedAt: f.endedAt || null, title: f.title, machines: f.machines, cardCode: f.cardCode,
    method: f.method, amount: f.amount, inserted: f.inserted, change: f.change, problems: f.problems, steps: f.steps.slice(-MAX_STEPS),
  }
  return Flow.updateOne({ tenantId: f.tenantId, flowId: f.flowId }, { $set: doc, $setOnInsert: { startedAt: f.startedAt } }, { upsert: true })
    .catch((e) => console.warn('[Flow] not saved:', e.message))
}

function close(f, status) {
  // a refusal the customer then corrected (paid afterwards) is not a problem
  if (f.paid) f.problems = f.steps.filter((s) => s.ok === false && s.type !== 'pay_refused').length
  f.status = status || (f.problems ? 'problem' : 'done')
  f.endedAt = new Date()
  f.title = titleOf(f)
  open.delete(String(f.tenantId))
  persist(f).then(() => modelEvents.emit('flow:closed', { tenantId: f.tenantId, flowId: f.flowId }))
}

/**
 * @param opts { ok=true, machine, cardCode, method, amount, inserted, change }  what to fold into the flow's header
 */
export function step(tenantId, type, text, data = null, opts = {}) {
  try {
    if (!tenantId) return
    const key = String(tenantId)
    const at = new Date()
    let f = open.get(key)
    // someone new arrives after the last customer was paid: close that flow, open another
    if (f && f.paid && STARTERS.has(type)) { close(f); f = null }
    if (!f) { f = newFlow(tenantId, at); open.set(key, f) }
    f.lastAt = at
    const ok = opts.ok !== false
    if (!ok) f.problems += 1
    // A staff start (or any impulse) of a machine this customer did not ask for lands in whatever flow is open at that moment (2026-11-12:
    // the second impulse of a dryer the staff had started two minutes before showed up in a customer's payment, and its machine in the title).
    // When the flow knows what the customer asked for, such an impulse is kept as a step but marked foreign, and never joins the header.
    const foreign = type === 'impulse_sent' && f.requested?.size > 0 && opts.machine && !f.requested.has(String(opts.machine))
    if (foreign) { data = { ...(data || {}), foreign: true }; opts = { ...opts, machine: undefined } }
    f.steps.push({ at, type, text: foreign ? `${text} (arranque de outra ação, não deste cliente)` : text, ok, data })
    if (Array.isArray(data?.items) && data.items.some((i) => /recarga/i.test(String(i)))) f.recharge = true
    f.kind = kindOf(type, f.kind, f.recharge)
    if (opts.machine && !f.machines.includes(opts.machine)) f.machines.push(opts.machine)
    if (opts.cardCode) f.cardCode = String(opts.cardCode).slice(-4)
    if (opts.method) f.method = opts.method
    if (Number.isFinite(opts.amount)) f.amount = Math.round((f.amount + opts.amount) * 100) / 100
    if (Number.isFinite(opts.inserted)) f.inserted = Math.round((f.inserted + opts.inserted) * 100) / 100
    if (Number.isFinite(opts.change)) f.change = Math.round((f.change + opts.change) * 100) / 100
    if (PAID_TYPES.has(type)) f.paid = true
    f.title = titleOf(f)
    persist(f)
  } catch (e) { console.warn('[Flow] step failed:', e.message) }
}

/** Close the flows nobody has touched for a while. Also called at start for flows a restart left open. */
export async function closeIdle({ all = false } = {}) {
  const now = Date.now()
  for (const f of [...open.values()]) if (all || now - f.lastAt.getTime() >= IDLE_MS) close(f)
}
/** Is a flow open that something happened in less than `ms` ago? The updater waits for it before restarting (a restart would mark it 'interrupted'). */
export function hasRecentOpen(ms = 150_000) {
  const now = Date.now()
  return [...open.values()].some((f) => now - f.lastAt.getTime() < ms)
}

/** Close every open flow NOW, normally (done/problem), and wait until they are saved: used before the server stops. */
export async function closeAll() {
  const list = [...open.values()]
  for (const f of list) close(f)
  await Promise.all(list.map((f) => f.saving).filter(Boolean))
}

export async function closeInterrupted() {
  // flows a power cut / restart left 'open' in the database: mark them and send them
  const stale = await Flow.find({ status: 'open', lastAt: { $lt: new Date(Date.now() - IDLE_MS) } }).select('tenantId flowId').lean().catch(() => [])
  for (const s of stale) {
    await Flow.updateOne({ tenantId: s.tenantId, flowId: s.flowId, status: 'open' }, { $set: { status: 'interrupted', endedAt: new Date() } }).catch(() => {})
    modelEvents.emit('flow:closed', { tenantId: s.tenantId, flowId: s.flowId })
  }
}

let timer = null
export function startFlowTimer() {
  if (timer) return
  closeInterrupted().catch(() => {})
  timer = setInterval(() => closeIdle().catch(() => {}), 20_000)
  timer.unref?.()
}
export function _reset() { open.clear() }
export function _peek(tenantId) { return open.get(String(tenantId)) }

/** Has this flow already recorded one of these sales? */
function alreadyRecorded(f, sales) {
  if (!f) return false
  const ids = new Set(sales.map((x) => String(x._id)))
  return f.steps.some((s) => s.type === 'sale_recorded' && Array.isArray(s.data?.saleIds) && s.data.saleIds.some((id) => ids.has(id)))
}

const names = (items) => (Array.isArray(items) ? items.map((i) => i && (i.name || i.type)).filter(Boolean).slice(0, 8) : [])

/**
 * Express middleware for a route that moves money or machines. Records the request (what the customer asked for) and the answer
 * (done, or refused and WHY), whatever path the handler takes out.
 */
export function flowRoute(label, { type = 'pay_requested', method } = {}) {
  return (req, res, next) => {
    try {
      const tenantId = req.tenantId
      const b = req.body || {}
      const list = names(b.items)
      const insertedNote = Number.isFinite(Number(b.inserted)) && Number(b.inserted) > 0 ? ` · inserido ${eur(b.inserted)}` : ''
      step(tenantId, type, `${label}${list.length ? `: ${list.join(', ')}` : ''}${insertedNote}`, { items: list, inserted: b.inserted ?? null }, { method: method || (b.method === 'cash' ? 'cash' : undefined) })
      const f = open.get(String(tenantId))
      if (f) { for (const n of list) if (!f.machines.includes(n) && !/recarga/i.test(n)) f.machines.push(n); f.title = titleOf(f) }
      if (f) { f.requested = f.requested || new Set(); for (const n of list) f.requested.add(String(n)) }
      const origJson = res.json.bind(res)
      res.json = (body) => {
        try {
          if (res.statusCode >= 400) {
            step(tenantId, 'pay_refused', `Recusado: ${body?.error || `erro ${res.statusCode}`}`, { status: res.statusCode, code: body?.code || null }, { ok: false })
          } else if (Array.isArray(body?.sales) && body.sales.length && alreadyRecorded(open.get(String(tenantId)), body.sales)) {
            // the same payment asked for twice (the screen gave up waiting and sent it again): answered with what was recorded, counted once
            step(tenantId, 'sale_replayed', 'Pedido repetido: a venda já estava registada, não foi cobrada outra vez', { saleIds: body.sales.map((x) => String(x._id)) })
          } else if (Array.isArray(body?.sales) && body.sales.length) {
            const amount = body.sales.reduce((sum, x) => sum + (Number(x.amount) || 0), 0)
            const m = body.sales[0].method
            step(tenantId, 'sale_recorded', `Venda registada · ${eur(amount)} · ${m === 'cash' ? 'dinheiro' : m === 'card' ? 'cartão' : m}`, { saleIds: body.sales.map((x) => String(x._id)) }, { amount, method: m })
          } else if (body?.cardPurchase && body?.sale) {
            step(tenantId, 'card_sold', `Cartão vendido •••${String(body.card?.code || '').slice(-4)} · ${eur(body.sale.amount)}`, { saleId: String(body.sale._id) }, { amount: Number(body.sale.amount) || 0, method: body.sale.method, cardCode: body.card?.code })
          } else if (body?.sale && body.sale.type === 'recharge') {
            step(tenantId, 'recharge_done', `Carregamento de ${eur(body.sale.amount)}${body.card?.balance != null ? ` · saldo ${eur(body.card.balance)}` : ''}`, { saleId: String(body.sale._id) }, { amount: Number(body.sale.amount) || 0, method: body.sale.method, cardCode: body.card?.code || body.sale.cardCode })
          }
        } catch { /* never in the way */ }
        return origJson(body)
      }
    } catch { /* never in the way */ }
    next()
  }
}

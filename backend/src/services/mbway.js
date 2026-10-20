/**
 * MB WAY payments for the kiosk (Eupago). The money flow, in order:
 *   start  -> the cart is priced HERE (cash prices, never the screen's number), a payment row is saved, Eupago asks the
 *             customer's phone to approve (5 minutes)
 *   poll   -> the kiosk asks every ~2 s; we read the state straight from Eupago; when it says PAID the machines start
 *             (exactly once: the row flips pending -> paid atomically) and the sales are booked with method "mbway"
 *   sweep  -> every 30 s, payments nobody is polling (the customer left, the screen crashed) are still followed to the end,
 *             so a payment that arrives late is never lost: it is started, or reported to the operator.
 * Only machines can be paid this way: a recharge or a card purchase is money onto a card and is cash only (owner's rule).
 */
import MbwayPayment from '../models/mbwayPayment.js'
import Setting from '../models/setting.js'
import Machine from '../models/machine.js'
import Sale from '../models/sale.js'
import Price from '../models/price.js'
import { withTenant } from './tenant.js'
import { createMbway, referenceState, normalizePhone, maskPhone } from './eupago.js'
import { roundMoney } from '../utils/money.js'
import { findUsableCoupon, redeemCoupon } from './coupons.js'

export const WINDOW_MS = 5 * 60 * 1000       // what the customer has to approve
const GRACE_MS = 60 * 1000                    // we keep asking a little after it
const SWEEP_UNTIL_MS = 8 * 60 * 1000
export const MIN_AMOUNT = 1                   // the smallest Eupago accepted (0.50 was AMOUNT_INVALID)

let fetchImpl = (...a) => globalThis.fetch(...a)
export function _setFetch(f) { fetchImpl = f || ((...a) => globalThis.fetch(...a)) }

const err = (status, code, message) => Object.assign(new Error(message || code), { status, code })

export async function mbwaySettings(tenantId) {
  const rows = await Setting.find({ tenantId, key: { $in: ['payments.mbway.enabled', 'payments.mbway.apiKey', 'payments.mbway.env'] } }).lean()
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const on = m['payments.mbway.enabled']
  return {
    enabled: on === true || on === 'true' || on === 1 || on === '1',
    apiKey: String(m['payments.mbway.apiKey'] || '').trim(),
    env: m['payments.mbway.env'] === 'production' ? 'production' : 'sandbox',
  }
}

export async function startPayment({ tenantId, items, phone, batchId, couponCode }, { resolveMachineLines, isRecharge }) {
  const cfg = await mbwaySettings(tenantId)
  if (!cfg.enabled || !cfg.apiKey) throw err(409, 'mbway-off', 'MB WAY is not available')
  if (!Array.isArray(items) || items.length === 0) throw err(400, 'empty-cart', 'Empty cart')
  if (items.some(isRecharge)) throw err(400, 'mbway-machines-only', 'MB WAY pays machines only; a recharge is paid in cash')
  const p9 = normalizePhone(phone)
  if (!p9) throw err(400, 'bad-phone', 'Invalid phone number')

  const coupon = couponCode ? await findUsableCoupon(tenantId, couponCode) : null
  const resolved = await resolveMachineLines(items, withTenant(Machine, { tenantId }), withTenant(Price, { tenantId }), 'cash', coupon)
  if (!resolved.ok) throw Object.assign(err(resolved.status, 'cart-refused', resolved.error?.error || 'Cart refused'), { detail: resolved.error })
  if (resolved.total < MIN_AMOUNT) throw err(400, 'below-minimum', `MB WAY needs at least ${MIN_AMOUNT.toFixed(2)} EUR`)

  const identifier = `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const now = Date.now()
  const payment = await MbwayPayment.create({
    tenantId, identifier, batchId, amount: resolved.total, phone: maskPhone(p9), couponCode: coupon ? coupon.code : '',
    lines: resolved.lines.map((l) => ({ machineId: l.machine._id, blocks: l.blocks, price: l.price, name: l.machine.name })),
    status: 'pending', expiresAt: new Date(now + WINDOW_MS),
  })
  const r = await createMbway({ env: cfg.env, apiKey: cfg.apiKey, amount: resolved.total, phone: p9, identifier, fetchImpl })
  if (!r.ok) {
    await MbwayPayment.updateOne({ _id: payment._id }, { $set: { status: 'failed', error: `${r.code} ${r.text}`.trim() } })
    throw Object.assign(err(502, 'eupago-refused', r.text), { eupagoCode: r.code })
  }
  const saved = await MbwayPayment.findByIdAndUpdate(payment._id, { $set: { reference: r.reference, transactionId: r.transactionId } }, { new: true })
  return view(saved)
}

export const view = (p) => ({
  id: String(p._id), status: p.status, amount: p.amount, phone: p.phone, reference: p.reference,
  expiresAt: p.expiresAt, error: p.error || '', machines: (p.lines || []).map((l) => l.name),
})

async function startMachines(p) {
  const { default: coinMachine } = await import('./coinMachine.js')
  const { broadcastMachine } = await import('../wsServer.js')
  const started = []
  const failed = []
  for (const l of p.lines) {
    try { await coinMachine.startPaidMachine(l.machineId, l.blocks); started.push(l) } catch (e) { failed.push({ l, message: e.message }) }
  }
  const saleIds = []
  for (const l of started) {
    const sale = await Sale.create({
      tenantId: p.tenantId, machineId: l.machineId, amount: l.price, items: [{ name: l.name, quantity: l.blocks }],
      method: 'mbway', batchId: p.batchId, inserted: 0, change: 0, type: 'payment',
      metadata: { mbway: true, eupago: { reference: p.reference, transactionId: p.transactionId, identifier: p.identifier } },
    })
    saleIds.push(sale._id)
    const m = await Machine.findOneAndUpdate({ _id: l.machineId, tenantId: p.tenantId, status: { $ne: 'working' } }, { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } }, { new: true })
    if (m) { try { await broadcastMachine(m) } catch { /* the screen refreshes by itself */ } }
  }
  if (p.couponCode && started.length) await redeemCoupon(p.tenantId, p.couponCode).catch(() => {})
  return { saleIds, failed }
}

async function alertOperator(tenantId, subject, message) {
  try { const { sendAlertForTenant } = await import('./alerts.js'); await sendAlertForTenant(tenantId, subject, message) } catch { /* logged by the caller */ }
  console.error(`[MBWAY] ${subject}: ${message}`)
}

/** The row flips pending -> paid exactly once, and only the one that flipped it starts the machines. */
async function finalizePaid(p) {
  const flipped = await MbwayPayment.findOneAndUpdate({ _id: p._id, status: 'pending' }, { $set: { status: 'paid', paidAt: new Date() } }, { new: true })
  if (!flipped) return MbwayPayment.findById(p._id)
  const { saleIds, failed } = await startMachines(flipped)
  const owed = roundMoney(failed.reduce((s, f) => s + f.l.price, 0))
  const done = await MbwayPayment.findByIdAndUpdate(flipped._id, {
    $set: failed.length
      ? { status: 'start_failed', startedAt: saleIds.length ? new Date() : undefined, saleIds, error: `Pago, mas não arrancou: ${failed.map((f) => `${f.l.name} (${f.message})`).join('; ')}. A devolver ao cliente: ${owed.toFixed(2)} EUR` }
      : { status: 'started', startedAt: new Date(), saleIds },
  }, { new: true })
  if (failed.length) await alertOperator(p.tenantId, 'MB WAY pago mas a máquina não arrancou', `Referência ${p.reference}. ${done.error}. Devolver o valor no backoffice do Eupago.`)
  return done
}

/** One look at Eupago for a payment, and whatever follows from the answer. */
async function check(p) {
  const cfg = await mbwaySettings(p.tenantId)
  await MbwayPayment.updateOne({ _id: p._id }, { $set: { lastPolledAt: new Date() } })
  const late = Date.now() > p.expiresAt.getTime() + GRACE_MS
  if (!cfg.apiKey) return p
  const r = await referenceState({ env: cfg.env, apiKey: cfg.apiKey, reference: p.reference, fetchImpl })
  if (r.state === 'paid') {
    if (p.status === 'pending') return finalizePaid(p)
    if (p.status === 'cancelled') {
      const upd = await MbwayPayment.findOneAndUpdate({ _id: p._id, status: 'cancelled' }, { $set: { status: 'paid_unclaimed', paidAt: new Date(), error: 'Pago depois de o cliente cancelar no ecrã' } }, { new: true })
      if (upd) await alertOperator(p.tenantId, 'MB WAY pago depois de cancelado', `Referência ${p.reference}, ${p.amount.toFixed(2)} EUR (${p.phone}). Iniciar a máquina à mão ou devolver o valor no backoffice do Eupago.`)
      return upd || p
    }
    return p
  }
  if (p.status === 'pending' && r.state === 'failed') return MbwayPayment.findOneAndUpdate({ _id: p._id, status: 'pending' }, { $set: { status: 'failed', error: `Eupago: ${r.raw}` } }, { new: true })
  if (p.status === 'pending' && late) return MbwayPayment.findOneAndUpdate({ _id: p._id, status: 'pending' }, { $set: { status: 'expired' } }, { new: true })
  return p
}

export async function pollPayment({ tenantId, id }) {
  const p = await MbwayPayment.findOne({ _id: id, tenantId })
  if (!p) throw err(404, 'not-found', 'Payment not found')
  if (p.status !== 'pending') return view(p)
  if (p.lastPolledAt && Date.now() - p.lastPolledAt.getTime() < 1200) return view(p) // do not hammer Eupago
  return view((await check(p)) || p)
}

export async function cancelPayment({ tenantId, id }) {
  const p = await MbwayPayment.findOneAndUpdate({ _id: id, tenantId, status: 'pending' }, { $set: { status: 'cancelled' } }, { new: true })
  if (p) return view(p)
  const cur = await MbwayPayment.findOne({ _id: id, tenantId })
  if (!cur) throw err(404, 'not-found', 'Payment not found')
  return view(cur) // already paid / expired / ...: nothing to cancel
}

/** Follow every payment nobody is polling any more (and the cancelled ones) until Eupago's window is over. */
export async function sweep() {
  const since = new Date(Date.now() - SWEEP_UNTIL_MS)
  const stale = new Date(Date.now() - 15000)
  const list = await MbwayPayment.find({ status: { $in: ['pending', 'cancelled'] }, reference: { $ne: '' }, createdAt: { $gte: since }, $or: [{ lastPolledAt: null }, { lastPolledAt: { $lt: stale } }] }).limit(25)
  for (const p of list) { try { await check(p) } catch (e) { console.error('[MBWAY] sweep:', e.message) } }
  // anything still pending far past the window is over
  await MbwayPayment.updateMany({ status: 'pending', expiresAt: { $lt: new Date(Date.now() - 4 * 60 * 1000) } }, { $set: { status: 'expired' } })
}

let timer = null
export function startSweeper(ms = 30000) {
  if (timer) return
  timer = setInterval(() => { sweep().catch((e) => console.error('[MBWAY] sweep failed:', e.message)) }, ms)
  timer.unref?.()
}

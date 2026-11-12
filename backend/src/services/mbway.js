/**
 * MB WAY payments for the kiosk (Eupago). The money flow, in order:
 *   start  -> the cart is priced HERE (cash prices, never the screen's number), a payment row is saved, Eupago asks the
 *             customer's phone to approve (5 minutes)
 *   poll   -> the kiosk asks every ~2 s; we read the state straight from Eupago; when it says PAID the machines start
 *             (exactly once: the row flips pending -> paid atomically) and the sales are booked with method "mbway"
 *   sweep  -> every 30 s, payments nobody is polling (the customer left, the screen crashed) are still followed to the end,
 *             so a payment that arrives late is never lost: it is started, or reported to the operator.
 * Three kinds can be paid this way (field `kind`): a cart of MACHINES, a NEW CARD, or a RECHARGE of the card in the reader (the last two
 * from 2026-11-03, the owner's decision; they run the same steps as the cash routes minus the cash: services/mbwayCards.js).
 */
import MbwayPayment from '../models/mbwayPayment.js'
import Setting from '../models/setting.js'
import Machine from '../models/machine.js'
import Sale from '../models/sale.js'
import Price from '../models/price.js'
import { withTenant } from './tenant.js'
import { createMbway, referenceState, normalizePhone, maskPhone, isKnownState } from './eupago.js'
import { roundMoney } from '../utils/money.js'
import * as flows from './flows.js'
import { findUsableCoupon, redeemCoupon } from './coupons.js'

export const WINDOW_MS = 5 * 60 * 1000       // what the customer has to approve
const GRACE_MS = 60 * 1000                    // we keep asking a little after it
const SWEEP_UNTIL_MS = 8 * 60 * 1000
const STUCK_PAID_MS = 3 * 60 * 1000 // far longer than starting the machines or releasing a card ever takes
export const MIN_AMOUNT = 1                   // the smallest Eupago accepted (0.50 was AMOUNT_INVALID)

let fetchImpl = (...a) => globalThis.fetch(...a)
export function _setFetch(f) { fetchImpl = f || ((...a) => globalThis.fetch(...a)) }

const err = (status, code, message) => Object.assign(new Error(message || code), { status, code })

export async function mbwaySettings(tenantId) {
  const rows = await Setting.find({ tenantId, key: { $in: ['payments.mbway.enabled', 'payments.mbway.apiKey', 'payments.mbway.env', 'payments.mbway.qr', 'payments.mbway.typed'] } }).lean()
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const on = m['payments.mbway.enabled']
  // The two ways to give the number: the QR (phone camera) and the box at the kiosk. Both are on unless the admin switched one off.
  const way = (v) => !(v === false || v === 'false' || v === 0 || v === '0')
  return {
    enabled: on === true || on === 'true' || on === 1 || on === '1',
    qr: way(m['payments.mbway.qr']),
    typed: way(m['payments.mbway.typed']),
    apiKey: String(m['payments.mbway.apiKey'] || '').trim(),
    env: m['payments.mbway.env'] === 'production' ? 'production' : 'sandbox',
  }
}

/** Price a cart of machines from the server's own tables and check it can be paid with MB WAY. Throws a coded error otherwise. */
export async function priceCart({ tenantId, items, couponCode, kind = 'machines', amount, cardCode }, { resolveMachineLines, isRecharge, cardInReader }) {
  const cfg = await mbwaySettings(tenantId)
  if (!cfg.enabled || !cfg.apiKey) throw err(409, 'mbway-off', 'MB WAY is not available')
  // A NEW CARD: the price and the starting credit are the shop's own settings, never the screen's figure.
  if (kind === 'card_purchase') {
    const rows = await Setting.find({ tenantId, key: { $in: ['loyaltyCard.cost', 'loyaltyCard.credit'] } }).lean()
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    const price = roundMoney(m['loyaltyCard.cost'] ?? 0)
    const credit = roundMoney(m['loyaltyCard.credit'] ?? 0)
    if (!(price > 0)) throw err(409, 'card-price-missing', 'Card purchase price not configured')
    if (price < MIN_AMOUNT) throw err(400, 'below-minimum', `MB WAY needs at least ${MIN_AMOUNT.toFixed(2)} EUR`)
    const { default: Peripheral } = await import('../models/peripheral.js')
    if (!(await withTenant(Peripheral, { tenantId }).findOne({ type: 'card_dispenser', enabled: true }))) throw err(409, 'no-dispenser', 'No card dispenser configured')
    return { cfg, coupon: null, resolved: { total: price, lines: [] }, extra: { price, credit } }
  }
  // A RECHARGE: the card is the one in the reader RIGHT NOW (the shop's own reading, not what the screen says).
  if (kind === 'recharge') {
    const value = roundMoney(Number(amount))
    if (!Number.isFinite(value) || value < MIN_AMOUNT) throw err(400, 'below-minimum', `MB WAY needs at least ${MIN_AMOUNT.toFixed(2)} EUR`)
    if (value > 200) throw err(400, 'above-maximum', 'The amount is too high for a single MB WAY recharge')
    const inReader = cardInReader ? cardInReader() : null
    if (!inReader || (cardCode && String(cardCode) !== String(inReader))) throw err(409, 'no-card', 'Put the card in the reader first')
    const { default: Card } = await import('../models/card.js')
    const card = await withTenant(Card, { tenantId }).findOne({ code: String(inReader) }).select('status').lean()
    if (!card || ['blocked', 'pending_write'].includes(card.status)) throw err(409, 'card-not-usable', 'This card cannot be recharged')
    return { cfg, coupon: null, resolved: { total: value, lines: [] }, extra: { amount: value, cardCode: String(inReader) } }
  }
  if (!Array.isArray(items) || items.length === 0) throw err(400, 'empty-cart', 'Empty cart')
  if (items.some(isRecharge)) throw err(400, 'mbway-machines-only', 'A recharge is paid on its own, not together with machines')
  const coupon = couponCode ? await findUsableCoupon(tenantId, couponCode) : null
  const resolved = await resolveMachineLines(items, withTenant(Machine, { tenantId }), withTenant(Price, { tenantId }), 'cash', coupon)
  if (!resolved.ok) throw Object.assign(err(resolved.status, 'cart-refused', resolved.error?.error || 'Cart refused'), { detail: resolved.error })
  if (resolved.total < MIN_AMOUNT) throw err(400, 'below-minimum', `MB WAY needs at least ${MIN_AMOUNT.toFixed(2)} EUR`)
  return { cfg, coupon, resolved }
}

export async function startPayment({ tenantId, items, phone, batchId, couponCode, expectedAmount, kind = 'machines', customer, amount, cardCode }, deps) {
  const p9 = normalizePhone(phone)
  if (!p9) throw err(400, 'bad-phone', 'Invalid phone number')
  const { cfg, coupon, resolved, extra } = await priceCart({ tenantId, items, couponCode, kind, amount, cardCode }, deps)
  // The amount is fixed by the shop from its own prices. If the customer was shown another figure (a promo ended, a price changed while
  // the QR was on screen), nothing is charged: the session ends and a new one shows the new amount.
  if (expectedAmount !== undefined && Math.abs(roundMoney(expectedAmount) - resolved.total) > 0.005) throw err(409, 'price-changed', 'The price changed')

  const identifier = `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const now = Date.now()
  const payment = await MbwayPayment.create({
    tenantId, identifier, batchId, amount: resolved.total, phone: maskPhone(p9), couponCode: coupon ? coupon.code : '',
    lines: resolved.lines.map((l) => ({ machineId: l.machine._id, blocks: l.blocks, price: l.price, name: l.machine.name })),
    status: 'pending', expiresAt: new Date(now + WINDOW_MS),
    kind,
    payload: kind === 'card_purchase' ? { ...extra, customer: sanitizeCustomer(customer) } : kind === 'recharge' ? { ...extra } : null,
  })
  const r = await createMbway({ env: cfg.env, apiKey: cfg.apiKey, amount: resolved.total, phone: p9, identifier, fetchImpl })
  if (!r.ok) {
    await MbwayPayment.updateOne({ _id: payment._id }, { $set: { status: 'failed', error: `${r.code} ${r.text}`.trim() } })
    // No answer from Eupago: the request MAY exist and the customer may approve it. Without a reference we cannot follow it: tell the operator.
    if (r.uncertain) await alertOperator(tenantId, 'MB WAY: o pedido pode ter sido criado', `Sem resposta do Eupago (${r.text}) ao pedir ${resolved.total.toFixed(2)} EUR, identificador ${identifier}. Se aparecer um pagamento com este identificador no backoffice do Eupago, a máquina não arrancou: devolver o valor.`)
    throw Object.assign(err(r.uncertain ? 504 : 502, r.uncertain ? 'eupago-no-answer' : 'eupago-refused', r.text), { eupagoCode: r.code })
  }
  const saved = await MbwayPayment.findByIdAndUpdate(payment._id, { $set: { reference: r.reference, transactionId: r.transactionId } }, { new: true })
  flows.step(tenantId, 'mbway_requested', `MB WAY: pedido de ${resolved.total.toFixed(2).replace('.', ',')} € enviado ao telemóvel ${maskPhone(p9)} (referência ${r.reference})`, { reference: r.reference, kind }, { method: 'mbway', ...(kind === 'machines' ? {} : {}) })
  return view(saved)
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n)
/** The customer's details for a new card, as the cash flow takes them: bounded text, and consent only when it was given. */
function sanitizeCustomer(c = {}) {
  return { name: clip(c.name, 80), email: clip(c.email, 120), phone: clip(c.phone, 30), contribuinte: clip(c.contribuinte, 20), marketingOptIn: Boolean(c.marketingOptIn), privacyConsent: Boolean(c.privacyConsent) }
}

export const view = (p) => ({
  id: String(p._id), status: p.status, amount: p.amount, phone: p.phone, reference: p.reference, kind: p.kind || 'machines',
  expiresAt: p.expiresAt, error: p.error || '', machines: (p.lines || []).map((l) => l.name),
  ...(p.status === 'started' && p.payload?.card ? { card: p.payload.card } : {}),
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

/** Paid card purchase / recharge: do it; if it cannot be done the customer HAS paid, so say so loudly (refund by hand). */
async function finalizeCardPayment(p) {
  const { default: coinMachine } = await import('./coinMachine.js')
  const { fulfilCardPurchase, fulfilRecharge } = await import('./mbwayCards.js')
  try {
    const r = p.kind === 'card_purchase' ? await fulfilCardPurchase(p, { coinMachine }) : await fulfilRecharge(p)
    // the customer's personal details were only kept to write the card: they are gone now
    const payload = { ...(p.payload || {}), ...r.result }
    if (payload.customer) payload.customer = {}
    flows.step(p.tenantId, p.kind === 'card_purchase' ? 'card_sold' : 'recharge_done', p.kind === 'card_purchase' ? `Cartão vendido •••${String(payload.card?.code || '').slice(-4)} (MB WAY)` : `Carregamento de ${p.amount.toFixed(2).replace('.', ',')} € (MB WAY) · saldo ${Number(payload.card?.balance ?? 0).toFixed(2).replace('.', ',')} €`, { saleIds: r.saleIds.map(String) }, { method: 'mbway', cardCode: payload.card?.code || (p.payload || {}).cardCode })
    return await MbwayPayment.findByIdAndUpdate(p._id, { $set: { status: 'started', startedAt: new Date(), saleIds: r.saleIds, payload } }, { new: true })
  } catch (e) {
    const what = p.kind === 'card_purchase' ? 'o cartão não saiu' : 'o carregamento não foi feito'
    const done = await MbwayPayment.findByIdAndUpdate(p._id, { $set: { status: 'start_failed', error: `Pago, mas ${what} (${e.message}). Devolver o valor no backoffice do Eupago.`, 'payload.customer': {} } }, { new: true })
    flows.step(p.tenantId, 'mbway_start_failed', `Pago com MB WAY, mas ${what}: ${e.message}`, { reference: p.reference }, { ok: false })
    await alertOperator(p.tenantId, 'MB WAY pago mas o cartão não foi tratado', `Referência ${p.reference}, ${p.amount.toFixed(2)} EUR. ${done.error}`)
    return done
  }
}

/** The row flips pending -> paid exactly once, and only the one that flipped it starts the machines. */
async function finalizePaid(p) {
  const flipped = await MbwayPayment.findOneAndUpdate({ _id: p._id, status: 'pending' }, { $set: { status: 'paid', paidAt: new Date() } }, { new: true })
  if (!flipped) return MbwayPayment.findById(p._id)
  if (flipped.kind === 'card_purchase' || flipped.kind === 'recharge') return finalizeCardPayment(flipped)
  flows.step(p.tenantId, 'mbway_paid', `MB WAY: pagamento confirmado (${flipped.amount.toFixed(2).replace('.', ',')} €)`, { reference: flipped.reference }, { amount: flipped.amount, method: 'mbway' })
  const { saleIds, failed } = await startMachines(flipped)
  const owed = roundMoney(failed.reduce((s, f) => s + f.l.price, 0))
  const done = await MbwayPayment.findByIdAndUpdate(flipped._id, {
    $set: failed.length
      ? { status: 'start_failed', startedAt: saleIds.length ? new Date() : undefined, saleIds, error: `Pago, mas não arrancou: ${failed.map((f) => `${f.l.name} (${f.message})`).join('; ')}. A devolver ao cliente: ${owed.toFixed(2)} EUR` }
      : { status: 'started', startedAt: new Date(), saleIds },
  }, { new: true })
  if (saleIds.length) flows.step(p.tenantId, 'sale_recorded', `Venda registada · ${roundMoney(flipped.amount - owed).toFixed(2).replace('.', ',')} € · MB WAY`, { saleIds: saleIds.map(String) }, { amount: roundMoney(flipped.amount - owed), method: 'mbway' })
  if (failed.length) flows.step(p.tenantId, 'mbway_start_failed', `Pago com MB WAY mas a máquina não arrancou: ${failed.map((f) => f.l.name).join(', ')}`, { reference: p.reference }, { ok: false })
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
  // Keep what Eupago said: its word for the state whenever it changes, and the error when it cannot be asked.
  if (r.error) {
    if (p.lastCheckError !== r.error) { await MbwayPayment.updateOne({ _id: p._id }, { $set: { lastCheckError: r.error } }); console.warn(`[MBWAY] ref ${p.reference}: could not read the state (${r.error})`) }
  } else if (String(r.raw ?? '') !== (p.lastRawState || '')) {
    await MbwayPayment.updateOne({ _id: p._id }, { $set: { lastRawState: String(r.raw ?? ''), lastCheckError: '' }, $push: { stateHistory: { $each: [{ at: new Date(), raw: String(r.raw ?? '') }], $slice: -20 } } })
    console.log(`[MBWAY] ref ${p.reference}: Eupago state "${r.raw}" (${p.status})`)
    flows.step(p.tenantId, 'mbway_state', `MB WAY: o Eupago respondeu «${r.raw}»`, { reference: p.reference, raw: r.raw })
  }
  // A word for the state that we do not know: never treated as paid, but never ignored either.
  if (r.state && !isKnownState(r.raw) && !String(p.error || '').startsWith('Estado desconhecido')) {
    await MbwayPayment.updateOne({ _id: p._id }, { $set: { error: `Estado desconhecido do Eupago: ${r.raw}` } })
    await alertOperator(p.tenantId, 'MB WAY: estado desconhecido no Eupago', `Referência ${p.reference} devolveu "${r.raw}" e o sistema não sabe se é pago. Veja o pagamento no backoffice do Eupago e avise o programador.`)
  }
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
  if (p) { flows.step(tenantId, 'mbway_cancelled', 'MB WAY: o cliente cancelou no quiosque', { reference: p.reference }, { ok: false }); return view(p) }
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
  // Paid, and then nothing: the backend stopped (or threw) between "paid" and starting the machines / handing the card. Nobody
  // knows what was delivered, so it is never started again blindly: the row is closed as failed and the operator is told.
  for (;;) {
    const stuck = await MbwayPayment.findOneAndUpdate(
      { status: 'paid', paidAt: { $lt: new Date(Date.now() - STUCK_PAID_MS) } },
      { $set: { status: 'start_failed', error: 'Pago, mas o sistema parou antes de confirmar a entrega. Verificar se a máquina arrancou / o cartão saiu; se não, devolver o valor no backoffice do Eupago.' } },
      { new: true },
    )
    if (!stuck) break
    flows.step(stuck.tenantId, 'mbway_start_failed', 'Pago com MB WAY, mas a entrega não ficou confirmada', { reference: stuck.reference }, { ok: false })
    await alertOperator(stuck.tenantId, 'MB WAY pago e por confirmar', `Referência ${stuck.reference}, ${Number(stuck.amount || 0).toFixed(2)} EUR (${stuck.phone || 'sem número'}). ${stuck.error}`).catch((e) => console.error('[MBWAY] alert:', e.message))
  }
  // anything still pending far past the window is over
  await MbwayPayment.updateMany({ status: 'pending', expiresAt: { $lt: new Date(Date.now() - 4 * 60 * 1000) } }, { $set: { status: 'expired' } })
}

let timer = null
export function startSweeper(ms = 30000) {
  if (timer) return
  timer = setInterval(() => { sweep().catch((e) => console.error('[MBWAY] sweep failed:', e.message)) }, ms)
  timer.unref?.()
}

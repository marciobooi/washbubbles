import express from 'express'
import mongoose from 'mongoose'
import Machine from '../models/machine.js'
import Sale from '../models/sale.js'
import Card from '../models/card.js'
import Price from '../models/price.js'
import { requireKiosk } from '../middleware/auth.js'
import { broadcastMachine } from '../wsServer.js'
import { withTenant } from '../services/tenant.js'
import { roundMoney, parseAmount } from '../utils/money.js'
import { creditCard, applyCardDelta } from '../services/cardBalance.js'
import { cardLookupLimiter } from '../middleware/rateLimits.js'
import coinMachine from '../services/coinMachine.js'
import { findUsableCoupon, applyCouponDiscount, redeemCoupon } from '../services/coupons.js'

const router = express.Router()

/** True when a cart line is a card recharge rather than a machine payment. */
function isRecharge(item) {
  return Boolean(
    (item.type && String(item.type).toLowerCase().includes('recarga')) ||
    (item.id && String(item.id).startsWith('recharge'))
  )
}

/** Is a promo row active right now? Mirrors the kiosk's `pos-engine.getPrice`. */
function promoIsActive(price, now = new Date()) {
  if (!price.promoActive) return false
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  if (Array.isArray(price.promoDays) && price.promoDays.length && !price.promoDays.includes(days[now.getDay()])) {
    return false
  }
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  if (price.promoStartTime && hhmm < price.promoStartTime) return false
  if (price.promoEndTime && hhmm > price.promoEndTime) return false
  return true
}

/**
 * Resolve every machine line against the DB up front and price it from the
 * tenant's own Price table, not from the number the client sent.
 *
 * The kiosk runs on a public terminal, so `item.price` is attacker-controlled:
 * trusting it means a €10 wash can be bought for €0.01. Validating all lines
 * before any money moves also stops a mid-loop 404/409 from leaving the card
 * debited for some items and the rest unstarted.
 *
 * Machines carry no price of their own — the rate lives in the Price collection,
 * keyed by {type, weight}, with separate cash and card columns.
 *
 * @param method 'cash' or 'card'.
 * @param coupon An already-validated coupon (services/coupons.js#findUsableCoupon),
 *   or null. Applied per eligible line here so the discount is part of the
 *   same server-side pricing everything else already goes through — never
 *   computed by the kiosk itself for a network-settled sale.
 * @returns {{ok: true, lines: Array, total: number} | {ok: false, status: number, error: object}}
 */
async function resolveMachineLines(items, MachineT, PriceT, method, coupon = null) {
  const lines = []
  for (const it of items) {
    const ref = it._id || it.id
    const machine = (mongoose.Types.ObjectId.isValid(ref) ? await MachineT.findById(ref) : null) ||
      await MachineT.findOne({ number: Number(ref) })
    if (!machine) return { ok: false, status: 404, error: { error: 'Machine not found', machineRef: ref } }
    if (machine.status === 'working') {
      return { ok: false, status: 409, error: { error: 'Machine already in use', machineId: machine._id } }
    }
    if (machine.outOfService || machine.status === 'offline' || machine.status === 'fault') {
      return { ok: false, status: 409, error: { error: 'Machine out of service', machineId: machine._id } }
    }
    if (lines.some((l) => String(l.machine._id) === String(machine._id))) {
      return { ok: false, status: 400, error: { error: 'Machine listed twice in the same cart', machineId: machine._id } }
    }

    const priceRow = await PriceT.findOne({ type: machine.type || 'wash', weight: machine.weight })
    if (!priceRow) {
      return { ok: false, status: 409, error: { error: 'No price configured for this machine', machineId: machine._id, type: machine.type, weight: machine.weight } }
    }
    const promo = promoIsActive(priceRow)
    const raw = method === 'card'
      ? (promo && priceRow.promoCardPrice != null ? priceRow.promoCardPrice : priceRow.cardPrice)
      : (promo && priceRow.promoCashPrice != null ? priceRow.promoCashPrice : priceRow.cashPrice)
    let price = roundMoney(raw)
    if (!(price > 0)) {
      return { ok: false, status: 409, error: { error: 'Machine has no price configured', machineId: machine._id } }
    }
    if (coupon && (coupon.appliesTo === 'both' || coupon.appliesTo === (machine.type || 'wash'))) {
      price = applyCouponDiscount(price, coupon)
    }
    lines.push({ machine, price, item: it })
  }
  return { ok: true, lines, total: roundMoney(lines.reduce((s, l) => s + l.price, 0)) }
}

// GET /api/gateways/cards/:code - lookup card balance (kiosk only)
router.get('/cards/:code', cardLookupLimiter, requireKiosk, async (req, res) => {
  const { code } = req.params
  if (!code) return res.status(400).json({ error: 'Missing card code' })
  const CardT = withTenant(Card, req)
  const card = await CardT.findOne({ code })
  if (!card) return res.status(404).json({ error: 'Card not found' })
  res.json({ code: card.code, balance: card.balance })
})

// POST /api/gateways/cards/:code/topup - topup card and create recharge sale
router.post('/cards/:code/topup', requireKiosk, async (req, res) => {
  const { code } = req.params
  const { amount, batchId } = req.body
  if (!code) return res.status(400).json({ error: 'Missing parameters' })

  const parsed = parseAmount(amount)
  if (!parsed.ok) return res.status(400).json({ error: parsed.error })
  const topUp = parsed.value

  const CardT = withTenant(Card, req)
  const SaleT = withTenant(Sale, req)
  let card = await CardT.findOne({ code })
  if (!card) {
    card = await CardT.create({ code, balance: 0 })
  }
  // Atomic: a concurrent top-up on the same card must not overwrite this one.
  card = await creditCard(CardT, { _id: card._id }, topUp)

  const sale = await SaleT.create({ amount: topUp, items: [{ type: 'recharge', amount: topUp }], method: 'card', batchId, inserted: topUp, change: 0, type: 'recharge', cardId: card._id, cardCode: card.code })

  res.json({ success: true, sale, card })
})

// POST /api/gateways/card/pay - charge card for items (machines + optional recharges in same batch)
router.post('/card/pay', requireKiosk, async (req, res) => {
  const { items = [], cardCode, batchId, couponCode } = req.body
  if (!Array.isArray(items) || !cardCode) return res.status(400).json({ error: 'Missing parameters' })

  const CardT = withTenant(Card, req)
  const SaleT = withTenant(Sale, req)
  const MachineT = withTenant(Machine, req)
  const coupon = couponCode ? await findUsableCoupon(req.tenantId, couponCode) : null

  // Fetch card
  let card = await CardT.findOne({ code: cardCode })
  if (!card) return res.status(404).json({ error: 'Card not found' })
  if (card.status === 'pending_write') {
    return res.status(409).json({ error: 'Card is not activated yet — insert it in the reader first', status: card.status })
  }
  if (card.status === 'blocked') return res.status(409).json({ error: 'Card is blocked' })

  // ── Validate the whole cart before a cent moves ──
  // The previous version credited recharges and debited machines inside the same
  // loop that could `return` on a 404/409, so a bad line left the card credited
  // with revenue booked and no wash started — money the day-close can't explain.
  const rechargeLines = []
  for (const r of items.filter(isRecharge)) {
    const parsed = parseAmount(r.amount ?? r.price)
    if (!parsed.ok) return res.status(400).json({ error: `Recharge line: ${parsed.error}` })
    rechargeLines.push({ amount: parsed.value, item: r })
  }

  const resolved = await resolveMachineLines(items.filter((i) => !isRecharge(i)), MachineT, withTenant(Price, req), 'card', coupon)
  if (!resolved.ok) return res.status(resolved.status).json(resolved.error)

  const rechargeTotal = roundMoney(rechargeLines.reduce((s, l) => s + l.amount, 0))
  const available = roundMoney((card.balance || 0) + rechargeTotal)
  if (available < resolved.total) {
    return res.status(400).json({ error: 'Insufficient balance', balance: card.balance })
  }

  // ── Apply ──
  // One atomic $inc for the whole batch (recharges credited, machines debited),
  // guarded so a concurrent spend elsewhere cannot push the balance negative.
  const net = roundMoney(rechargeTotal - resolved.total)
  const updatedCard = await applyCardDelta(CardT, { _id: card._id }, net)
  if (!updatedCard) {
    return res.status(409).json({ error: 'Card balance changed concurrently; please retry', balance: card.balance })
  }
  card = updatedCard

  const sales = []
  for (const line of rechargeLines) {
    sales.push(await SaleT.create({ amount: line.amount, items: line.item, method: 'card', batchId, inserted: line.amount, change: 0, type: 'recharge', cardId: card._id, cardCode: card.code }))
  }

  for (const { machine, price, item } of resolved.lines) {
    const sale = await SaleT.create({ machineId: machine._id, amount: price, items: [item], method: 'card', batchId, type: 'payment', cardId: card._id, cardCode: card.code })
    sales.push(sale)

    // Only mark the machine busy if it is still free — a second kiosk may have
    // taken it between validation and here.
    const updated = await MachineT.findOneAndUpdate(
      { _id: machine._id, status: { $ne: 'working' } },
      { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } },
      { new: true }
    )
    if (!updated) {
      console.error(`[gateways] Machine ${machine._id} was taken between validation and activation; sale ${sale._id} owes a refund`)
      continue
    }
    try { await broadcastMachine(updated) } catch (e) { console.error('[gateways] broadcastMachine error', e) }
  }

  if (coupon && resolved.lines.length) {
    // One redemption per transaction, not per line — a cart of 3 machines on
    // one coupon still only counts once against maxRedemptions.
    await redeemCoupon(req.tenantId, coupon.code).catch((e) => console.error('[gateways] Failed to redeem coupon:', e.message))
  }

  res.json({ success: true, sales, card })
})

// POST /api/gateways/cash/pay - charge by cash (inserted/change) and create sales
router.post('/cash/pay', requireKiosk, async (req, res) => {
  const { items = [], inserted, batchId, couponCode } = req.body
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Missing parameters' })
  const coupon = couponCode ? await findUsableCoupon(req.tenantId, couponCode) : null

  // `inserted` MUST be coerced before it is compared. The old check was
  // `inserted + 0.0001 < total` on the raw body value: for the string "5" that is
  // the *string* "50.0001", which compares greater than any realistic total —
  // a free wash plus €45 of change out of the hopper.
  const parsedInserted = parseAmount(inserted, { allowZero: true })
  if (!parsedInserted.ok) return res.status(400).json({ error: `inserted: ${parsedInserted.error}` })
  const insertedNum = parsedInserted.value

  const SaleT = withTenant(Sale, req)
  const MachineT = withTenant(Machine, req)

  // Validate the whole cart before recording anything.
  const rechargeLines = []
  for (const r of items.filter(isRecharge)) {
    const parsed = parseAmount(r.amount ?? r.price)
    if (!parsed.ok) return res.status(400).json({ error: `Recharge line: ${parsed.error}` })
    rechargeLines.push({ amount: parsed.value, item: r })
  }

  const resolved = await resolveMachineLines(items.filter((i) => !isRecharge(i)), MachineT, withTenant(Price, req), 'cash', coupon)
  if (!resolved.ok) return res.status(resolved.status).json(resolved.error)

  const total = roundMoney(resolved.total + rechargeLines.reduce((s, l) => s + l.amount, 0))
  if (insertedNum < total) return res.status(400).json({ error: 'Insufficient cash', total, inserted: insertedNum })
  const change = roundMoney(insertedNum - total)

  const sales = []
  for (const line of rechargeLines) {
    // cash/pay handler — recharge method must be 'cash', not 'card'
    sales.push(await SaleT.create({ amount: line.amount, items: line.item, method: 'cash', batchId, inserted: line.amount, change: 0, type: 'recharge' }))
  }

  // Then machine sales — attach inserted/change to first machine sale
  let assigned = false
  for (const { machine, price, item } of resolved.lines) {
    let saleInserted = 0
    let saleChange = 0
    if (!assigned) {
      saleInserted = insertedNum
      saleChange = change
      assigned = true
    }

    const sale = await SaleT.create({ machineId: machine._id, amount: price, items: [item], method: 'cash', batchId, inserted: saleInserted, change: saleChange, type: 'payment' })
    sales.push(sale)

    const updated = await MachineT.findOneAndUpdate(
      { _id: machine._id, status: { $ne: 'working' } },
      { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } },
      { new: true }
    )
    if (!updated) {
      console.error(`[gateways] Machine ${machine._id} was taken between validation and activation; sale ${sale._id} owes a refund`)
      continue
    }
    try { await broadcastMachine(updated) } catch (e) { console.error('[gateways] broadcastMachine error', e) }
  }

  // Trigger hopper to dispense change if any is due
  let changeDispensed = false
  let changeError = null
  if (change > 0) {
    try {
      const Peripheral = (await import('../models/peripheral.js')).default
      const PeripheralT = withTenant(Peripheral, req)
      const hopper = await PeripheralT.findOne({ type: 'hopper', enabled: true })
      if (!hopper) throw new Error('No hopper configured')
      const result = await coinMachine.dispenseChange(hopper._id, change)
      changeDispensed = result?.success !== false
      if (!changeDispensed) changeError = result?.error || 'Hopper reported a fault'
    } catch (e) {
      changeError = e.message
      console.error('[gateways] Failed to dispense change:', e.message)
    }
    if (!changeDispensed) {
      // The old code called broadcastHardwareEvent('hopper:dispense', {...}) with
      // two arguments against a (tenantId, type, payload) signature, so the change
      // never reached any hopper and nobody was told. Now the kiosk gets a flag it
      // can act on.
      console.error(`[gateways] Change of €${change.toFixed(2)} owed on batch ${batchId}: ${changeError}`)
    }
  }

  if (coupon && resolved.lines.length) {
    await redeemCoupon(req.tenantId, coupon.code).catch((e) => console.error('[gateways] Failed to redeem coupon:', e.message))
  }

  res.json({ success: true, sales, total, inserted: insertedNum, change, changeDispensed, changeError })
})

export default router

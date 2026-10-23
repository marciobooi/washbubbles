import { getEmailBrand } from '../services/emailBrand.js'
import express from 'express'
import Machine from '../models/machine.js'
import Sale from '../models/sale.js'
import Setting from '../models/setting.js'
import Price from '../models/price.js'
import { requireKiosk, requireKioskOrAdmin } from '../middleware/auth.js'
import { broadcastMachines, broadcastMachine } from '../wsServer.js'
import { withTenant } from '../services/tenant.js'
import { roundMoney, parseAmount } from '../utils/money.js'
import { creditCard, debitCard, SPENDABLE } from '../services/cardBalance.js'
import { cardLookupLimiter, adminPinLimiter } from '../middleware/rateLimits.js'
import crypto from 'crypto'
import coinMachine from '../services/coinMachine.js'
import { promoIsActive } from './gateways.js'
import { sendAlert } from '../services/alerts.js'
import { sendMail } from '../services/mailer.js'
import { renderEmailHtml, escapeHtml } from '../services/emailTemplate.js'

const router = express.Router()

/**
 * Look for an already-recorded sale with this client-supplied operation id.
 *
 * The kiosk's checkout can partially fail — recharges are posted first, then the
 * machine payments, and a 409 on a busy machine aborts the rest. The customer
 * then taps "pay" again. Without a stable idempotency key each retry re-posts
 * the recharges, crediting the card again every time.
 *
 * @returns the existing Sale, or null when this is a first attempt.
 */
async function findByLocalId(SaleT, localId) {
  if (!localId) return null
  return SaleT.findOne({ 'metadata.localId': String(localId) })
}

// POS routes are public (can be configured to use token if required)
const getMachineStatus = async (req, res) => {
  const MachineT = withTenant(Machine, req)
  const machines = await MachineT.find().sort({ createdAt: 1 })
  const data = machines.map((m) => ({ id: m.id, name: m.name, status: m.status, cycle: m.cycle }))
  res.json(data)
}

router.get('/machine-status', getMachineStatus)

// GET /pos/connection — is this shop talking to the central server right now, and how much is still
// waiting to be sent? Drives the small online/offline badge on the kiosk. `enabled:false` = a
// standalone install with no central server: nothing to show.
router.get('/connection', requireKioskOrAdmin, async (req, res) => {
  const rc = coinMachine.remoteCommands
  if (!rc) return res.json({ enabled: false, online: null, pending: 0 })
  const conn = rc.connection()
  let pending = 0
  try { pending = (await coinMachine.uplink?.status?.())?.pending || 0 } catch { /* the badge must never fail */ }
  res.json({ ...conn, pending })
})
// Alias used by frontend hook: `/api/machine`
router.get('/machine', getMachineStatus)

// Public price lookup endpoint for POS kiosk display (no auth required)
router.get('/prices/lookup', async (req, res) => {
  const { type, weight } = req.query
  if (!type || !weight) return res.status(400).json({ error: 'Missing type or weight' })
  const PriceT = withTenant(Price, req)
  const price = await PriceT.findOne({ type, weight: Number(weight) })
  if (!price) return res.status(404).json({ error: 'Price not found for this type/weight' })
  res.json(price)
})

// Kiosk-only machines list: returns richer machine objects and accepts optional `type` query
// This endpoint requires a kiosk API key (`x-api-key` header or `Authorization: ApiKey <key>`).
// Kiosks should use this to fetch machine metadata; status changes (occupy/free) are performed via /pos/sale.
router.get('/machines', requireKiosk, async (req, res) => {
  const typeFilter = req.query.type
  const MachineT = withTenant(Machine, req)
  const machines = await MachineT.find().sort({ createdAt: 1 })
  let data = machines.map((m) => ({
    _id: m._id,
    id: m.id,
    name: m.name,
    number: m.number,
    weight: m.weight,
    price: m.price,
    loyaltyPrice: m.loyaltyPrice,
    status: m.status,
    statusText: m.statusText,
    type: m.type,
    icon: m.icon,
    // Minutes per block of a dryer (the price is per block) and the operator's out-of-service flag:
    // the payment window shows the time and the kiosk list greys the machine out.
    tImp: m.tImp,
    outOfService: Boolean(m.outOfService),
    serviceStatus: m.serviceStatus || null,
  }))
  if (typeFilter) data = data.filter((m) => (m.type || 'wash') === String(typeFilter))
  res.json(data)
})

router.post('/sale', requireKiosk, async (req, res) => {
  const { machineId, amount, items, method, inserted, type, cardCode, cardId, batchId, localId } = req.body
  if (!machineId || !items) return res.status(400).json({ error: 'Missing parameters' })

  // Replay of a retried checkout — do not charge the card a second time.
  const existingSale = await findByLocalId(withTenant(Sale, req), localId)
  if (existingSale) {
    const m = await withTenant(Machine, req).findById(existingSale.machineId)
    return res.json({ sale: existingSale, machine: m, card: null, status: 'duplicate' })
  }

  const parsedSale = parseAmount(amount)
  if (!parsedSale.ok) return res.status(400).json({ error: parsedSale.error })
  const saleAmount = parsedSale.value

  // Only accept 'card' or 'cash' as payment methods from clients
  if (method && !['card', 'cash'].includes(String(method))) return res.status(400).json({ error: 'Unsupported payment method' })

  // Ensure machine exists
  const MachineT = withTenant(Machine, req)
  const machine = await MachineT.findById(machineId)
  if (!machine) return res.status(404).json({ error: 'Machine not found' })

  // Prevent occupying a machine that is already working
  if (machine.status === 'working') {
    return res.status(409).json({ error: 'Machine already in use' })
  }
  if (machine.outOfService || machine.status === 'offline' || machine.status === 'fault') {
    return res.status(409).json({ error: 'Machine out of service' })
  }

  // If card specified and method is card, deduct from card balance.
  // Atomic: the sufficiency check and the debit are one update, so two kiosks
  // hitting the same card cannot both read the old balance and each get a wash.
  let card = null
  if ((cardId || cardCode) && method === 'card') {
    const Card = (await import('../models/card.js')).default
    const CardT = withTenant(Card, req)
    const filter = cardId ? { _id: cardId } : { code: cardCode }
    card = await debitCard(CardT, filter, saleAmount)
    if (!card) {
      // Null means missing, not yet activated, or underfunded — say which.
      const exists = await CardT.findOne(filter)
      if (!exists) return res.status(404).json({ error: 'Card not found' })
      if (exists.status === 'pending_write') {
        return res.status(409).json({ error: 'Card is not activated yet — insert it in the reader first', status: exists.status })
      }
      if (exists.status === 'blocked') return res.status(409).json({ error: 'Card is blocked' })
      return res.status(400).json({ error: 'Insufficient balance', balance: exists.balance })
    }
  }

  // Compute inserted/change defaults and create sale. `change` is always derived,
  // never taken from the request body — a client-supplied change value is a
  // request to empty the hopper.
  const parsedInserted = parseAmount(inserted, { allowZero: true })
  const insertedNum = parsedInserted.ok ? parsedInserted.value : 0
  const changeNum = roundMoney(Math.max(0, insertedNum - saleAmount))
  const SaleT = withTenant(Sale, req)
  const sale = await SaleT.create({ machineId, amount: saleAmount, items, method, batchId, inserted: insertedNum, change: changeNum, type: type || 'payment', cardId: card ? card._id : undefined, cardCode: card ? card.code : (cardCode || undefined), metadata: localId ? { localId: String(localId) } : undefined })

  // Update machine: increment cycle and mark as occupied after successful payment
  await MachineT.findByIdAndUpdate(machineId, { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } })

  const updated = await MachineT.findById(machineId)
  // broadcast single updated machine so clients refresh quickly
  try { await broadcastMachine(updated) } catch (e) { console.error('[pos] broadcastMachine error', e) }

  res.json({ sale, machine: updated, card })
})

/**
 * Check a staff PIN against the tenant's configured `adminPin` setting.
 *
 * Shared by `/admin/verify-pin` (the kiosk UI's own gate check) and any route
 * that should not trust a kiosk apiKey alone — an apiKey extracted from a
 * compromised terminal's stored config is still just a kiosk credential; the
 * PIN is the second factor a physical operator has to actually be there and
 * know. Compared in constant time, since a short numeric PIN is otherwise
 * brute-forcible in minutes.
 */
async function checkAdminPin(req, pin) {
  if (typeof pin !== 'string' || !pin) return { ok: false, status: 400, error: 'Missing pin' }

  const SettingT = withTenant(Setting, req)
  const row = await SettingT.findOne({ key: 'adminPin' })
  const expected = row ? String(row.value ?? '') : ''

  // Fail closed: with no PIN configured, staff actions stay locked.
  if (!expected) return { ok: false, status: 409, error: 'No admin PIN is configured for this site', configured: false }

  const a = Buffer.from(expected)
  const b = Buffer.from(pin)
  const match = a.length === b.length && crypto.timingSafeEqual(a, b)
  if (!match) return { ok: false, status: 401, error: 'Invalid PIN' }

  return { ok: true }
}

/**
 * POST /pos/admin/verify-pin
 *
 * Confirms the operator's admin PIN so the kiosk can unlock staff-only actions
 * (manual payment when the coin acceptor or card reader is down).
 *
 * The PIN is verified server-side and never sent to the client: shipping it to a
 * renderer on a public terminal would make the gate decorative.
 */
router.post('/admin/verify-pin', adminPinLimiter, requireKiosk, async (req, res) => {
  const result = await checkAdminPin(req, req.body.pin)
  if (!result.ok) return res.status(result.status).json({ error: result.error, ...(result.configured === false ? { configured: false } : {}) })
  res.json({ ok: true })
})

/**
 * GET /pos/day-close/summary, POST /pos/day-close
 *
 * Lets staff close the cash session directly from the kiosk, not only from the
 * admin dashboard — same wizard, same reconciliation logic
 * (`services/dayClose.js`), just reachable with a kiosk token.
 *
 * The summary is read-only (today's running totals) and needs no more than the
 * kiosk's own credential. Actually WRITING the close is gated behind the staff
 * PIN a second time, server-side — a kiosk apiKey lifted from a compromised
 * terminal's stored config is still just a kiosk credential, and unlike a
 * payment it can't be undone by a chargeback: a bogus reconciliation record
 * corrupts the books. The PIN is the proof a physical operator is actually
 * there. An admin token skips this — the admin JWT is already that credential,
 * and the dashboard's own close route asks for no PIN either.
 */
router.get('/day-close/summary', requireKioskOrAdmin, async (req, res) => {
  const { getDayCloseSummary } = await import('../services/dayClose.js')
  res.json(await getDayCloseSummary(req))
})

// Hopper reinforcement from the kiosk: staff PIN, like the day close (a kiosk key alone cannot move money).
router.post('/hopper/refill', requireKioskOrAdmin, async (req, res) => {
  if (req.userModel?.role === 'KIOSK') {
    const pinCheck = await checkAdminPin(req, req.body.pin)
    if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error })
  }
  const { refillHopper } = await import('../services/hopperRefill.js')
  const { status, body } = await refillHopper(req, req.body || {})
  res.status(status).json(body)
})

router.post('/day-close', requireKioskOrAdmin, async (req, res) => {
  if (req.userModel?.role === 'KIOSK') {
    const pinCheck = await checkAdminPin(req, req.body.pin)
    if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error })
  }
  const { createDayClose } = await import('../services/dayClose.js')
  const { status, body } = await createDayClose(req, req.body)
  res.status(status).json(body)
})

// POST /day-close/:id/email — email a Z-report summary of one close. No PIN:
// this only sends a copy of a record already readable via the summary above,
// it can't change any figures.
router.post('/day-close/:id/email', requireKioskOrAdmin, async (req, res) => {
  const { emailDayCloseReceipt } = await import('../services/dayClose.js')
  const { status, body } = await emailDayCloseReceipt(req, req.params.id, req.body?.email)
  res.status(status).json(body)
})

// Card recharge / top-up (kiosk) — stored as a transaction without a machine reference
// Card recharge / top-up (kiosk) — stored as a transaction and optionally attached to a loyalty card
router.post('/recharge', requireKiosk, async (req, res) => {
  const { amount, items, method, inserted, cardCode, cardId, batchId, localId } = req.body

  // Recharges are always card-based in this system
  if (method && String(method) !== 'card') return res.status(400).json({ error: 'Recharges must be performed with method "card"' })

  const parsedAmount = parseAmount(amount)
  if (!parsedAmount.ok) return res.status(400).json({ error: parsedAmount.error })
  const rechargeAmount = parsedAmount.value

  const parsedInserted = parseAmount(inserted == null ? rechargeAmount : inserted)
  if (!parsedInserted.ok) return res.status(400).json({ error: `inserted: ${parsedInserted.error}` })
  const insertedNum = parsedInserted.value

  if (insertedNum < rechargeAmount) {
    return res.status(400).json({ error: 'Inserted amount is less than the recharge amount' })
  }
  // On the shop PC the cash really inserted is known: no recharge without it, and the cash is spent by this recharge.
  if (coinMachine.running) {
    const st = coinMachine.client?.getState?.() || {}
    const have = roundMoney(st.balance || 0)
    if (insertedNum > have + 0.005 || have + 0.005 < rechargeAmount) {
      return res.status(409).json({ error: 'Insert the cash first', code: 'cash-not-inserted', inserted: have })
    }
    coinMachine.client.restoreBalances({ balance: roundMoney(Math.max(0, have - insertedNum)), balanceCard: st.balanceCard })
  }
  // Change is always derived here, never taken from the request — a client-supplied
  // `change` is a request to empty the hopper.
  const changeAmount = roundMoney(insertedNum - rechargeAmount)

  // Both models must be tenant-scoped: without it a kiosk key from tenant A can
  // top up tenant B's card by id or code.
  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const SaleT = withTenant(Sale, req)

  // Replay of a retried checkout — return the original result, credit nothing.
  const alreadyDone = await findByLocalId(SaleT, localId)
  if (alreadyDone) {
    const existingCard = alreadyDone.cardId ? await CardT.findById(alreadyDone.cardId) : null
    return res.json({ sale: alreadyDone, card: existingCard, change: alreadyDone.change, changeDispensed: true, status: 'duplicate' })
  }

  // If card specified, update its balance
  let card = null
  if (cardId || cardCode) {
    const filter = cardId ? { _id: cardId } : { code: cardCode }
    card = await CardT.findOne(filter)
    if (!card && cardCode) {
      // create card implicitly when code provided (CardT.create() injects tenantId automatically)
      card = await CardT.create({ code: cardCode, balance: 0 })
    }
    if (card) {
      // Atomic credit — a concurrent recharge on the same card must not be lost.
      card = await creditCard(CardT, { _id: card._id }, rechargeAmount)
    }
  }

  // Record the sale BEFORE any coin leaves the machine. If this throws, no change
  // has been dispensed yet; the reverse ordering left coins in the customer's hand
  // with no Sale row, which shows up at day-close as an unexplainable shortage.
  const sale = await SaleT.create({
    amount: rechargeAmount,
    items,
    method: 'cash', // money in is always cash (the 'card' label the client sends is only the target card)
    batchId,
    inserted: insertedNum,
    change: changeAmount,
    type: 'recharge',
    cardId: card ? card._id : undefined,
    cardCode: card ? card.code : (cardCode || undefined),
    metadata: localId ? { localId: String(localId) } : undefined
  })

  // Dispense change if needed
  let changeDispensed = false
  let changeError = null
  if (changeAmount > 0) {
    try {
      const Peripheral = (await import('../models/peripheral.js')).default
      const PeripheralT = withTenant(Peripheral, req)
      const hopper = await PeripheralT.findOne({ type: 'hopper', enabled: true })

      if (hopper) {
        const result = await coinMachine.dispenseChange(hopper._id, changeAmount)
        // dispenseChange resolves with `{success:false}` on a jam rather than throwing.
        changeDispensed = result?.success !== false
        if (!changeDispensed) changeError = result?.error || 'Hopper reported a fault'
      } else {
        changeError = 'No hopper configured'
        console.warn('[pos] No hopper available for change dispensing')
      }
    } catch (e) {
      changeError = e.message
      console.error('[pos] Failed to dispense change:', e.message)
    }
    if (!changeDispensed && coinMachine.running) {
      try { const st2 = coinMachine.client.getState(); coinMachine.client.restoreBalances({ balance: roundMoney((st2.balance || 0) + changeAmount), balanceCard: st2.balanceCard }) } catch { /* the audit/log below still tells the operator */ }
    }
    if (!changeDispensed) {
      // The sale is already recorded, so the shortfall is attributable. Tell the
      // kiosk so it can show "collect your change at the counter" instead of
      // silently keeping the customer's money.
      console.error(`[pos] Change of €${changeAmount.toFixed(2)} owed on sale ${sale._id}: ${changeError}`)
    }
  }

  res.json({ sale, card, change: changeAmount, changeDispensed, changeError })
})

// Card purchase endpoint - handles new card purchases with customer data
/**
 * POST /pos/card/purchase — sell a new loyalty card.
 *
 * The physical lifecycle is: customer pays → dispenser ejects a BLANK card →
 * customer inserts it in the reader → we write their id and balance onto it
 * (`/pos/card/write/:code`) → the card is active.
 *
 * Ordering matters. The card is dispensed BEFORE the sale is recorded, because
 * a dispenser that is jammed or empty must not result in a charge. Previously
 * this route resolved `middleware` from `../index.js`, which exports nothing —
 * so `middleware` was always undefined, `if (dispenser && middleware)` was always
 * false, and NO CARD WAS EVER DISPENSED while the customer was charged in full
 * and told "Card dispensed. Please insert card into reader to activate."
 */
// Staff PIN for the actions below (gift card, machine start/stop). Only WRONG PINs count against the limit
// (5 per 15 min): a legitimate PIN, however many actions, never locks staff out. Answers the request itself when refused.
const staffPinFails = new Map() // ip -> { n, since }
async function requireStaffPin(req, res) {
  const ip = req.ip || 'unknown'
  const rec = staffPinFails.get(ip)
  if (rec && Date.now() - rec.since > 15 * 60_000) staffPinFails.delete(ip)
  if ((staffPinFails.get(ip)?.n || 0) >= 5) { res.status(429).json({ error: 'Too many PIN attempts, please try again later.' }); return false }
  const pinCheck = await checkAdminPin(req, req.body?.pin)
  if (!pinCheck.ok) {
    if (pinCheck.status === 401) { const r = staffPinFails.get(ip) || { n: 0, since: Date.now() }; r.n++; staffPinFails.set(ip, r) }
    res.status(pinCheck.status).json({ error: pinCheck.error })
    return false
  }
  staffPinFails.delete(ip)
  return true
}

// POST /pos/central-key — change the shop's key to the central server (staff PIN). The key is checked against the server first.
router.post('/central-key', requireKiosk, async (req, res) => {
  if (!(await requireStaffPin(req, res))) return
  const { applyCentralKey } = await import('../services/centralKey.js')
  const r = await applyCentralKey(req.body?.key, { serverUrl: req.body?.serverUrl, coin: coinMachine })
  if (!r.ok) return res.status(r.code === 'offline' || r.code === 'server-error' ? 502 : 400).json({ error: r.message, code: r.code })
  try { const { logAction } = await import('../services/auditLog.js'); logAction(req, 'kiosk.central_key_changed', 'System', null, { by: 'staff PIN (kiosk)' }) } catch { /* the trail must not undo a saved key */ }
  res.json({ ok: true, message: r.warning || 'Chave guardada e ligação ao servidor confirmada.', warning: r.warning })
})

// POST /pos/card/gift — hand a card to a customer for free (staff PIN on every call). Default credit is zero.
router.post('/card/gift', requireKiosk, async (req, res) => {
  if (!(await requireStaffPin(req, res))) return
  try {
    const { issueGiftCard } = await import('../services/giftCard.js')
    const b = req.body || {}
    const r = await issueGiftCard(req, coinMachine, {
      credit: b.credit ?? 0, customerName: b.customerName, customerEmail: b.customerEmail, customerPhone: b.customerPhone,
      customerContribuinte: b.customerContribuinte, by: 'staff PIN (kiosk)',
    })
    res.json({ ...r, message: 'Cartão libertado. Coloque-o no leitor para o activar.' })
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Gift card failed' })
  }
})

// POST /pos/staff/machines/:id/start|end — start (dryers: 1..8 cycles) or release a machine with no payment, from the kiosk,
// behind the staff PIN. Same action as the admin's Iniciar / Parar, and recorded the same way.
for (const kind of ['start', 'end']) {
  router.post(`/staff/machines/:id/${kind}`, requireKiosk, async (req, res) => {
    if (!(await requireStaffPin(req, res))) return
    if (!coinMachine.running) return res.status(409).json({ error: 'Este posto não tem as máquinas ligadas' })
    try {
      const blocks = Math.min(8, Math.max(1, Math.floor(Number(req.body?.blocks)) || 1))
      const result = kind === 'start' ? await coinMachine.adminStartMachine(req.params.id, blocks) : await coinMachine.adminEndMachine(req.params.id)
      const { logAction } = await import('../services/auditLog.js')
      logAction(req, `machine.admin_${kind}`, 'Machine', req.params.id, { by: 'staff PIN (kiosk)', ...(kind === 'start' ? { blocks } : {}) })
      if (kind === 'start') await withTenant(Sale, req).create({ machineId: req.params.id, amount: 0, type: 'admin_start', method: 'cash', metadata: { by: 'staff PIN (kiosk)', blocks } }).catch(() => {})
      res.json({ success: true, ...result })
    } catch (e) {
      res.status(400).json({ error: e.message })
    }
  })
}

router.post('/card/purchase', requireKiosk, async (req, res) => {
  const { inserted, customerName, customerEmail, customerPhone, customerContribuinte, customerMarketingOptIn, customerPrivacyConsent, batchId, localId } = req.body

  const parsedInserted = parseAmount(inserted)
  if (!parsedInserted.ok) return res.status(400).json({ error: parsedInserted.error })
  let insertedAmount = parsedInserted.value

  try {
    const Card = (await import('../models/card.js')).default
    const CardPurchase = (await import('../models/cardPurchase.js')).default
    const Peripheral = (await import('../models/peripheral.js')).default
    const CardT = withTenant(Card, req)
    const CardPurchaseT = withTenant(CardPurchase, req)
    const PeripheralT = withTenant(Peripheral, req)
    const SettingT = withTenant(Setting, req)
    const SaleT = withTenant(Sale, req)

    // Replay of a retried purchase — never sell a second card for one payment.
    if (localId) {
      const existing = await SaleT.findOne({ 'metadata.localId': String(localId) })
      if (existing) {
        const existingCard = await CardT.findOne({ code: existing.cardCode })
        return res.json({
          success: true, status: 'duplicate', card: existingCard, sale: existing,
          change: existing.change, changeDispensed: true,
          message: 'Insira o cartão no leitor para o activar.',
        })
      }
    }

    // ── Price ──
    const purchasePrice = await SettingT.findOne({ key: 'loyaltyCard.cost' })
    const initialCredit = await SettingT.findOne({ key: 'loyaltyCard.credit' })
    const price = roundMoney(purchasePrice?.value ?? 0)
    const credit = roundMoney(initialCredit?.value ?? 0)

    if (!(price > 0)) {
      return res.status(409).json({ error: 'Card purchase price not configured' })
    }
    // On the shop PC the kiosk's "inserted" figure is not trusted: it came from a button on the screen, so
    // anybody could press 20 and get a card for nothing. The payment is the cash really in the session
    // (what the coin and bill acceptors credited); whatever is above the price comes back as change.
    if (coinMachine.running) {
      const cash = roundMoney(coinMachine.client?.getState?.().balance || 0)
      if (cash + 0.005 < price) {
        return res.status(409).json({ error: `Insufficient cash inserted. Card costs €${price.toFixed(2)}`, price, inserted: cash })
      }
      insertedAmount = cash
    }
    if (insertedAmount + 0.005 < price) {
      return res.status(400).json({ error: `Insufficient payment. Card costs €${price.toFixed(2)}`, price })
    }
    const changeAmount = roundMoney(insertedAmount - price)

    // ── Unique card code. This is the customer's id and is what gets written
    //    onto the physical card. Random rather than sequential so one code does
    //    not reveal another. ──
    let cardCode = ''
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = String(crypto.randomInt(1000000000, 10000000000))
      if (!(await CardT.findOne({ code: candidate }))) { cardCode = candidate; break }
    }
    if (!cardCode) return res.status(500).json({ error: 'Could not allocate a card code' })

    // ── Dispense the blank card FIRST. No card, no charge. ──
    const dispenser = await PeripheralT.findOne({ type: 'card_dispenser', enabled: true })
    if (!dispenser) {
      return res.status(503).json({ error: 'No card dispenser configured — cannot sell a card' })
    }
    try {
      await coinMachine.dispenseNewCard(dispenser._id, credit)
    } catch (err) {
      console.error('[pos] Card dispense failed; customer NOT charged:', err.message)
      return res.status(503).json({
        error: 'The card dispenser did not release a card. You have not been charged.',
        detail: err.message,
      })
    }

    // The moment the customer authorised the processing of their details (GDPR proof), if they did.
    const privacyConsentAt = customerPrivacyConsent ? new Date() : null

    // ── A card is physically out. From here the customer owns it. ──
    const card = await CardT.create({
      code: cardCode,
      balance: credit,
      // Blank until written at the reader — must not be spendable yet.
      status: 'pending_write',
      name: customerName || '',
      email: customerEmail || '',
      phone: customerPhone || '',
      contribuinte: customerContribuinte || '',
      marketingOptIn: Boolean(customerMarketingOptIn),
      privacyConsentAt,
    })

    const sale = await SaleT.create({
      amount: price,
      items: [{ type: 'card_purchase', amount: price, cardCode }],
      method: 'cash',
      batchId,
      inserted: insertedAmount,
      change: changeAmount,
      type: 'card_purchase',
      cardId: card._id,
      cardCode,
      // initialCredit: the part of the price that is balance on the card (prepaid), for the day-close revenue
      metadata: { initialCredit: credit, ...(localId ? { localId: String(localId) } : {}), ...(privacyConsentAt ? { privacyConsentAt } : {}) },
    })

    // The cash inserted for this purchase is spent: take it out of the session. Left in, it was moved
    // onto the new card when the card was removed (a EUR 5 card ended up with EUR 10).
    try {
      const st = coinMachine.client?.client
      if (st) {
        st.balance = roundMoney(Math.max(0, (st.balance || 0) - insertedAmount))
        coinMachine.client.updateCredits()
        coinMachine.client.notifySubscribers()
      }
    } catch (e) { console.error('[pos] could not clear the session cash after the card purchase:', e.message) }

    const cardPurchase = await CardPurchaseT.create({
      cardId: card._id,
      cardCode,
      purchasePrice: price,
      initialCredit: credit,
      paymentMethod: 'cash',
      amountInserted: insertedAmount,
      changeGiven: changeAmount,
      customerName: customerName || '',
      customerEmail: customerEmail || '',
      customerPhone: customerPhone || '',
      customerContribuinte: customerContribuinte || '',
      saleId: sale._id,
      batchId,
      dispenserUsed: true,
      cardWritten: false,
    })

    // ── Change ──
    let changeDispensed = false
    let changeError = null
    if (changeAmount > 0) {
      try {
        const hopper = await PeripheralT.findOne({ type: 'hopper', enabled: true })
        if (!hopper) throw new Error('No hopper configured')
        const result = await coinMachine.dispenseChange(hopper._id, changeAmount)
        changeDispensed = result?.success !== false
        if (!changeDispensed) changeError = result?.error || 'Hopper reported a fault'
      } catch (e) {
        changeError = e.message
        console.error('[pos] Failed to dispense change on card purchase:', e.message)
      }
      if (!changeDispensed) {
        console.error(`[pos] Change of €${changeAmount.toFixed(2)} owed on card sale ${sale._id}: ${changeError}`)
      }
    }

    res.json({
      success: true,
      card,
      cardPurchase,
      sale,
      change: changeAmount,
      changeDispensed,
      changeError,
      nextStep: 'write',
      message: 'Insira o cartão no leitor para o activar.',
    })
  } catch (e) {
    console.error('Card purchase error:', e)
    res.status(500).json({ error: e.message || 'Card purchase failed' })
  }
})

// Get card balance + recent transaction history (kiosk)
router.get('/cards/:code/history', cardLookupLimiter, requireKiosk, async (req, res) => {
  const code = req.params.code
  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const card = await CardT.findOne({ code }).lean()
  if (!card) return res.status(404).json({ error: 'Card not found' })

  const SaleT = withTenant(Sale, req)
  const sales = await SaleT.find({ cardCode: code }).sort({ createdAt: -1 }).limit(30).lean()
  const transactions = sales.map((s) => ({
    id: String(s._id),
    ts: s.createdAt,
    type: s.type || 'payment',
    // a gift card moved no money: what it shows is the free credit it came with
    amount: s.type === 'gift_card' ? Math.abs(Number(s.metadata?.giftCredit || 0)) : (s.type === 'payment' ? -Math.abs(s.amount) : Math.abs(s.amount)),
    // what was bought, so the kiosk can say "Secar 8" instead of a bare "payment"
    name: (Array.isArray(s.items) ? s.items[0]?.name : s.items?.name) || null,
    machineType: (Array.isArray(s.items) ? s.items[0]?.type : s.items?.type) || null,
    method: s.method || null,
  }))

  res.json({ card, transactions })
})

// The holder edits their own data on the kiosk. Only while THAT card is in the reader (they hold it), kiosk key required.
router.post('/cards/:code/profile', cardLookupLimiter, requireKiosk, async (req, res) => {
  const code = String(req.params.code)
  const st = coinMachine.client?.getState?.() || {}
  if (!(st.hasCard && String(st.cardNumber) === code)) return res.status(409).json({ error: 'Insira o cartão no leitor para editar os dados', code: 'card-not-in-reader' })
  const cut = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n)
  const name = cut(req.body?.name, 80), email = cut(req.body?.email, 120), phone = cut(req.body?.phone, 30), contribuinte = cut(req.body?.contribuinte, 20)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email inválido', code: 'bad-email' })
  const hasData = Boolean(name || email || phone || contribuinte)
  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const card = await CardT.findOne({ code })
  if (!card) return res.status(404).json({ error: 'Card not found' })
  // Personal data needs the holder's authorisation (GDPR): ticked now, or given before.
  if (hasData && !req.body?.privacyConsent && !card.privacyConsentAt) return res.status(400).json({ error: 'Consentimento em falta', code: 'consent-required' })
  const set = { name, email, phone, contribuinte, marketingOptIn: hasData && Boolean(req.body?.marketingOptIn) }
  if (!hasData) set.privacyConsentAt = null
  else if (req.body?.privacyConsent && !card.privacyConsentAt) set.privacyConsentAt = new Date()
  const updated = await CardT.findOneAndUpdate({ code }, { $set: set }, { new: true }).lean()
  res.json({ success: true, card: updated })
})

// Mark card as written after RFID write
router.post('/card/mark-written/:code', requireKiosk, async (req, res) => {
  const code = req.params.code
  
  try {
    const CardPurchase = (await import('../models/cardPurchase.js')).default
    const CardPurchaseT = withTenant(CardPurchase, req)

    const purchase = await CardPurchaseT.findOneAndUpdate(
      { cardCode: code, cardWritten: false },
      { cardWritten: true },
      { new: true }
    )
    
    if (!purchase) {
      return res.status(404).json({ error: 'Card purchase not found or already written' })
    }
    
    res.json({ success: true, purchase })
  } catch (e) {
    console.error('Mark card written error:', e)
    res.status(500).json({ error: e.message })
  }
})

/**
 * POST /pos/card/write/:code — personalise a blank card at the reader.
 *
 * This is the second half of a card purchase: the dispenser ejects a BLANK card,
 * the customer inserts it here, and we write their id (the card code) and balance
 * onto it. Only then does the card become spendable.
 *
 * Previously this resolved `middleware` from `../index.js`, which exports nothing,
 * so the guard `if (!rfidReader || !middleware)` returned 503 every single time —
 * a purchased card could never be activated and stayed blank forever.
 */
router.post('/card/write/:code', requireKiosk, async (req, res) => {
  const code = req.params.code

  try {
    const Card = (await import('../models/card.js')).default
    const Peripheral = (await import('../models/peripheral.js')).default
    const CardT = withTenant(Card, req)
    const PeripheralT = withTenant(Peripheral, req)

    // The purchase may have been re-keyed to the chip's own id: the kiosk still holds the id it was given.
    const card = (await CardT.findOne({ code })) || (await CardT.findOne({ 'metadata.previousCode': code }))
    if (!card) return res.status(404).json({ error: 'Card not found' })
    if (card.status === 'blocked') return res.status(409).json({ error: 'Card is blocked' })

    const rfidReader = await PeripheralT.findOne({ type: 'rfid_reader', enabled: true })
    if (!rfidReader) return res.status(503).json({ error: 'No RFID reader configured' })

    // Already written (the shop writes a purchased card as soon as the blank card is read): nothing to do.
    if (card.status === 'active') return res.json({ success: true, card, message: 'Cartão activado.' })

    // The write needs the blank card to be AT the reader (so the card takes its own id).
    if (!coinMachine.currentBlank) {
      return res.status(409).json({
        error: 'Present the new card at the reader first',
        retryable: true,
        message: 'Coloque o cartão novo no leitor e tente outra vez.',
      })
    }
    const written = await coinMachine.activatePendingCard(coinMachine.currentBlank)
    if (!written) throw new Error('The card could not be written')

    res.json({ success: true, card: written, message: 'Cartão activado.' })
  } catch (e) {
    console.error('Card write error:', e)
    // The card stays `pending_write` so the customer can retry at the reader
    // rather than losing the card they just paid for.
    res.status(502).json({
      error: e.message || 'Failed to write the card',
      retryable: true,
      message: 'Não foi possível gravar o cartão. Tente novamente ou contacte o balcão.',
    })
  }
})

// Read card data from RFID reader
/**
 * POST /pos/alert — a kiosk pushes a hardware-fault notice up while it has
 * connectivity, for the operator's own email alert (hopper empty, RFID
 * reader disconnected, etc.). Best-effort by design: if `alerts.email`
 * isn't configured, this just no-ops rather than erroring the kiosk's
 * hardware-event handling.
 */
router.post('/alert', requireKiosk, async (req, res) => {
  const subject = String(req.body?.subject || '').slice(0, 200)
  const message = String(req.body?.message || '').slice(0, 2000)
  if (!subject) return res.status(400).json({ error: 'subject is required' })
  await sendAlert(req, subject, message)
  res.json({ success: true })
})

/**
 * POST /pos/receipt — email a plain purchase confirmation for a sale batch.
 *
 * Deliberately NOT a fiscal document (no ATCUD, no QR code, no AT/SAF-T
 * registration) — a certified invoicing setup is a separate business/legal
 * decision, not something to fake here. This is just what it already looks
 * like: a confirmation of what was paid, sent to whoever asks for one.
 */
router.post('/receipt', requireKiosk, async (req, res) => {
  const batchId = String(req.body?.batchId || '').trim()
  const email = String(req.body?.email || '').trim()
  if (!batchId) return res.status(400).json({ error: 'batchId is required' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' })

  const SaleT = withTenant(Sale, req)
  const sales = await SaleT.find({ batchId }).populate('machineId', 'name').lean()
  if (!sales.length) return res.status(404).json({ error: 'No sale found for this batch' })

  const total = sales.reduce((s, sale) => s + (sale.amount || 0), 0)
  const lines = sales.map((s) => {
    const label = s.type === 'recharge' ? 'Recarga de cartão' : (s.machineId?.name || 'Máquina')
    return `${label} — €${roundMoney(s.amount).toFixed(2)}`
  })
  const text = [
    'Recibo de compra', '',
    ...lines, '',
    `Total: €${roundMoney(total).toFixed(2)}`,
    `Data: ${new Date(sales[0].createdAt).toLocaleString('pt-PT')}`, '',
    'Obrigado pela sua visita!',
  ].join('\n')

  const rowsHtml = sales.map((s) => {
    const label = s.type === 'recharge' ? 'Recarga de cartão' : (s.machineId?.name || 'Máquina')
    return `<tr><td style="padding:8px 0; border-bottom:1px solid #eef6f4;">${escapeHtml(label)}</td><td style="padding:8px 0; border-bottom:1px solid #eef6f4; text-align:right;">€${roundMoney(s.amount).toFixed(2)}</td></tr>`
  }).join('')
  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${rowsHtml}
      <tr><td style="padding:12px 0 0; font-weight:bold;">Total</td><td style="padding:12px 0 0; font-weight:bold; text-align:right;">€${roundMoney(total).toFixed(2)}</td></tr>
    </table>
    <p style="margin:20px 0 0; font-size:13px; color:#3d6a63;">${escapeHtml(new Date(sales[0].createdAt).toLocaleString('pt-PT'))}</p>
    <p style="margin:20px 0 0;">Obrigado pela sua visita!</p>
  `

  await sendMail({
    to: email,
    subject: 'O seu recibo',
    text,
    html: renderEmailHtml({ title: 'O seu recibo', preheader: `Total: €${roundMoney(total).toFixed(2)}`, bodyHtml, brand: await getEmailBrand(req.tenantId) }),
  })
  res.json({ success: true })
})

router.get('/card/read', requireKiosk, async (req, res) => {
  try {
    const Peripheral = (await import('../models/peripheral.js')).default
    const PeripheralT = withTenant(Peripheral, req)
    const rfidReader = await PeripheralT.findOne({ type: 'rfid_reader', enabled: true })
    
    if (!rfidReader) {
      return res.status(503).json({ error: 'RFID reader not available' })
    }

    // Read card data
    const result = await coinMachine.middleware.readCardData(rfidReader._id)

    if (result.success) {
      res.json({ success: true, cardData: result.cardData })
    } else {
      throw new Error('Failed to read card data')
    }
  } catch (e) {
    console.error('Card read error:', e)
    res.status(500).json({ error: e.message || 'Failed to read card' })
  }
})

// Public: lookup card by code (kiosk will use this to show balance)
router.get('/cards/:code', cardLookupLimiter, requireKiosk, async (req, res) => {
  const code = req.params.code
  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  const c = await CardT.findOne({ code }).lean()
  if (!c) return res.status(404).json({ error: 'Card not found' })
  res.json(c)
})

// Public: what the "My card" window needs from the server's own rules — the minimum top-up and how much
// cheaper the card is than cash per machine type. Nothing sensitive; same exposure as /prices/lookup.
router.get('/card-info', async (req, res) => {
  try {
    const SettingT = withTenant(Setting, req)
    const PriceT = withTenant(Price, req)
    const minRow = await SettingT.findOne({ key: 'loyaltyCard.minRecharge' }).lean()
    const prices = await PriceT.find({}).lean()
    const saving = { wash: 0, dry: 0 }
    for (const p of prices) {
      if (p.type !== 'wash' && p.type !== 'dry') continue
      const diff = Math.round((Number(p.cashPrice || 0) - Number(p.cardPrice || 0)) * 100) / 100
      if (diff > saving[p.type]) saving[p.type] = diff // the most the card saves for that kind of machine
    }
    res.json({ minRecharge: Math.max(0, Number(minRow?.value) || 0), saving })
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load card info' })
  }
})

// Public: lightweight settings lookup for branding and card purchase keys (no auth)
router.get('/settings/:key', async (req, res) => {
  const key = String(req.params.key || '')
  // Allow branding, cardPurchase, loyaltyCard, the kiosk-lock toggle and the
  // homepage banner slides to be read publicly. None of these leak anything
  // sensitive — knowing whether the maintenance-lock feature is turned on
  // isn't meaningful information, and the kiosk needs all of this before a
  // customer session even authenticates as anything (the banner carousel is
  // the very first thing rendered on the homepage).
  if (!key.startsWith('branding.') && !key.startsWith('cardPurchase.') && !key.startsWith('loyaltyCard.') && !key.startsWith('wifi.') && !key.startsWith('legal.') && key !== 'payments.mbway.enabled' && key !== 'kioskLockEnabled' && key !== 'banners' && key !== 'bannersTranslations') {
    return res.status(404).json({ error: 'Not found' })
  }
  const SettingT = withTenant(Setting, req)
  const s = await SettingT.findOne({ key }).lean()
  // A key on the allowlist above that simply has no row yet is a normal,
  // successful "not configured" answer — not a 404. Every caller already
  // reads `.value` off the response, so `{key, value: null}` is a drop-in
  // replacement; it just stops looking like a failed request in devtools.
  res.json(s || { key, value: null })
})

// Spending using card: deduct amount from card balance and create Sale
router.post('/cards/:code/spend', requireKiosk, async (req, res) => {
  const code = req.params.code
  const { machineId, amount, items, method, batchId } = req.body
  if (!code) return res.status(400).json({ error: 'Missing parameters' })
  if (method && String(method) !== 'card') return res.status(400).json({ error: 'Card spending must use method "card"' })

  // Without this a negative amount *credits* the card: `balance - Number(-50)`.
  const parsed = parseAmount(amount)
  if (!parsed.ok) return res.status(400).json({ error: parsed.error })
  const price = parsed.value

  const Card = (await import('../models/card.js')).default
  const CardT = withTenant(Card, req)
  let card = await CardT.findOne({ code })
  if (!card) return res.status(404).json({ error: 'Card not found' })

  // Check the machine is free *before* debiting — otherwise a 409 leaves the
  // customer charged for a wash that never starts.
  const MachineT = withTenant(Machine, req)
  if (machineId) {
    const m = await MachineT.findById(machineId)
    if (!m) return res.status(404).json({ error: 'Machine not found' })
    if (m.status === 'working') return res.status(409).json({ error: 'Machine already in use' })
    if (m.outOfService || m.status === 'offline' || m.status === 'fault') return res.status(409).json({ error: 'Machine out of service' })
  }

  if (card.status === 'pending_write') {
    return res.status(409).json({ error: 'Card is not activated yet — insert it in the reader first', status: card.status })
  }
  if (card.status === 'blocked') return res.status(409).json({ error: 'Card is blocked' })

  // A machine's price comes from the Price table (per block for dryers), not from the number the
  // kiosk sent: this terminal is public.
  let blocks = 1
  let chargePrice = price
  if (machineId) {
    const m = await MachineT.findById(machineId)
    blocks = coinMachine.blocksFor(m, Array.isArray(items) ? items[0] : items)
    const row = await withTenant(Price, req).findOne({ type: m.type || 'wash', weight: m.weight })
    if (row) {
      const unit = promoIsActive(row) && row.promoCardPrice != null ? row.promoCardPrice : row.cardPrice
      if (unit > 0) chargePrice = roundMoney(unit * blocks)
    }
  }

  // Start the machine BEFORE the card is debited: if it cannot start nothing is charged.
  if (machineId) {
    try {
      await coinMachine.startPaidMachine(machineId, blocks)
    } catch (e) {
      console.error('[pos] machine did not start:', e.message)
      return res.status(502).json({ error: 'A máquina não arrancou. Nada foi cobrado.', detail: e.message })
    }
  }

  const debited = await debitCard(CardT, { _id: card._id }, chargePrice)
  if (!debited) return res.status(400).json({ error: 'Insufficient balance', balance: card.balance })
  card = debited

  const SaleT = withTenant(Sale, req)
  const sale = await SaleT.create({ machineId, amount: chargePrice, items, method: 'card', batchId, type: 'payment', cardId: card._id, cardCode: card.code })

  // Update machine state if relevant
  if (machineId) {
    await MachineT.findByIdAndUpdate(machineId, { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } })
    const updated = await MachineT.findById(machineId)
    try { await broadcastMachine(updated) } catch (e) { console.error('[pos] broadcastMachine error', e) }
    return res.json({ sale, machine: updated, card })
  }

  res.json({ sale, card })
})

export default router

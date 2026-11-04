/**
 * WashBubbles Sync API Routes
 * Server-side endpoints for POS clients to push/pull data
 */
import express from 'express'
import mongoose from 'mongoose'
import { requireKiosk } from '../middleware/auth.js'
import { withTenant } from '../services/tenant.js'

import Sale from '../models/sale.js'
import Coupon from '../models/coupon.js'
import Card from '../models/card.js'
import Machine from '../models/machine.js'
import Price from '../models/price.js'
import Setting from '../models/setting.js'
import Interface from '../models/interface.js'
import Peripheral from '../models/peripheral.js'
import SyncCommand from '../models/syncCommand.js'
import DayClose from '../models/dayClose.js'
import { roundMoney } from '../utils/money.js'
import { logAction } from '../services/auditLog.js'

const router = express.Router()

/** Largest single balance change a kiosk may push. Caps the blast radius of a
 *  compromised or buggy terminal — a real recharge is tens of euros. */
const MAX_DELTA = 1000
/** How many applied-delta ids to keep per card. Well past any realistic retry
 *  window, and bounded so the array can't grow forever. */
const MAX_APPLIED_DELTAS = 200

// All sync routes require kiosk authentication
router.use(requireKiosk)

// ─── Mail relay: a shop PC sends its e-mails THROUGH the central server ───
// The shop's mailbox password lives (encrypted) only here. The PC hands over one message; the server sends it with the SHOP's own
// mailbox (or the platform's, under the shop's name). Limited per shop so a stolen kiosk key cannot be used to spam.
const mailWindow = new Map() // tenantId -> number[] (send times)
const MAIL_PER_MIN = 20
const MAIL_PER_DAY = 500
router.post('/mail', async (req, res) => {
  const { to, subject, text, html } = req.body || {}
  const addr = String(to || '').trim()
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(addr)) return res.status(400).json({ error: 'Invalid recipient' })
  if (!subject || String(subject).length > 200 || !(text || html) || String(text || '').length > 100_000 || String(html || '').length > 200_000) return res.status(400).json({ error: 'Invalid message' })
  const key = String(req.tenantId)
  const now = Date.now()
  const times = (mailWindow.get(key) || []).filter((t) => now - t < 24 * 3600_000)
  if (times.filter((t) => now - t < 60_000).length >= MAIL_PER_MIN || times.length >= MAIL_PER_DAY) return res.status(429).json({ error: 'Too many e-mails from this shop' })
  times.push(now); mailWindow.set(key, times)
  const { sendMail } = await import('../services/mailer.js')
  try {
    await sendMail({ tenantId: req.tenantId, to: addr, subject: String(subject), text: String(text || ''), html: html ? String(html) : undefined, relayed: true })
    res.json({ ok: true })
  } catch (err) {
    res.status(502).json({ error: err.message || 'send failed' })
  }
})

// ─── Push: POS → Server ───

/**
 * POST /api/sync/push/sale
 * Receives a sale created locally on the POS
 */
router.post('/push/sale', async (req, res) => {
  try {
    const data = req.body
    const SaleT = withTenant(Sale, req)

    // Check for duplicate (by local_id or id).
    // Only match on `_id` when the value actually looks like an ObjectId — the
    // kiosk generates UUIDs, and casting one threw a CastError that 500'd every
    // single sale push, so offline sales never synced at all.
    const localId = data.local_id || data.id
    const or = [{ 'metadata.localId': localId }]
    if (mongoose.Types.ObjectId.isValid(data.id)) or.push({ _id: data.id })
    const existing = await SaleT.findOne({ $or: or })

    if (existing) {
      // refunded at the shop after it was sent: the central copy follows (the shop works offline and tells us when it can)
      if (data.status === 'refunded' && existing.status !== 'refunded') {
        existing.status = 'refunded'
        await existing.save()
        return res.json({ success: true, id: existing._id, status: 'updated' })
      }
      return res.json({ success: true, id: existing._id, status: 'duplicate' })
    }

    if (!localId) {
      return res.status(400).json({ success: false, error: 'local_id is required for idempotent sale push' })
    }

    // `admin_start` sales are legitimately €0, so zero is allowed here; negatives
    // are not — they would silently reduce the day's takings.
    const amount = Number(data.amount)
    const isRefund = data.type === 'refund'
    // a refund is the one row that is negative (it reverses a sale)
    if (!Number.isFinite(amount) || (isRefund ? amount > 0 : amount < 0)) {
      return res.status(400).json({ success: false, error: isRefund ? 'a refund must be zero or negative' : 'amount must be a non-negative number' })
    }
    let refundOfId
    if (isRefund && data.refund_of) {
      const ref = String(data.refund_of)
      const orig = await SaleT.findOne({ $or: [{ 'metadata.localId': ref }, ...(mongoose.Types.ObjectId.isValid(ref) ? [{ _id: ref }] : [])] })
      if (orig) {
        refundOfId = orig._id
        if (orig.status !== 'refunded') { orig.status = 'refunded'; await orig.save() }
      }
    }

    // Create sale on server
    const sale = await SaleT.create({
      machineId: mongoose.Types.ObjectId.isValid(data.machine_id || data.machineId)
        ? (data.machine_id || data.machineId)
        : undefined,
      amount: roundMoney(amount),
      items: typeof data.items === 'string' ? JSON.parse(data.items) : data.items,
      type: data.type || 'payment',
      method: data.method,
      batchId: data.batch_id || data.batchId,
      cardId: mongoose.Types.ObjectId.isValid(data.card_id || data.cardId)
        ? (data.card_id || data.cardId)
        : undefined,
      cardCode: data.card_code || data.cardCode,
      ...(isRefund ? { refundOf: refundOfId, refundReason: String(data.refund_reason || '').slice(0, 300) } : {}),
      inserted: roundMoney(Math.max(0, Number(data.inserted) || 0)),
      change: roundMoney(Math.max(0, Number(data.change_amount ?? data.change) || 0)),
      createdAt: data.created_at ? new Date(data.created_at) : new Date(),
      // req.user is the decoded token and has no _id — use the loaded document.
      metadata: { localId, posId: req.userModel?._id, syncedAt: new Date() }
    })

    // A gift card handed out at the shop must show in the central audit trail too (the shop's own trail stays on the shop PC).
    if (sale.type === 'gift_card') {
      const it = Array.isArray(sale.items) ? sale.items[0] : null
      await logAction(req, 'card.gift_issued', 'Card', sale.cardId || sale.cardCode, { cardCode: sale.cardCode, credit: Number(it?.credit || 0), by: it?.by || 'loja', source: 'sincronizado da loja' })
    }

    res.json({ success: true, id: sale._id, status: 'created' })
  } catch (err) {
    console.error('[Sync] Push sale error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/sync/push/card
 * Receives card balance updates from POS (delta-based merge)
 */
router.post('/push/card', async (req, res) => {
  try {
    const data = req.body
    const CardT = withTenant(Card, req)

    if (data.create) {
      // A card sold entirely offline (the kiosk's local engine, no
      // connectivity at time of purchase) has no server row at all yet — a
      // sale alone never creates one. Idempotent on code: a retried push
      // (popup reopened, a timeout) must not mint a second card for the same
      // physical card that was already dispensed.
      if (!data.code) return res.status(400).json({ success: false, error: 'code is required to create a card' })
      // The kiosk generates this id itself and asks the DOCUMENT to be
      // created there, so the local and server copies are the SAME row from
      // the moment it exists — no reconciliation needed on a later pull.
      const explicitId = /^[a-f0-9]{24}$/i.test(String(data.id || '')) ? data.id : undefined
      // A purchase that the shop re-keyed to the chip's own id: rename the row it already holds here (and its sales), so the
      // same physical card never becomes two cards.
      if (data.previousCode && String(data.previousCode) !== String(data.code)) {
        const already = await CardT.findOne({ code: data.code })
        const old = already ? null : await CardT.findOne({ code: String(data.previousCode) })
        if (old) {
          await CardT.findOneAndUpdate({ _id: old._id }, { $set: { code: data.code } })
          await withTenant(Sale, req).updateMany({ cardCode: String(data.previousCode) }, { cardCode: data.code })
        }
      }
      const created = await CardT.findOneAndUpdate(
        { code: data.code },
        {
          $setOnInsert: {
            ...(explicitId ? { _id: explicitId } : {}),
            code: data.code,
            balance: roundMoney(Math.max(0, Number(data.balance) || 0)),
            status: data.status === 'active' ? 'active' : 'pending_write',
            name: data.name || '', email: data.email || '', phone: data.phone || '', contribuinte: data.contribuinte || '',
            marketingOptIn: Boolean(data.marketingOptIn),
            privacyConsentAt: data.privacyConsentAt ? new Date(data.privacyConsentAt) : null,
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
      return res.json({ success: true, id: created._id, status: 'created', balance: created.balance })
    }

    const card = data.code
      ? await CardT.findOne({ code: data.code })
      : await CardT.findById(data.id)

    if (!card) {
      return res.status(404).json({ success: false, error: 'Card not found' })
    }

    if (data.status !== undefined && data.delta === undefined && data.balance === undefined) {
      // The ONLY status transition a kiosk may push is finishing a write it
      // just performed — pending_write -> active. Never blocked -> active: a
      // compromised kiosk credential re-activating a card an admin blocked
      // (lost/stolen) would silently defeat the whole point of blocking it.
      if (data.status !== 'active' || card.status !== 'pending_write') {
        return res.status(409).json({ success: false, error: 'Card is not awaiting activation' })
      }
      const updated = await CardT.findByIdAndUpdate(card._id, { $set: { status: 'active', updatedAt: new Date() } }, { new: true })
      return res.json({ success: true, id: updated._id, status: updated.status })
    }

    if (data.delta !== undefined) {
      // Delta push (preferred for multi-POS). The kiosk retries these after a
      // timeout or a power cut, so it MUST be idempotent: without the dedupe key
      // a retry turns a €20 recharge into €40, and debits double the same way.
      const delta = roundMoney(Number(data.delta))
      if (!Number.isFinite(delta)) {
        return res.status(400).json({ success: false, error: 'delta must be a number' })
      }
      if (Math.abs(delta) > MAX_DELTA) {
        return res.status(400).json({ success: false, error: `delta exceeds ±${MAX_DELTA}` })
      }

      const opId = String(data.localId || data.local_id || data.opId || '')
      if (!opId) {
        return res.status(400).json({ success: false, error: 'delta pushes require a localId for idempotency' })
      }

      // Dedupe, sufficiency check and the balance change are ONE update.
      // Doing them as read-then-write let two concurrent retries of the same
      // push both pass the `includes(opId)` check and both apply the delta —
      // exactly the double-credit the idempotency key exists to prevent.
      const guard = { _id: card._id, appliedDeltas: { $ne: opId } }
      if (delta < 0) guard.balance = { $gte: -delta - 0.005 }

      const updated = await CardT.findOneAndUpdate(
        guard,
        {
          $inc: { balance: delta },
          $set: { updatedAt: new Date() },
          // $slice keeps the dedupe log bounded without a read-modify-write.
          $push: { appliedDeltas: { $each: [opId], $slice: -MAX_APPLIED_DELTAS } }
        },
        { new: true }
      )

      if (!updated) {
        // The guard failed. Re-read to say which clause rejected it.
        const current = await CardT.findById(card._id)
        if (!current) return res.status(404).json({ success: false, error: 'Card not found' })
        if ((current.appliedDeltas || []).includes(opId)) {
          return res.json({ success: true, id: current._id, balance: current.balance, status: 'duplicate' })
        }
        return res.status(409).json({ success: false, error: 'Delta would drive the balance negative', balance: current.balance })
      }

      return res.json({ success: true, id: updated._id, balance: roundMoney(updated.balance) })
    }

    if (data.balance !== undefined) {
      // Absolute value fallback (single POS scenario). Last-writer-wins by
      // definition — only safe on a single-kiosk site.
      const balance = Number(data.balance)
      if (!Number.isFinite(balance) || balance < 0) {
        return res.status(400).json({ success: false, error: 'balance must be a non-negative number' })
      }
      const updated = await CardT.findByIdAndUpdate(
        card._id,
        { $set: { balance: roundMoney(balance), updatedAt: new Date() } },
        { new: true }
      )
      return res.json({ success: true, id: updated._id, balance: updated.balance })
    }

    return res.status(400).json({ success: false, error: 'Provide either delta or balance' })
  } catch (err) {
    console.error('[Sync] Push card error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/sync/push/flow
 * A customer action of the shop (selected, paid, change, impulse...) with its steps, sent when it is over. Idempotent: the same flow
 * sent again replaces itself. The shop is the key's shop; nothing in the body can name another one.
 */
router.post('/push/flow', async (req, res) => {
  try {
    const b = req.body || {}
    const flowId = String(b.flowId || '')
    if (!flowId || flowId.length > 80) return res.status(400).json({ success: false, error: 'Missing flowId' })
    const FlowModel = (await import('../models/flow.js')).default
    const steps = (Array.isArray(b.steps) ? b.steps : []).slice(-300).map((s) => ({
      at: new Date(s.at), type: String(s.type || '').slice(0, 40), text: String(s.text || '').slice(0, 400), ok: s.ok !== false, data: s.data && typeof s.data === 'object' ? s.data : null,
    })).filter((s) => !Number.isNaN(s.at.getTime()))
    const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0)
    const doc = {
      kind: String(b.kind || 'other').slice(0, 30), status: ['open', 'done', 'problem', 'interrupted'].includes(b.status) ? b.status : 'done',
      endedAt: b.endedAt ? new Date(b.endedAt) : null, lastAt: new Date(b.lastAt || Date.now()), title: String(b.title || '').slice(0, 300),
      machines: (Array.isArray(b.machines) ? b.machines : []).map((m) => String(m).slice(0, 60)).slice(0, 12), cardCode: String(b.cardCode || '').slice(-4),
      method: String(b.method || '').slice(0, 12), amount: num(b.amount), inserted: num(b.inserted), change: num(b.change), problems: Math.max(0, parseInt(b.problems, 10) || 0), steps,
    }
    // the shop is req.tenantId (set from the key): it is in the filter, so an upsert can only ever create/replace THIS shop's flow
    await FlowModel.updateOne({ tenantId: req.tenantId, flowId }, { $set: doc, $setOnInsert: { startedAt: new Date(b.startedAt || Date.now()) } }, { upsert: true })
    res.json({ success: true })
  } catch (err) {
    console.error('[Sync] Push flow error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/sync/push/day-close
 * Receives a Z-report (day close) produced locally on the POS.
 *
 * The kiosk has always pushed to this path (`sync-engine.cjs:_pushItem`) but the
 * route did not exist, so every Z-report 404'd and was abandoned after 10 retries.
 */
router.post('/push/day-close', async (req, res) => {
  try {
    const data = req.body
    const DayCloseT = withTenant(DayClose, req)

    const localId = String(data.local_id || data.localId || data.id || '')
    if (localId) {
      const existing = await DayCloseT.findOne({ 'metadata.localId': localId })
      if (existing) {
        return res.json({ success: true, id: existing._id, status: 'duplicate' })
      }
    }

    // Field names follow the kiosk's snake_case payload (`pos-engine.closeDay`).
    const totalCash = roundMoney(data.total_cash ?? data.totalCash ?? 0)
    const dayClose = await DayCloseT.create({
      source: 'kiosk',
      totalSales: roundMoney(data.total_sales ?? data.totalSales ?? 0),
      totalCash,
      totalCard: roundMoney(data.total_card ?? data.totalCard ?? 0),
      totalRecharges: roundMoney(data.total_recharges ?? data.totalRecharges ?? 0),
      salesCount: Number(data.sale_count ?? data.salesCount ?? 0) || 0,
      // The kiosk cannot know the physical count, so expected == cash taken and
      // the operator reconciles later from the dashboard.
      expectedCash: totalCash,
      closedBy: req.userModel?._id,
      closedByUsername: req.userModel?.username || '',
      periodTo: data.created_at ? new Date(data.created_at) : new Date(),
      notes: data.notes || '',
      metadata: { localId, date: data.date, syncedAt: new Date() }
    })

    res.json({ success: true, id: dayClose._id, status: 'created' })
  } catch (err) {
    console.error('[Sync] Push day-close error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/sync/push/machine
 * Receives machine status updates from POS
 */
router.post('/push/machine', async (req, res) => {
  try {
    const data = req.body
    const MachineT = withTenant(Machine, req)

    const machine = await MachineT.findById(data.id)
    if (!machine) {
      return res.status(404).json({ success: false, error: 'Machine not found' })
    }

    // Update runtime status (POS wins for status)
    if (data.status) machine.status = data.status
    if (data.statusText) machine.statusText = data.statusText
    if (data.cycle !== undefined) machine.cycle = data.cycle
    if (data.currentProgram !== undefined) machine.currentProgram = data.currentProgram
    if (data.startedAt !== undefined) machine.startedAt = data.startedAt ? new Date(data.startedAt) : null

    await machine.save()

    // Broadcast to admin WebSocket clients if available
    try {
      const { broadcastMachine } = await import('../wsServer.js')
      await broadcastMachine(machine)
    } catch (e) { /* wsServer may not be loaded */ }

    res.json({ success: true, id: machine._id })
  } catch (err) {
    console.error('[Sync] Push machine error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/sync/push/peripheral-status
 * The shop reports how each peripheral is doing right now, so this server's admin shows
 * real hardware health. Only `status` is touched; ids are the central ids the shop
 * pulled (see services/downlink.js).
 * Body: { peripherals: [{ id, status }] }
 */
router.post('/push/peripheral-status', async (req, res) => {
  try {
    const list = Array.isArray(req.body?.peripherals) ? req.body.peripherals.slice(0, 50) : []
    const allowed = new Set(['ok', 'fault', 'offline', 'unknown'])
    const PeripheralT = withTenant(Peripheral, req)
    let updated = 0
    for (const p of list) {
      if (!p || !mongoose.isValidObjectId(p.id) || !allowed.has(p.status)) continue
      const doc = await PeripheralT.findByIdAndUpdate(p.id, { status: p.status }, { new: true })
      if (doc) updated++
    }
    res.json({ success: true, updated })
  } catch (err) {
    console.error('[Sync] Push peripheral-status error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * POST /api/sync/push/machine-status
 * The shop reports whether each machine is free, occupied or faulty. A machine the operator took
 * out of service on this server keeps that state: the operator's word wins over the shop's reading.
 */
router.post('/push/machine-status', async (req, res) => {
  try {
    const list = Array.isArray(req.body?.machines) ? req.body.machines.slice(0, 100) : []
    const allowed = new Set(['free', 'working', 'reserved', 'fault', 'offline'])
    const MachineT = withTenant(Machine, req)
    let updated = 0
    for (const x of list) {
      if (!x || !mongoose.isValidObjectId(x.id) || !allowed.has(x.status)) continue
      const doc = await MachineT.findOneAndUpdate(
        { _id: x.id, outOfService: { $ne: true }, $or: [{ status: { $ne: x.status } }, { statusText: { $ne: String(x.statusText || '') } }] },
        { status: x.status, statusText: String(x.statusText || '').slice(0, 80) },
        { new: true },
      )
      if (doc) {
        updated++
        try { const { broadcastMachine } = await import('../wsServer.js'); await broadcastMachine(doc) } catch { /* wsServer may not be loaded */ }
      }
    }
    res.json({ success: true, updated })
  } catch (err) {
    console.error('[Sync] Push machine-status error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── Remote Commands: POS Pulls from Server ───

/**
 * GET /api/sync/commands
 * POS pulls pending remote maintenance commands
 */
router.get('/commands', async (req, res) => {
  try {
    const SyncCommandT = withTenant(SyncCommand, req)
    // Only fetch commands for the authenticated kiosk user.
    // `req.user` is the decoded token ({sub, role}) and has no `_id`; Mongoose
    // strips the undefined key, so this used to match EVERY pending command in
    // the tenant and each kiosk executed every other kiosk's reboots.
    const commands = await SyncCommandT.find({
      kioskId: req.userModel._id,
      status: 'pending'
    }).lean()

    // Mark as "executing" so they aren't pulled twice
    if (commands.length > 0) {
      const ids = commands.map(c => c._id)
      await SyncCommandT.updateMany({ _id: { $in: ids } }, { status: 'executing' })
    }

    res.json(commands.map(c => ({ id: c._id, type: c.type, payload: c.payload, createdAt: c.createdAt })))
  } catch (err) {
    console.error('[Sync] Pull commands error:', err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/sync/commands/:id/done
 * POS reports command success
 */
router.post('/commands/:id/done', async (req, res) => {
  try {
    const SyncCommandT = withTenant(SyncCommand, req)
    const cmd = await SyncCommandT.findByIdAndUpdate(req.params.id, {
      status: 'done',
      executedAt: new Date(),
      ...(req.body?.result !== undefined ? { result: req.body.result } : {})
    }, { new: true })
    // A card wiped at the shop: forget it here too (its sales stay).
    if (cmd && cmd.type === 'blank_card' && req.body?.result?.code) {
      const { forgetCard } = await import('../services/cardForget.js')
      await forgetCard(req.tenantId, req.body.result.code).catch(() => {})
    }
    // The shop did it: reflect it on this (central) server's own copy of the machine, so the
    // admin screen shows what really happened and not merely that a request was sent.
    if (cmd && (cmd.type === 'start_machine' || cmd.type === 'end_machine') && cmd.payload?.machineId && mongoose.isValidObjectId(cmd.payload.machineId)) {
      const MachineT = withTenant(Machine, req)
      const started = cmd.type === 'start_machine'
      const m = await MachineT.findByIdAndUpdate(cmd.payload.machineId, started
        ? { status: 'working', statusText: 'Ocupado', startedAt: new Date() }
        : { status: 'free', statusText: 'Livre', startedAt: null, currentProgram: null }, { new: true })
      if (m) {
        try { const { broadcastMachine } = await import('../wsServer.js'); await broadcastMachine(m) } catch { /* wsServer may not be loaded */ }
      }
    }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/sync/commands/:id/fail
 * POS reports command failure
 */
router.post('/commands/:id/fail', async (req, res) => {
  try {
    const { error } = req.body
    const SyncCommandT = withTenant(SyncCommand, req)
    await SyncCommandT.findByIdAndUpdate(req.params.id, { 
      status: 'failed', 
      error,
      executedAt: new Date() 
    })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Pull: Server → POS ───

/** Generic helper for pull endpoints */
async function handlePull(req, res, Model, label) {
  try {
    const ModelT = withTenant(Model, req)
    // No `since` = a full snapshot. Filtering on updatedAt >= epoch would silently
    // drop every row of a model with no updatedAt field (machines, settings), so a
    // new kiosk pulled zero machines.
    const query = req.query.since ? { updatedAt: { $gte: new Date(req.query.since) } } : {}
    let items = await ModelT.find(query).lean()
    // the shop's mailbox password never travels to a shop PC (it is only meaningful on the central server)
    if (Model === Setting) items = items.filter((s) => s.key !== 'shopmail.account')
    res.json(items)
  } catch (err) {
    console.error(`[Sync] Pull ${label} error:`, err)
    res.status(500).json({ error: err.message })
  }
}

/**
 * GET /api/sync/pull/sale-corrections
 * What the central admin changed about SALES (a refund, a voided sale), for the shop to copy. The ids differ between the two sides, so
 * every row carries the SHOP's own id (metadata.localId) where there is one. Sales have no updatedAt: the window is the sale's date.
 */
router.get('/pull/sale-corrections', async (req, res) => {
  try {
    const SaleT = withTenant(Sale, req)
    const since = new Date(Date.now() - 400 * 86_400_000)
    const rows = await SaleT.find({ createdAt: { $gte: since }, $or: [{ status: 'refunded' }, { type: 'refund' }] }).lean()
    const refunds = rows.filter((r) => r.type === 'refund')
    const origIds = refunds.map((r) => r.refundOf).filter(Boolean)
    const origs = origIds.length ? await SaleT.find({ _id: { $in: origIds } }).select('metadata').lean() : []
    const localOf = new Map(origs.map((o) => [String(o._id), o.metadata?.localId || null]))
    res.json({
      refunded: rows.filter((r) => r.type !== 'refund' && r.status === 'refunded').map((r) => ({ id: String(r._id), localId: r.metadata?.localId || null })),
      refunds: refunds.map((r) => ({
        id: String(r._id), localId: r.metadata?.localId || null, amount: r.amount, method: r.method, batchId: r.batchId,
        machineId: r.machineId ? String(r.machineId) : null, refundReason: r.refundReason || '', createdAt: r.createdAt,
        refundOfLocalId: r.refundOf ? (localOf.get(String(r.refundOf)) || null) : null,
      })),
    })
  } catch (err) {
    console.error('[Sync] Pull sale-corrections error:', err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/sync/push/coupon
 * How many times the shop has used a coupon. The shop is where coupons are used; the number only ever goes up, so a late or repeated
 * push can never lower it.
 */
router.post('/push/coupon', async (req, res) => {
  try {
    const code = String(req.body?.code || '').toUpperCase().trim()
    const n = Math.floor(Number(req.body?.redemption_count))
    if (!code || !Number.isFinite(n) || n < 0) return res.status(400).json({ success: false, error: 'code and redemption_count are required' })
    await Coupon.updateOne({ tenantId: req.tenantId, code }, { $max: { redemptionCount: n } })
    res.json({ success: true })
  } catch (err) {
    console.error('[Sync] Push coupon error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

router.get('/pull/coupons', (req, res) => handlePull(req, res, Coupon, 'coupons'))
router.get('/pull/cards', (req, res) => handlePull(req, res, Card, 'cards'))
router.get('/pull/machines', (req, res) => handlePull(req, res, Machine, 'machines'))
router.get('/pull/prices', (req, res) => handlePull(req, res, Price, 'prices'))
router.get('/pull/settings', (req, res) => handlePull(req, res, Setting, 'settings'))
router.get('/pull/interfaces', (req, res) => handlePull(req, res, Interface, 'interfaces'))
router.get('/pull/peripherals', (req, res) => handlePull(req, res, Peripheral, 'peripherals'))

export default router

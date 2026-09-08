/**
 * WashBubbles Sync API Routes
 * Server-side endpoints for POS clients to push/pull data
 */
import express from 'express'
import mongoose from 'mongoose'
import { requireKiosk } from '../middleware/auth.js'
import { withTenant } from '../services/tenant.js'

import Sale from '../models/sale.js'
import Card from '../models/card.js'
import Machine from '../models/machine.js'
import Price from '../models/price.js'
import Setting from '../models/setting.js'
import Interface from '../models/interface.js'
import Peripheral from '../models/peripheral.js'
import SyncCommand from '../models/syncCommand.js'
import DayClose from '../models/dayClose.js'
import { roundMoney } from '../utils/money.js'

const router = express.Router()

/** Largest single balance change a kiosk may push. Caps the blast radius of a
 *  compromised or buggy terminal — a real recharge is tens of euros. */
const MAX_DELTA = 1000
/** How many applied-delta ids to keep per card. Well past any realistic retry
 *  window, and bounded so the array can't grow forever. */
const MAX_APPLIED_DELTAS = 200

// All sync routes require kiosk authentication
router.use(requireKiosk)

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
      return res.json({ success: true, id: existing._id, status: 'duplicate' })
    }

    if (!localId) {
      return res.status(400).json({ success: false, error: 'local_id is required for idempotent sale push' })
    }

    // `admin_start` sales are legitimately €0, so zero is allowed here; negatives
    // are not — they would silently reduce the day's takings.
    const amount = Number(data.amount)
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ success: false, error: 'amount must be a non-negative number' })
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
      inserted: roundMoney(Math.max(0, Number(data.inserted) || 0)),
      change: roundMoney(Math.max(0, Number(data.change_amount ?? data.change) || 0)),
      createdAt: data.created_at ? new Date(data.created_at) : new Date(),
      // req.user is the decoded token and has no _id — use the loaded document.
      metadata: { localId, posId: req.userModel?._id, syncedAt: new Date() }
    })

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
      const created = await CardT.findOneAndUpdate(
        { code: data.code },
        {
          $setOnInsert: {
            ...(explicitId ? { _id: explicitId } : {}),
            code: data.code,
            balance: roundMoney(Math.max(0, Number(data.balance) || 0)),
            status: data.status === 'active' ? 'active' : 'pending_write',
            name: data.name || '', email: data.email || '', phone: data.phone || '', contribuinte: data.contribuinte || ''
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

    res.json(commands.map(c => ({ id: c._id, type: c.type, payload: c.payload })))
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
    await SyncCommandT.findByIdAndUpdate(req.params.id, { 
      status: 'done', 
      executedAt: new Date() 
    })
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
    const since = req.query.since ? new Date(req.query.since) : new Date(0)
    const ModelT = withTenant(Model, req)
    const items = await ModelT.find({ updatedAt: { $gte: since } }).lean()
    res.json(items)
  } catch (err) {
    console.error(`[Sync] Pull ${label} error:`, err)
    res.status(500).json({ error: err.message })
  }
}

router.get('/pull/cards', (req, res) => handlePull(req, res, Card, 'cards'))
router.get('/pull/machines', (req, res) => handlePull(req, res, Machine, 'machines'))
router.get('/pull/prices', (req, res) => handlePull(req, res, Price, 'prices'))
router.get('/pull/settings', (req, res) => handlePull(req, res, Setting, 'settings'))
router.get('/pull/interfaces', (req, res) => handlePull(req, res, Interface, 'interfaces'))
router.get('/pull/peripherals', (req, res) => handlePull(req, res, Peripheral, 'peripherals'))

export default router

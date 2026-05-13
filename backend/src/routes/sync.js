/**
 * WashBubbles Sync API Routes
 * Server-side endpoints for POS clients to push/pull data
 */
import express from 'express'
import { requireKiosk } from '../middleware/auth.js'
import { withTenant } from '../services/tenant.js'

import Sale from '../models/sale.js'
import Card from '../models/card.js'
import Machine from '../models/machine.js'

const router = express.Router()

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

    // Check for duplicate (by local_id or id)
    const localId = data.local_id || data.id
    const existing = await SaleT.findOne({
      $or: [
        { _id: data.id },
        { 'metadata.localId': localId }
      ]
    })

    if (existing) {
      return res.json({ success: true, id: existing._id, status: 'duplicate' })
    }

    // Create sale on server
    const sale = await SaleT.create({
      machineId: data.machine_id || data.machineId || undefined,
      amount: Number(data.amount),
      items: typeof data.items === 'string' ? JSON.parse(data.items) : data.items,
      type: data.type || 'payment',
      method: data.method,
      batchId: data.batch_id || data.batchId,
      cardId: data.card_id || data.cardId || undefined,
      cardCode: data.card_code || data.cardCode,
      inserted: Number(data.inserted || 0),
      change: Number(data.change_amount || data.change || 0),
      createdAt: data.created_at ? new Date(data.created_at) : new Date(),
      metadata: { localId, posId: req.user?._id, syncedAt: new Date() }
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

    const card = data.code
      ? await CardT.findOne({ code: data.code })
      : await CardT.findById(data.id)

    if (!card) {
      return res.status(404).json({ success: false, error: 'Card not found' })
    }

    // If delta is provided, apply it (preferred for multi-POS)
    if (data.delta !== undefined) {
      card.balance = Number(((card.balance || 0) + Number(data.delta)).toFixed(2))
    } else {
      // Absolute value fallback (single POS scenario)
      card.balance = Number(data.balance)
    }

    card.updatedAt = new Date()
    await card.save()

    res.json({ success: true, id: card._id, balance: card.balance })
  } catch (err) {
    console.error('[Sync] Push card error:', err)
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

// ─── Pull: Server → POS ───

/**
 * GET /api/sync/pull/cards?since=<ISO timestamp>
 * Returns cards updated since the given timestamp
 */
router.get('/pull/cards', async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0)
    const CardT = withTenant(Card, req)
    const items = await CardT.find({ updatedAt: { $gte: since } }).lean()
    res.json(items)
  } catch (err) {
    console.error('[Sync] Pull cards error:', err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/sync/pull/machines?since=<ISO timestamp>
 * Returns machine configs updated since the given timestamp
 */
router.get('/pull/machines', async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0)
    const MachineT = withTenant(Machine, req)
    const items = await MachineT.find({ updatedAt: { $gte: since } }).lean()
    res.json(items)
  } catch (err) {
    console.error('[Sync] Pull machines error:', err)
    res.status(500).json({ error: err.message })
  }
})

export default router

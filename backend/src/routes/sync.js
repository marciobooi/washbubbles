/**
 * WashBubbles Sync API Routes
 * Server-side endpoints for POS clients to push/pull data
 */
import express from 'express'
import { requireKiosk } from '../middleware/auth.js'
import { withTenant } from '../services/tenant.js'

import Sale from '../models/sale.js'
import Card from '../models/card.js'
import Price from '../models/price.js'
import Setting from '../models/setting.js'
import Interface from '../models/interface.js'
import Peripheral from '../models/peripheral.js'
import SyncCommand from '../models/syncCommand.js'

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

// ─── Remote Commands: POS Pulls from Server ───

/**
 * GET /api/sync/commands
 * POS pulls pending remote maintenance commands
 */
router.get('/commands', async (req, res) => {
  try {
    const SyncCommandT = withTenant(SyncCommand, req)
    // Only fetch commands for the authenticated kiosk user
    const commands = await SyncCommandT.find({ 
      kioskId: req.user._id, 
      status: 'pending' 
    }).lean()
    
    // Mark as "executing" so they aren't pulled twice
    if (commands.length > 0) {
      const ids = commands.map(c => c._id)
      await SyncCommand.updateMany({ _id: { $in: ids } }, { status: 'executing' })
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

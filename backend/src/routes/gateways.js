import express from 'express'
import Machine from '../models/machine.js'
import Sale from '../models/sale.js'
import Card from '../models/card.js'
import { requireKiosk } from '../middleware/auth.js'
import { broadcastMachine, broadcastHardwareEvent } from '../wsServer.js'
import { withTenant } from '../services/tenant.js'

const router = express.Router()

// GET /api/gateways/cards/:code - lookup card balance (kiosk only)
router.get('/cards/:code', requireKiosk, async (req, res) => {
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
  if (!code || amount == null) return res.status(400).json({ error: 'Missing parameters' })

  const CardT = withTenant(Card, req)
  const SaleT = withTenant(Sale, req)
  let card = await CardT.findOne({ code })
  if (!card) {
    card = await CardT.create({ code, balance: 0 })
  }
  card.balance = Number((card.balance || 0) + Number(amount))
  await card.save()

  const sale = await SaleT.create({ amount: Number(amount), items: [{ type: 'recharge', amount }], method: 'card', batchId, inserted: Number(amount), change: 0, type: 'recharge', cardId: card._id, cardCode: card.code })

  res.json({ success: true, sale, card })
})

// POST /api/gateways/card/pay - charge card for items (machines + optional recharges in same batch)
router.post('/card/pay', requireKiosk, async (req, res) => {
  const { items = [], cardCode, batchId } = req.body
  if (!Array.isArray(items) || !cardCode) return res.status(400).json({ error: 'Missing parameters' })

  const CardT = withTenant(Card, req)
  const SaleT = withTenant(Sale, req)
  const MachineT = withTenant(Machine, req)

  // Fetch card
  const card = await CardT.findOne({ code: cardCode })
  if (!card) return res.status(404).json({ error: 'Card not found' })

  // Process recharges first
  const recharges = items.filter(i => (i.type && i.type.toLowerCase().includes('recarga')) || (i.id && String(i.id).startsWith('recharge')))
  for (const r of recharges) {
    const amount = Number(r.amount || r.price || 0)
    card.balance = Number((card.balance || 0) + amount)
    await SaleT.create({ amount, items: r, method: 'card', batchId, inserted: amount, change: 0, type: 'recharge', cardId: card._id, cardCode: card.code })
  }

  // Now process machine payments: ensure sufficient balance for total
  const machineItems = items.filter(i => !( (i.type && i.type.toLowerCase().includes('recarga')) || (i.id && String(i.id).startsWith('recharge')) ))
  const total = machineItems.reduce((s, i) => s + (Number(i.price || i.amount || 0)), 0)

  if ((card.balance || 0) < total) {
    await card.save()
    return res.status(400).json({ error: 'Insufficient balance', balance: card.balance })
  }

  const sales = []
  for (const it of machineItems) {
    const price = Number(it.price || it.amount || 0)
    // double-check machine exists and is free
    const machine = await MachineT.findById(it._id || it.id) || await MachineT.findOne({ number: Number(it._id || it.id) })
    if (!machine) return res.status(404).json({ error: 'Machine not found' })
    if (machine.status === 'working') return res.status(409).json({ error: 'Machine already in use', machineId: machine._id })

    // Deduct from card
    card.balance = Number((card.balance || 0) - price)
    await card.save()

    // Create sale
    const sale = await SaleT.create({ machineId: machine._id, amount: price, items: [it], method: 'card', batchId, type: 'payment', cardId: card._id, cardCode: card.code })
    sales.push(sale)

    // Update machine state
    await MachineT.findByIdAndUpdate(machine._id, { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } })
    const updated = await MachineT.findById(machine._id)
    try { await broadcastMachine(updated) } catch (e) { console.error('[gateways] broadcastMachine error', e) }
  }

  res.json({ success: true, sales, card })
})

// POST /api/gateways/cash/pay - charge by cash (inserted/change) and create sales
router.post('/cash/pay', requireKiosk, async (req, res) => {
  const { items = [], inserted = 0, batchId } = req.body
  if (!Array.isArray(items) || inserted == null) return res.status(400).json({ error: 'Missing parameters' })

  const total = items.reduce((s, i) => s + (Number(i.price || i.amount || 0)), 0)
  const change = Math.max(0, Math.round((Number(inserted) - total) * 100) / 100)
  if (inserted + 0.0001 < total) return res.status(400).json({ error: 'Insufficient cash' })

  const sales = []
  // Persist recharges first
  const SaleT = withTenant(Sale, req)
  const MachineT = withTenant(Machine, req)
  for (const r of items.filter(i => (i.type && i.type.toLowerCase().includes('recarga')) || (i.id && String(i.id).startsWith('recharge')))) {
    const amount = Number(r.amount || r.price || 0)
    // cash/pay handler — recharge method must be 'cash', not 'card'
    const sale = await SaleT.create({ amount, items: r, method: 'cash', batchId, inserted: amount, change: 0, type: 'recharge' })
    sales.push(sale)
  }

  // Then machine sales — attach inserted/change to first machine sale
  let assigned = false
  for (const it of items.filter(i => !((i.type && i.type.toLowerCase().includes('recarga')) || (i.id && String(i.id).startsWith('recharge'))))) {
    const price = Number(it.price || it.amount || 0)
    const machine = await MachineT.findById(it._id || it.id) || await MachineT.findOne({ number: Number(it._id || it.id) })
    if (!machine) return res.status(404).json({ error: 'Machine not found' })
    if (machine.status === 'working') return res.status(409).json({ error: 'Machine already in use', machineId: machine._id })

    let saleInserted = 0
    let saleChange = 0
    if (!assigned) {
      saleInserted = Number(inserted)
      saleChange = change
      assigned = true
    }

    const sale = await SaleT.create({ machineId: machine._id, amount: price, items: [it], method: 'cash', batchId, inserted: saleInserted, change: saleChange, type: 'payment' })
    sales.push(sale)

    await MachineT.findByIdAndUpdate(machine._id, { $inc: { cycle: 1 }, $set: { status: 'working', statusText: 'Ocupado' } })
    const updated = await MachineT.findById(machine._id)
    try { await broadcastMachine(updated) } catch (e) { console.error('[gateways] broadcastMachine error', e) }
  }

  // Trigger hopper to dispense change if any is due
  if (change > 0) {
    try {
      broadcastHardwareEvent('hopper:dispense', { amount: change })
      console.log(`[gateways] Dispatched hopper:dispense for €${change.toFixed(2)} change`)
    } catch (e) {
      console.error('[gateways] Failed to broadcast hopper:dispense:', e)
    }
  }

  res.json({ success: true, sales, total, inserted: Number(inserted), change })
})

export default router

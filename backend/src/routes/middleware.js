import express from 'express'
import coinMachine from '../services/coinMachine.js'
import { requireAdmin } from '../middleware/auth.js'
import { withTenant } from '../services/tenant.js'
import Peripheral from '../models/peripheral.js'
import Machine from '../models/machine.js'
import Card from '../models/card.js'

const router = express.Router()

/**
 * Get current client state (balance, credits, card info)
 */
router.get('/client', (req, res) => {
  const state = coinMachine.getClientState()
  res.json(state)
})

/**
 * Get balance summary
 */
router.get('/client/balance', (req, res) => {
  const summary = coinMachine.client.getBalanceSummary()
  res.json(summary)
})

/**
 * Reset client session
 */
router.post('/client/reset', (req, res) => {
  coinMachine.resetClient()
  res.json({ success: true })
})

/**
 * Remove card but keep cash balance
 */
router.post('/client/remove-card', (req, res) => {
  coinMachine.removeCard()
  res.json({ success: true })
})

/**
 * Manually add cash balance (for testing)
 */
router.post('/client/add-cash', (req, res) => {
  const { amount } = req.body
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' })
  }
  
  coinMachine.client.addToBalance(amount)
  res.json({ balance: coinMachine.client.getState().balance })
})

/**
 * Load card by number
 */
router.post('/client/load-card', async (req, res) => {
  const { cardNumber } = req.body
  if (!cardNumber) {
    return res.status(400).json({ error: 'Missing cardNumber' })
  }

  // Ensure card exists within tenant
  const CardT = withTenant(Card, req)
  const card = await CardT.findOne({ code: cardNumber })
  if (!card) return res.status(404).json({ error: 'Card not found' })

  const loaded = await coinMachine.client.setClientInfoByCard(cardNumber)
  if (loaded) {
    res.json({ success: true, client: coinMachine.getClientState() })
  } else {
    res.status(404).json({ error: 'Card not found' })
  }
})

/**
 * Process payment for a machine
 */
router.post('/payment', async (req, res) => {
  try {
    const { machineId, amount, paymentType } = req.body
    
    if (!machineId || !amount) {
      return res.status(400).json({ error: 'Missing machineId or amount' })
    }

    // Validate machine belongs to tenant
    const MachineT = withTenant(Machine, req)
    const machine = await MachineT.findById(machineId) || await MachineT.findOne({ number: Number(machineId) })
    if (!machine) return res.status(404).json({ error: 'Machine not found' })

    const result = await coinMachine.processPayment(machineId, amount, paymentType)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

/**
 * Dispense new card with initial balance
 */
router.post('/dispense-card', requireAdmin, async (req, res) => {
  try {
    const { peripheralId, initialBalance } = req.body
    
    if (!peripheralId) {
      return res.status(400).json({ error: 'Missing peripheralId' })
    }

    // Ensure peripheral belongs to tenant
    const PeripheralT = withTenant(Peripheral, req)
    const p = await PeripheralT.findById(peripheralId)
    if (!p) return res.status(404).json({ error: 'Peripheral not found' })

    const result = await coinMachine.dispenseNewCard(peripheralId, initialBalance || 0)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

/**
 * Dispense change
 */
router.post('/dispense-change', requireAdmin, async (req, res) => {
  try {
    const { peripheralId, amount } = req.body
    
    if (!peripheralId || !amount) {
      return res.status(400).json({ error: 'Missing peripheralId or amount' })
    }

    // Ensure peripheral belongs to tenant
    const PeripheralT = withTenant(Peripheral, req)
    const p = await PeripheralT.findById(peripheralId)
    if (!p) return res.status(404).json({ error: 'Peripheral not found' })

    const result = await coinMachine.dispenseChange(peripheralId, amount)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

/**
 * Print receipt
 */
router.post('/print', requireAdmin, async (req, res) => {
  try {
    const { peripheralId, content } = req.body
    
    if (!peripheralId || !content) {
      return res.status(400).json({ error: 'Missing peripheralId or content' })
    }

    // Ensure peripheral belongs to tenant
    const PeripheralT = withTenant(Peripheral, req)
    const p = await PeripheralT.findById(peripheralId)
    if (!p) return res.status(404).json({ error: 'Peripheral not found' })

    const result = await coinMachine.printReceipt(peripheralId, content)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

/**
 * Get coin machine status
 */
router.get('/status', (req, res) => {
  res.json({
    running: coinMachine.running,
    clientState: coinMachine.getClientState(),
    peripheralCount: coinMachine.middleware.connections.size
  })
})

/**
 * Start coin machine (admin only)
 */
router.post('/start', requireAdmin, async (req, res) => {
  try {
    await coinMachine.start()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * Stop coin machine (admin only)
 */
router.post('/stop', requireAdmin, async (req, res) => {
  try {
    await coinMachine.stop()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * Activate machine(s)
 * Body: { machines: [{id: intId, chn: channel, impulses: '1'}] } or { id, chn, impulses }
 */
router.post('/activate-machine', async (req, res) => {
  try {
    const { machines, id, chn, impulses } = req.body
    
    // Support both single machine and array format
    const activationData = machines || { id, chn, impulses: impulses || '1' }
    
    if (!activationData) {
      return res.status(400).json({ error: 'Missing activation data' })
    }

    // Validate referenced machines belong to tenant
    const MachineT = withTenant(Machine, req)
    if (Array.isArray(activationData)) {
      for (const item of activationData) {
        if (item && item.id != null) {
          const m = await MachineT.findOne({ number: Number(item.id) })
          if (!m) return res.status(404).json({ error: `Machine ${item.id} not found` })
        }
      }
    } else if (activationData.id != null) {
      const m = await MachineT.findOne({ number: Number(activationData.id) })
      if (!m) return res.status(404).json({ error: `Machine ${activationData.id} not found` })
    }

    const result = await coinMachine.activateMachine(activationData)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

/**
 * Get machine states
 */
router.get('/machines', (req, res) => {
  const machines = coinMachine.getMachineStates()
  res.json(machines)
})

/**
 * Get specific machine state
 */
router.get('/machines/:id', (req, res) => {
  const machineId = parseInt(req.params.id)
  const machine = coinMachine.getMachineState(machineId)
  
  if (machine) {
    res.json(machine)
  } else {
    res.status(404).json({ error: 'Machine not found' })
  }
})

export default router

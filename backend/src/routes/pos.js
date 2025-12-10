import express from 'express'

const router = express.Router()

// POS routes are public (can be configured to use token if required)
const getMachineStatus = async (req, res) => {
  const prisma = req.prisma
  const machines = await prisma.machine.findMany({ orderBy: { createdAt: 'asc' } })
  const data = machines.map((m) => ({ id: m.id, name: m.name, status: m.status, cycle: m.cycle }))
  res.json(data)
}

router.get('/machine-status', getMachineStatus)
// Alias used by frontend hook: `/api/machine`
router.get('/machine', getMachineStatus)
  const prisma = req.prisma
  const machines = await prisma.machine.findMany({ orderBy: { createdAt: 'asc' } })
  // Return simplified info for POS
  const data = machines.map((m) => ({ id: m.id, name: m.name, status: m.status, cycle: m.cycle }))
  res.json(data)
})

router.post('/sale', async (req, res) => {
  const prisma = req.prisma
  const { machineId, amount, items } = req.body
  if (!machineId || !amount || !items) return res.status(400).json({ error: 'Missing parameters' })

  const sale = await prisma.sale.create({ data: { machineId, amount: Number(amount), items: items } })

  // Optionally update machine cycle or status
  await prisma.machine.update({ where: { id: machineId }, data: { cycle: { increment: 1 } } })

  res.json(sale)
})

export default router

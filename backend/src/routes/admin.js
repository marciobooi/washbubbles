import express from 'express'
import { requireAdmin } from '../middleware/auth.js'

const router = express.Router()

// All admin routes require admin JWT
router.use(requireAdmin)

// list machines
router.get('/machines', async (req, res) => {
  const prisma = req.prisma
  const machines = await prisma.machine.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(machines)
})

// create machine
router.post('/machines', async (req, res) => {
  const prisma = req.prisma
  const { name, status } = req.body
  if (!name) return res.status(400).json({ error: 'Missing name' })

  const machine = await prisma.machine.create({ data: { name, status } })
  res.json(machine)
})

export default router

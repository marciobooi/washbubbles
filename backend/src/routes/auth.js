import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const router = express.Router()
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretadminjwt'

router.post('/login', async (req, res) => {
  const prisma = req.prisma
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' })

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })

  const ok = await bcrypt.compare(password, user.password)
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' })

  const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, {
    expiresIn: '8h',
  })

  return res.json({ token })
})

export default router

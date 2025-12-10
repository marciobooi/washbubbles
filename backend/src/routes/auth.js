import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import User from '../models/user.js'

const router = express.Router()
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretadminjwt'

router.post('/login', async (req, res) => {
  // Using Mongoose User model. Accepts email/password OR apiKey.
  const { email, password, apiKey } = req.body
  if (!apiKey && (!email || !password)) return res.status(400).json({ error: 'Missing credentials' })

  let user
  if (apiKey) {
    user = await User.findOne({ apiKey })
    if (!user) return res.status(401).json({ error: 'Invalid API key' })
  } else {
    user = await User.findOne({ email })
    if (!user) return res.status(401).json({ error: 'Invalid credentials' })
    const ok = await bcrypt.compare(password, user.password)
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' })
  }

  const token = jwt.sign({ sub: user._id.toString(), role: user.role, email: user.email }, JWT_SECRET, {
    expiresIn: '8h',
  })

  return res.json({ token, role: user.role })
})

export default router

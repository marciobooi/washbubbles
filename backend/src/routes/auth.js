import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import User from '../models/user.js'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()
const JWT_SECRET = process.env.JWT_SECRET // enforced at startup

// Rate limiter for login endpoint to mitigate brute-force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 6, // limit each IP to 6 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
})

router.post('/login', loginLimiter, async (req, res) => {
  // Using Mongoose User model. Accepts username/password OR apiKey.
  const { username, password, apiKey } = req.body
  if (!apiKey && (!username || !password)) return res.status(400).json({ error: 'Missing credentials' })

  let user
  if (apiKey) {
    user = await User.findOne({ apiKey })
    if (!user) return res.status(401).json({ error: 'Invalid API key' })
  } else {
    user = await User.findOne({ username })
    if (!user) return res.status(401).json({ error: 'Invalid credentials' })
    const ok = await bcrypt.compare(password, user.password)
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' })
  }

  // Ensure a secret is available at runtime (in case dotenv wasn't loaded early)
  const secret = process.env.JWT_SECRET
  if (!secret) return res.status(500).json({ error: 'Server misconfiguration (missing JWT secret)' })

  const token = jwt.sign({ sub: user._id.toString(), role: user.role, username: user.username }, secret, {
    expiresIn: '8h',
  })

  return res.json({ token, role: user.role })
})

// Register new user (admin can create other admins via /admin endpoints). This endpoint is
// intentionally permissive for development — adapt for production (captcha, email verification, etc.)
router.post('/register', async (req, res) => {
  const { username, password, role = 'USER', email } = req.body
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password' })
  const existing = await User.findOne({ username })
  if (existing) return res.status(400).json({ error: 'User already exists' })

  const hash = await bcrypt.hash(password, 10)
  const apiKey = role === 'KIOSK' ? crypto.randomBytes(24).toString('hex') : undefined
  const user = await User.create({ username, email, password: hash, role, apiKey })
  return res.json({ _id: user._id, username: user.username, role: user.role, apiKey: user.apiKey ? user.apiKey.slice(0,8)+'…' : null })
})

// Return information about the current user when provided a valid auth token or apiKey
router.get('/me', requireAuth, async (req, res) => {
  const u = req.userModel
  if (!u) return res.status(404).json({ error: 'User not found' })
  return res.json({ _id: u._id, username: u.username, role: u.role, apiKey: u.apiKey ? u.apiKey.slice(0,8)+'…' : null })
})

export default router

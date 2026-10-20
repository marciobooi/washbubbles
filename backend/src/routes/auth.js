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

/**
 * Password-reset limiter.
 *
 * `/forgot-password` was unlimited: a mail bomb against any known address, and a
 * user-enumeration oracle if responses ever differ. `/reset-password` was also
 * unlimited against a 64-hex token — brute-forcible given enough attempts.
 */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts, please try again later.' },
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

// NOTE: there is deliberately no public /register route.
//
// The old one took `role` straight from the request body, so
// `POST {"username":"x","password":"y","role":"SUPERADMIN"}` from anywhere on the
// internet granted full cross-tenant admin. It also never set the required
// `tenantId`, so the create threw — an unauthenticated remote process kill.
// User creation belongs in `routes/admin.js`, behind `requireAdmin`, where the
// role and tenant are set by the server.

// Change password for the authenticated user
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Missing fields' })
  if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' })

  const user = req.userModel
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  // Verify current password
  const ok = await bcrypt.compare(currentPassword, user.password)
  if (!ok) return res.status(401).json({ error: 'Invalid current password' })

  const hash = await bcrypt.hash(newPassword, 10)
  user.password = hash
  await user.save()

  res.json({ success: true })
})

// --- password recovery ---------------------------------------------------

// Request a password reset link by email. Always respond 200 to avoid
// revealing whether an address is registered.
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Missing email' })
  const user = await User.findOne({ email })
  if (user) {
    const token = crypto.randomBytes(32).toString('hex')
    user.resetPasswordToken = token
    user.resetPasswordExpires = Date.now() + 3600 * 1000 // 1h
    await user.save()

    // build link using front-end url env var
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3000'
    const link = `${frontend}/reset-password?token=${token}`

    try {
      const { sendMail } = await import('../services/mailer.js')
      const { renderEmailHtml, emailButton } = await import('../services/emailTemplate.js')
      const { getEmailBrand } = await import('../services/emailBrand.js')
      const bodyHtml = `
        <p>You requested a password reset.</p>
        <p>Click the button below to choose a new password. This link expires in 1 hour.</p>
        ${emailButton('Reset password', link)}
        <p style="font-size:13px; color:#3d6a63;">If you didn't request this, you can safely ignore this email.</p>
      `
      await sendMail({
        to: user.email,
        subject: 'Password reset',
        text: `You requested a password reset. Click the link to change your password: ${link}`,
        html: renderEmailHtml({ title: 'Reset your password', preheader: 'Set a new password for your account.', bodyHtml, brand: await getEmailBrand(user.tenantId) }),
      })
    } catch (err) {
      console.error('failed to send reset email', err)
    }
  }
  // still respond success even if user not found
  res.json({ success: true })
})

// Resetting the password using the token
router.post('/reset-password', passwordResetLimiter, async (req, res) => {
  const { token, newPassword } = req.body
  if (!token || !newPassword) return res.status(400).json({ error: 'Missing fields' })
  if (typeof newPassword !== 'string' || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' })

  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() },
  })
  if (!user) return res.status(400).json({ error: 'Token invalid or expired' })

  const hash = await bcrypt.hash(newPassword, 10)
  user.password = hash
  user.resetPasswordToken = null
  user.resetPasswordExpires = null
  await user.save()

  res.json({ success: true })
})

// NOTE: `/auth/me` endpoint removed — prefer using token payloads returned by `/auth/login` for client-side role checks.
// If you still need server-side user info, reintroduce an authenticated route that returns specific safe fields.

export default router

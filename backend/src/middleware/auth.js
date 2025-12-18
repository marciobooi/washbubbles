import jwt from 'jsonwebtoken'
import User from '../models/user.js'
import mongoose from 'mongoose'

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretadminjwt'

async function resolveUserFromRequest(req) {
  const auth = req.headers.authorization
  let userModel = null
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.split(' ')[1]
    try {
      const decoded = jwt.verify(token, JWT_SECRET)
      // ensure user exists
      userModel = await User.findById(decoded.sub)
      return { userModel, tokenUser: decoded }
    } catch (err) {
      return { error: 'Invalid token' }
    }
  }
  // ApiKey via Authorization: ApiKey <key> (preferred for security)
  if (auth && auth.startsWith('ApiKey ')) {
    const apiKey = auth.split(' ')[1]
    userModel = await User.findOne({ apiKey })
    if (userModel) return { userModel }
    return { error: 'Invalid apiKey' }
  }

  // Deprecated header: x-api-key - do not accept for stricter security. If present, return an error instructing to use Authorization header.
  const xApiKey = req.headers['x-api-key']
  if (xApiKey) {
    return { error: 'Invalid apiKey header format. Use Authorization: ApiKey <key>' }
  }

  return { error: 'Missing Authorization' }
}

export async function requireAuth(req, res, next) {
  const resolved = await resolveUserFromRequest(req)
  if (resolved.error) return res.status(401).json({ error: resolved.error })
  req.userModel = resolved.userModel
  req.user = resolved.tokenUser || { sub: resolved.userModel._id.toString(), role: resolved.userModel.role }
  next()
}

export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    if (!req.userModel || req.userModel.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' })
    next()
  })
}

export async function requireKiosk(req, res, next) {
  await requireAuth(req, res, async () => {
    if (!req.userModel || req.userModel.role !== 'KIOSK') return res.status(403).json({ error: 'Forbidden' })
    next()
  })
}

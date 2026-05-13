import jwt from 'jsonwebtoken'
import User from '../models/user.js'
import mongoose from 'mongoose'

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretadminjwt'

async function resolveUserFromRequest(req) {
  const auth = req.headers.authorization
  let userModel = null
  
  // 1. JWT Bearer Token
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.split(' ')[1]
    try {
      const decoded = jwt.verify(token, JWT_SECRET)
      userModel = await User.findById(decoded.sub)
      if (userModel) return { userModel, tokenUser: decoded }
    } catch (err) {
      return { error: 'Invalid token' }
    }
  }
  
  // 2. ApiKey via Authorization: ApiKey <key>
  if (auth && auth.startsWith('ApiKey ')) {
    const apiKey = auth.split(' ')[1]
    userModel = await User.findOne({ apiKey })
    if (userModel) return { userModel }
    return { error: 'Invalid apiKey' }
  }

  // 3. Fallback: X-Tenant-Id header (only for specific bypass or debugging)
  // Bulletproof: Do NOT allow tenant override via headers unless authenticated
  
  return { error: 'Missing Authorization' }
}

export async function requireAuth(req, res, next) {
  const resolved = await resolveUserFromRequest(req)
  if (resolved.error) return res.status(401).json({ error: resolved.error })
  
  req.userModel = resolved.userModel
  req.user = resolved.tokenUser || { sub: resolved.userModel._id.toString(), role: resolved.userModel.role }
  
  // Security: Crucial for withTenant() to work!
  req.tenantId = resolved.userModel.tenantId
  
  next()
}

export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    const role = req.userModel && req.userModel.role
    if (role !== 'ADMIN' && role !== 'SUPERADMIN') return res.status(403).json({ error: 'Forbidden' })
    next()
  })
}

export async function requireSuperAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (!req.userModel || req.userModel.role !== 'SUPERADMIN') return res.status(403).json({ error: 'Forbidden' })
    next()
  })
}

export async function requireKiosk(req, res, next) {
  await requireAuth(req, res, () => {
    if (!req.userModel || req.userModel.role !== 'KIOSK') return res.status(403).json({ error: 'Forbidden' })
    next()
  })
}

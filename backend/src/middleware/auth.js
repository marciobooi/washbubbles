import jwt from 'jsonwebtoken'
import User from '../models/user.js'
import mongoose from 'mongoose'

// index.js exits at startup if JWT_SECRET is unset — no hardcoded fallback here on purpose
const JWT_SECRET = process.env.JWT_SECRET

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
  
  // Update lastSeen asynchronously (don't block the request)
  User.findByIdAndUpdate(resolved.userModel._id, { lastSeen: new Date() }).catch(() => {})

  next()
}

/**
 * Generic role-gate factory. Every specific `requireX` below is a thin
 * wrapper over this — added so new roles (STAFF, TECHNICIAN) don't need a
 * hand-written comparison function each, the way the original four did.
 */
export function requireRole(...allowed) {
  return async (req, res, next) => {
    await requireAuth(req, res, () => {
      const role = req.userModel && req.userModel.role
      if (!allowed.includes(role)) return res.status(403).json({ error: 'Forbidden' })
      next()
    })
  }
}

export const requireAdmin = requireRole('ADMIN', 'SUPERADMIN')
export const requireSuperAdmin = requireRole('SUPERADMIN')
export const requireKiosk = requireRole('KIOSK')

/** Kiosk terminals AND staff both drive the coin-machine/middleware endpoints,
 *  so those need a guard that accepts either — requireKiosk rejects admins and
 *  requireAdmin rejects kiosks. */
export const requireKioskOrAdmin = requireRole('KIOSK', 'ADMIN', 'SUPERADMIN')

/** Read-only dashboard access: Overview, Transactions, Day-close history,
 *  Cards, Machines — no money/config mutations. */
export const requireStaffRead = requireRole('ADMIN', 'SUPERADMIN', 'STAFF')

/** Machines + Maintenance tickets + kiosk day-close — no prices/users/
 *  settings/refunds/coupons/audit-log/WhatsApp. */
export const requireTechnician = requireRole('ADMIN', 'SUPERADMIN', 'TECHNICIAN')

/** Any authenticated dashboard role — the blanket gate for the admin router,
 *  with individual routes narrowing further via the guards above. */
export const requireAnyStaff = requireRole('ADMIN', 'SUPERADMIN', 'STAFF', 'TECHNICIAN')

import Tenant from '../models/tenant.js'
import TenantUser from '../models/tenantUser.js'

// Resolve tenant from header (X-Tenant-Id) or from authenticated user's membership
export async function resolveTenant(req, res, next) {
  try {
    const headerId = req.headers['x-tenant-id'] || req.headers['x-tenant']
    if (headerId) {
      const t = await Tenant.findById(headerId)
      if (t) {
        req.tenant = t
        req.tenantId = t._id
        req.tenantFilter = { tenantId: t._id }
        return next()
      }
      return res.status(400).json({ error: 'Invalid X-Tenant-Id' })
    }

    // If user is authenticated, try to pick a tenant via TenantUser membership
    if (req.userModel) {
      const membership = await TenantUser.findOne({ userId: req.userModel._id }).populate('tenantId')
      if (membership && membership.tenantId) {
        req.tenant = membership.tenantId
        req.tenantUser = membership
        req.tenantId = membership.tenantId._id
        req.tenantFilter = { tenantId: membership.tenantId._id }
        return next()
      }
    }

    // No tenant resolved — leave undefined; routes may require tenant and respond accordingly
    req.tenant = null
    req.tenantId = null
    req.tenantFilter = null
    return next()
  } catch (err) {
    console.error('[tenant] resolve error', err)
    return res.status(500).json({ error: 'Tenant resolution failed' })
  }
}

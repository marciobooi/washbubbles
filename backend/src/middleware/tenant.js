import Tenant from '../models/tenant.js'
import TenantUser from '../models/tenantUser.js'

/**
 * Cache of the single-tenant fallback.
 *
 * Most installations run one laundromat operator. Public kiosk endpoints
 * (`/pos/machine-status`, `/pos/prices/lookup`) are hit with no auth and no
 * header, and `withTenant` now fails closed, so without this fallback they would
 * return nothing on a normal single-tenant deploy.
 *
 * `null` = not looked up yet; `false` = looked up and there is more than one
 * tenant, so there is no safe default.
 */
let soleTenant = null

/** Invalidate the cache — call after creating or deleting a tenant. */
export function resetSoleTenantCache() {
  soleTenant = null
}

async function getSoleTenant() {
  if (soleTenant !== null) return soleTenant || null
  const tenants = await Tenant.find().limit(2).lean()
  soleTenant = tenants.length === 1 ? tenants[0] : false
  return soleTenant || null
}

// Resolve tenant from header (X-Tenant-Id) or from authenticated user's membership
export async function resolveTenant(req, res, next) {
  try {
    const headerId = req.headers['x-tenant-id'] || req.headers['x-tenant']
    if (headerId) {
      const t = await Tenant.findById(headerId).catch(() => null)
      if (t) {
        // NOTE: this runs before auth, so at this point the header is unverified.
        // `requireAuth` overwrites `req.tenantId` from the authenticated user, so
        // every guarded route ignores what is set here. Public routes get the
        // header value, which only exposes already-public data (machine list,
        // prices) for a tenant id the caller had to know.
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

    // Single-tenant deployment: fall back to the only tenant there is.
    const sole = await getSoleTenant()
    if (sole) {
      req.tenant = sole
      req.tenantId = sole._id
      req.tenantFilter = { tenantId: sole._id }
      return next()
    }

    // No tenant resolved — leave null. `withTenant` fails closed on this.
    req.tenant = null
    req.tenantId = null
    req.tenantFilter = null
    return next()
  } catch (err) {
    console.error('[tenant] resolve error', err)
    return res.status(500).json({ error: 'Tenant resolution failed' })
  }
}

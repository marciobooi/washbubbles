/** Is this shop suspended (e.g. unpaid, closed)? Cached briefly; the suspend route clears the cache. */
import Tenant from '../models/tenant.js'

const cache = new Map() // tenantId -> { suspended, at }
const TTL_MS = 30_000
export function resetTenantStatusCache() { cache.clear() }

export async function isSuspended(tenantId) {
  if (!tenantId) return false
  const key = String(tenantId)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.suspended
  const t = await Tenant.findById(key).select('status').lean().catch(() => null)
  const suspended = !!t && t.status === 'suspended'
  cache.set(key, { suspended, at: Date.now() })
  return suspended
}

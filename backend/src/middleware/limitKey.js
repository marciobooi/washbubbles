/**
 * Who is a request "from", for rate limiting? One address must not be able to lock out, or be locked out by, another shop:
 *  - a kiosk (Authorization: ApiKey ...) is counted PER KIOSK KEY, so one shop's PIN or card-lookup attempts never touch another's;
 *  - everybody else is counted per SHOP (the shop of the address they opened) AND per network address.
 * ipKeyGenerator groups an IPv6 address by its /56 so it is not a way around the limit.
 */
import crypto from 'crypto'
import { ipKeyGenerator } from 'express-rate-limit'

let epoch = 0
/** Tests only: start every limit counter afresh (old counters simply stop being asked for). */
export function _resetLimitKeys() { epoch++ }

export function limitKey(req) {
  const auth = String(req.headers?.authorization || '')
  if (auth.startsWith('ApiKey ')) return `${epoch}k:` + crypto.createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 16)
  const shop = req.tenantId ? String(req.tenantId) : 'none'
  return `${epoch}t:${shop}|${ipKeyGenerator(req.ip || '')}`
}

/** One account (shop + user name), whatever the address: stops a guess spread over many addresses. */
export function accountKey(req) {
  const shop = req.tenantId ? String(req.tenantId) : 'none'
  return `${epoch}a:${shop}|${String(req.body?.username || '').toLowerCase().slice(0, 80)}`
}

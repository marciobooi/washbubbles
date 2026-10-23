/**
 * Which shop does a site address belong to?
 *
 * Each shop lists its public addresses (`Tenant.domains`). The server decides the shop of a PUBLIC request (home page, login
 * branding, public machine list...) by the address the visitor opened: freshbubbles.pt is FreshBubbles, marcioslvinc.ro is
 * Marcio's laundry. Requests with a login do not use this: the shop is the user's own.
 */
import Tenant from '../models/tenant.js'

const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/

/** Lower-case, no scheme / path / port: "https://WWW.Marcioslvinc.ro/x" -> "www.marcioslvinc.ro". '' when it is not a plausible host name. */
export function normalizeHost(input) {
  let h = String(input || '').trim().toLowerCase()
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].split('?')[0].split('#')[0].replace(/:\d+$/, '').replace(/\.$/, '')
  return HOST_RE.test(h) ? h : ''
}

/** The two addresses a customer needs: the bare domain and its www. */
export function withWww(host) {
  const h = normalizeHost(host)
  if (!h) return []
  const bare = h.replace(/^www\./, '')
  return [bare, `www.${bare}`]
}

export const isIpOrLocal = (host) => !host || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || !host.includes('.')

const cache = new Map() // host -> { tenant, at }
const TTL_MS = 30_000
export function resetDomainCache() { cache.clear() }

export async function tenantForHost(host) {
  const h = normalizeHost(host)
  if (!h) return null
  const hit = cache.get(h)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tenant
  const tenant = (await Tenant.findOne({ domains: h }).lean()) || null
  cache.set(h, { tenant, at: Date.now() })
  return tenant
}

/**
 * On start: the first (oldest) shop gets PRIMARY_DOMAIN and its www when no shop has an address yet, so the existing site keeps
 * working the day a second shop is created. Does nothing when addresses are already set or PRIMARY_DOMAIN is not configured.
 */
export async function ensurePrimaryDomain(domain = process.env.PRIMARY_DOMAIN) {
  const wanted = withWww(domain)
  if (!wanted.length) return false
  if (await Tenant.exists({ 'domains.0': { $exists: true } })) return false
  const first = await Tenant.findOne().sort({ createdAt: 1 })
  if (!first) return false
  first.domains = wanted
  await first.save()
  resetDomainCache()
  return true
}

/** "a, b" or ["a", "b"] -> clean host names; anything that is not a plausible address is refused (never silently dropped). */
export function parseDomains(input) {
  if (input === undefined || input === null || input === '') return { list: [] }
  const raw = Array.isArray(input) ? input : String(input).split(/[\s,;]+/)
  const list = []
  for (const r of raw.map((x) => String(x).trim()).filter(Boolean)) {
    const h = normalizeHost(r)
    if (!h) return { error: `Endereço inválido: «${r}»` }
    if (!list.includes(h)) list.push(h)
  }
  return { list }
}

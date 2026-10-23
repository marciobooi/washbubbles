/**
 * Which starting page a shop has when it has saved nothing (or only part) in the admin's "Página Inicial" tab.
 *  - The original shop (it holds PRIMARY_DOMAIN, or the deployment has no domains at all) keeps the shipped FreshBubbles page.
 *  - Every other shop starts from a NEUTRAL page: same layout, none of FreshBubbles' address, phone, reviews or services.
 */
import Tenant from '../models/tenant.js'
import { DEFAULT_CONTENT, neutralContent } from '../views/landing.js'
import { normalizeHost } from './tenantDomains.js'

export async function landingBaseFor(tenantId) {
  const t = tenantId ? await Tenant.findById(tenantId).select('name domains').lean().catch(() => null) : null
  const primary = normalizeHost(process.env.PRIMARY_DOMAIN || '')
  const domains = (t && t.domains) || []
  const neutral = !!(t && primary && domains.length && !domains.includes(primary))
  return { base: neutral ? neutralContent(t.name) : DEFAULT_CONTENT, neutral, domains, name: t ? t.name : '' }
}

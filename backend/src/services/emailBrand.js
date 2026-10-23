import Setting from '../models/setting.js'
import { landingBaseFor, publicSiteFor } from './landingBase.js'
import { mergeContent } from '../views/landing.js'

/**
 * The shop's own branding for outbound email: name, logo, address, phone, e-mail and tagline. What the shop wrote in the admin
 * (`branding.*`, `legal.info`, "Página Inicial") wins; anything missing comes from the shop's own starting page, never from
 * another shop. The logo URL is made absolute on the shop's PUBLIC site (an email client cannot reach a shop PC).
 */
const cache = new Map()
const TTL_MS = 60_000

export async function getEmailBrand(tenantId) {
  const key = String(tenantId || '')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.brand
  let brand = {}
  try {
    const rows = await Setting.find({ ...(tenantId ? { tenantId } : {}), key: { $in: ['branding.logo', 'branding.companyName', 'legal.info', 'landingPage.content'] } }).lean()
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    const [shop, siteUrl] = await Promise.all([landingBaseFor(tenantId), publicSiteFor(tenantId)])
    const page = mergeContent(m['landingPage.content'], shop.base).brand
    const abs = (u) => (!u || /^data:/i.test(u) ? '' : /^https?:\/\//i.test(u) ? u : siteUrl + (String(u).startsWith('/') ? u : `/${u}`))
    const info = m['legal.info'] || {}
    const a = page.address || {}
    const pageAddress = [a.street, [a.postal, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    brand = {
      logo: abs(m['branding.logo'] || page.logo),
      name: String(m['branding.companyName'] || '').trim() || String(info.company || '').trim() || String(page.name || '').trim() || shop.name,
      address: String(info.address || '').trim() || pageAddress,
      phone: String(info.phone || '').trim() || String(page.phone || '').trim(),
      email: String(info.email || '').trim() || String(page.email || '').trim(),
      tagline: shop.neutral ? '' : String(page.tagline || ''),
    }
  } catch { /* the template's defaults are fine */ }
  cache.set(key, { at: Date.now(), brand })
  return brand
}

export function _clearEmailBrandCache() { cache.clear() }

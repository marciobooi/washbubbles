import Setting from '../models/setting.js'

/**
 * The shop's own branding for outbound email, from the admin: logo (`branding.logo`), name (`branding.companyName`) and the
 * contact facts of `legal.info` (address, phone, email). Anything missing falls back to the template's defaults. The logo URL
 * is made absolute on the PUBLIC site (an email client cannot reach a shop PC), where the uploads are served.
 */
const cache = new Map()
const TTL_MS = 60_000

export async function getEmailBrand(tenantId) {
  const key = String(tenantId || '')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.brand
  let brand = {}
  try {
    const rows = await Setting.find({ ...(tenantId ? { tenantId } : {}), key: { $in: ['branding.logo', 'branding.companyName', 'legal.info'] } }).lean()
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    const site = String(process.env.PUBLIC_SITE_URL || 'https://freshbubbles.pt').replace(/\/+$/, '')
    const abs = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : site + (String(u).startsWith('/') ? u : `/${u}`))
    const info = m['legal.info'] || {}
    brand = {
      logo: abs(m['branding.logo']),
      name: String(m['branding.companyName'] || '').trim() || String(info.company || '').trim(),
      address: String(info.address || '').trim(),
      phone: String(info.phone || '').trim(),
      email: String(info.email || '').trim(),
    }
  } catch { /* the defaults are fine */ }
  cache.set(key, { at: Date.now(), brand })
  return brand
}

export function _clearEmailBrandCache() { cache.clear() }

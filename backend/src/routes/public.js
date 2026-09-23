/**
 * Public marketing routes — the server-rendered front page, robots.txt and
 * sitemap.xml. See src/views/landing.js for why this isn't part of the React
 * SPA.
 *
 * Mounted only when PUBLIC_LANDING_PAGE=true (index.js) — unset everywhere
 * else (local dev, the shop-kiosk install) so "/" keeps meaning what it
 * already means there (the kiosk POS app, or nothing at all).
 */
import express from 'express'
import { renderLandingPage, renderRobotsTxt, renderSitemapXml, CONTENT_SETTING_KEY } from '../views/landing.js'
import Setting from '../models/setting.js'
import { withTenant } from '../services/tenant.js'

const router = express.Router()

// The page's editable copy (see landing.js's DEFAULT_CONTENT) lives in Mongo,
// but this route must keep rendering real content even if Mongo is briefly
// unreachable — it's the SEO/link-preview entry point, not just an admin
// convenience. So: a short in-memory cache to avoid a DB round-trip on every
// hit, a hard timeout so a stuck connection can't hang the response, and on
// any failure we fall back to the last good value (or, before the first ever
// successful read, undefined — renderLandingPage() already treats that as
// "use the defaults").
//
// The cache is intentionally not keyed by tenant: this deployment is
// single-tenant by design (BRAND in landing.js is already hardcoded to one
// business), so there's only ever one real value to cache.
const CACHE_TTL_MS = 60_000
const DB_TIMEOUT_MS = 1500
let cachedContent
let cachedAt = 0

// The logo is uploaded once, from the existing Branding tab (AdminSettings.jsx),
// not re-uploaded here — the landing page just reads that same Setting and
// overlays it onto content.brand.logo, so there's one logo to manage, not two.
const BRAND_LOGO_SETTING_KEY = 'branding.logo'

// Test-only escape hatch: force the next request to re-read from the DB
// instead of serving whatever a previous test's request cached. Real traffic
// never calls this — it only relies on the TTL above.
export function _resetContentCacheForTests() {
  cachedContent = undefined
  cachedAt = 0
}

async function loadContent(req) {
  if (cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) return cachedContent
  try {
    const SettingT = withTenant(Setting, req)
    const timeout = () => new Promise((_, reject) => setTimeout(() => reject(new Error('landing content DB read timed out')), DB_TIMEOUT_MS))
    const [contentDoc, logoDoc] = await Promise.all([
      Promise.race([SettingT.findOne({ key: CONTENT_SETTING_KEY }).lean(), timeout()]),
      Promise.race([SettingT.findOne({ key: BRAND_LOGO_SETTING_KEY }).lean(), timeout()]),
    ])
    const raw = (contentDoc && contentDoc.value) || {}
    const logoUrl = logoDoc && logoDoc.value ? String(logoDoc.value) : null
    cachedContent = logoUrl ? { ...raw, brand: { ...(raw.brand || {}), logo: logoUrl } } : raw
    cachedAt = Date.now()
  } catch (err) {
    console.warn('[public] Failed to load landing page content, serving cached/default content:', err.message)
    // Leave cachedContent as-is (last known good, or undefined if none yet) —
    // don't update cachedAt, so the next request tries the DB again instead
    // of being stuck on a failure for the full TTL.
  }
  return cachedContent
}

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300') // 5 min — plain content, changes rarely
  const content = await loadContent(req)
  res.type('html').send(renderLandingPage(content))
})

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(renderRobotsTxt())
})

router.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(renderSitemapXml())
})

export default router

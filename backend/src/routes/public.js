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
import { renderLandingPage, renderRobotsTxt, renderSitemapXml, mergeContent, CONTENT_SETTING_KEY } from '../views/landing.js'
import Setting from '../models/setting.js'
import Price from '../models/price.js'
import Machine from '../models/machine.js'
import { withTenant } from '../services/tenant.js'
import { TRANSLATIONS_KEY } from '../services/landingTranslate.js'
import { landingVersion } from '../services/landingCache.js'
import { TRANSLATED_LANGS } from '../views/landingI18n.js'

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
// Stored translations of the admin's text (services/landingTranslate.js), cached the same way.
let cachedTranslations = {}
// The price table's rows: read from the database (prices + how many machines of each kind), cached like the rest.
let cachedPrices = []
let cachedVersion = 0 // see services/landingCache.js: changes when content/translations were just saved

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
  cachedTranslations = {}
  cachedPrices = []
  cachedVersion = 0
}

async function loadContent(req) {
  if (cachedAt && Date.now() - cachedAt < CACHE_TTL_MS && cachedVersion === landingVersion()) return cachedContent
  try {
    const SettingT = withTenant(Setting, req)
    const timeout = () => new Promise((_, reject) => setTimeout(() => reject(new Error('landing content DB read timed out')), DB_TIMEOUT_MS))
    const [contentDoc, logoDoc, translationsDoc] = await Promise.all([
      Promise.race([SettingT.findOne({ key: CONTENT_SETTING_KEY }).lean(), timeout()]),
      Promise.race([SettingT.findOne({ key: BRAND_LOGO_SETTING_KEY }).lean(), timeout()]),
      Promise.race([SettingT.findOne({ key: TRANSLATIONS_KEY }).lean(), timeout()]),
    ])
    // Prices: one row per (type, size) that has at least one machine — a price nobody can use is not shown.
    const MachineT = withTenant(Machine, req)
    const [priceDocs, groups] = await Promise.all([
      Promise.race([withTenant(Price, req).find().lean(), timeout()]),
      Promise.race([MachineT.aggregate([{ $group: { _id: { t: '$type', w: '$weight' }, n: { $sum: 1 }, tImp: { $max: '$tImp' } } }]), timeout()]),
    ])
    const byKind = new Map((groups || []).map((g) => [`${g._id.t}|${g._id.w}`, g]))
    cachedPrices = (priceDocs || [])
      .map((p) => {
        const g = byKind.get(`${p.type}|${p.weight}`)
        return { type: p.type, weight: p.weight, duration: p.duration ?? null, tImp: g ? (g.tImp ?? null) : null, cash: p.cashPrice, card: p.cardPrice, machines: g ? g.n : 0 }
      })
      .filter((p) => p.machines > 0)
    cachedTranslations = (translationsDoc && translationsDoc.value && typeof translationsDoc.value === 'object') ? translationsDoc.value : {}
    const raw = (contentDoc && contentDoc.value) || {}
    const logoUrl = logoDoc && logoDoc.value ? String(logoDoc.value) : null
    cachedContent = logoUrl ? { ...raw, brand: { ...(raw.brand || {}), logo: logoUrl } } : raw
    cachedAt = Date.now()
    cachedVersion = landingVersion()
  } catch (err) {
    console.warn('[public] Failed to load landing page content, serving cached/default content:', err.message)
    // Leave cachedContent as-is (last known good, or undefined if none yet) —
    // don't update cachedAt, so the next request tries the DB again instead
    // of being stuck on a failure for the full TTL.
  }
  return cachedContent
}

/** Languages that currently have a stored translation (Portuguese is always there). */
const availableLangs = () => ['pt', ...TRANSLATED_LANGS.filter((l) => cachedTranslations[l] && cachedTranslations[l].content)]

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300') // 5 min — plain content, changes rarely
  const content = await loadContent(req)
  res.type('html').send(renderLandingPage(content, { lang: 'pt', available: availableLangs(), prices: cachedPrices }))
})

// The same page in another language: /en /fr /de /es. Text written by the admin comes from the stored
// translation; the business facts (name, address, phone, hours, logo) are always the current ones.
// No translation yet (or the service never ran) -> back to the Portuguese page rather than an empty one.
router.get('/:lang(en|fr|de|es)', async (req, res) => {
  const lang = req.params.lang
  const content = await loadContent(req)
  const stored = cachedTranslations[lang]
  if (!stored || !stored.content) return res.redirect(302, '/')
  res.set('Cache-Control', 'public, max-age=300')
  res.set('Content-Language', lang)
  const merged = { ...stored.content, brand: mergeContent(content).brand }
  res.type('html').send(renderLandingPage(merged, { lang, available: availableLangs(), prices: cachedPrices }))
})

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(renderRobotsTxt())
})

router.get('/sitemap.xml', async (req, res) => {
  await loadContent(req)
  res.type('application/xml').send(renderSitemapXml(availableLangs()))
})

export default router

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
import { renderLandingPage, renderRobotsTxt, renderSitemapXml, mergeContent, CONTENT_SETTING_KEY, DEFAULT_CONTENT, DEFAULT_SITE_URL } from '../views/landing.js'
import { landingBaseFor } from '../services/landingBase.js'
import { normalizeHost } from '../services/tenantDomains.js'
import Setting from '../models/setting.js'
import Price from '../models/price.js'
import Machine from '../models/machine.js'
import { withTenant } from '../services/tenant.js'
import { TRANSLATIONS_KEY } from '../services/landingTranslate.js'
import { landingVersion } from '../services/landingCache.js'
import { TRANSLATED_LANGS } from '../views/landingI18n.js'
import { renderLegalPage, renderNotFoundPage } from '../views/legalPage.js'
import { mergeLegal } from '../services/legalDefaults.js'

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
// The cache is kept PER SHOP (several shops share this server, each with its own site address).
const CACHE_TTL_MS = 60_000
const DB_TIMEOUT_MS = 1500
const caches = new Map() // tenantId -> { content, at, version, translations, prices, legal, lastmod, legalLastmod, base, domains }
const emptyCache = () => ({ content: undefined, at: 0, version: 0, translations: {}, prices: [], legal: mergeLegal(null, null), lastmod: null, legalLastmod: null, base: DEFAULT_CONTENT, domains: [] })

// The logo is uploaded once, from the existing Branding tab (AdminSettings.jsx),
// not re-uploaded here — the landing page just reads that same Setting and
// overlays it onto content.brand.logo, so there's one logo to manage, not two.
const BRAND_LOGO_SETTING_KEY = 'branding.logo'

// Test-only escape hatch: force the next request to re-read from the DB
// instead of serving whatever a previous test's request cached. Real traffic
// never calls this — it only relies on the TTL above.
export function _resetContentCacheForTests() { caches.clear() }

/** The public address of this shop's site: the host the visitor used when it is one of the shop's own addresses. */
function siteUrlFor(req, c) {
  const host = normalizeHost(req.headers.host || '')
  return host && c.domains.includes(host) ? `https://${host}` : DEFAULT_SITE_URL
}

async function loadContent(req) {
  const key = String(req.tenantId || 'none')
  let c = caches.get(key)
  if (!c) { c = emptyCache(); caches.set(key, c) }
  if (c.at && Date.now() - c.at < CACHE_TTL_MS && c.version === landingVersion()) return c
  try {
    const SettingT = withTenant(Setting, req)
    const timeout = () => new Promise((_, reject) => setTimeout(() => reject(new Error('landing content DB read timed out')), DB_TIMEOUT_MS))
    const race = (q) => Promise.race([q, timeout()])
    const [legalDoc, legalTrDoc] = await Promise.all([race(SettingT.findOne({ key: 'legal.info' }).lean()), race(SettingT.findOne({ key: 'legal.translations' }).lean())])
    const legal = mergeLegal(legalDoc && legalDoc.value, legalTrDoc && legalTrDoc.value)
    const newest = (...docs) => docs.map((d) => d && (d.updatedAt || (d._id && d._id.getTimestamp && d._id.getTimestamp()))).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null
    const legalLastmod = newest(legalDoc, legalTrDoc)
    const [contentDoc, logoDoc, translationsDoc, shop] = await Promise.all([
      race(SettingT.findOne({ key: CONTENT_SETTING_KEY }).lean()),
      race(SettingT.findOne({ key: BRAND_LOGO_SETTING_KEY }).lean()),
      race(SettingT.findOne({ key: TRANSLATIONS_KEY }).lean()),
      race(landingBaseFor(req.tenantId)),
    ])
    // Prices: one row per (type, size) that has at least one machine — a price nobody can use is not shown.
    const MachineT = withTenant(Machine, req)
    const [priceDocs, groups] = await Promise.all([
      race(withTenant(Price, req).find().lean()),
      race(MachineT.aggregate([{ $group: { _id: { t: '$type', w: '$weight' }, n: { $sum: 1 }, tImp: { $max: '$tImp' } } }])),
    ])
    const byKind = new Map((groups || []).map((g) => [`${g._id.t}|${g._id.w}`, g]))
    c.prices = (priceDocs || [])
      .map((p) => {
        const g = byKind.get(`${p.type}|${p.weight}`)
        return { type: p.type, weight: p.weight, duration: p.duration ?? null, tImp: g ? (g.tImp ?? null) : null, cash: p.cashPrice, card: p.cardPrice, machines: g ? g.n : 0 }
      })
      .filter((p) => p.machines > 0)
    c.legal = legal
    c.legalLastmod = legalLastmod
    c.base = shop.base
    c.domains = shop.domains
    c.lastmod = newest(contentDoc, translationsDoc, logoDoc)
    c.translations = (translationsDoc && translationsDoc.value && typeof translationsDoc.value === 'object') ? translationsDoc.value : {}
    const raw = (contentDoc && contentDoc.value) || {}
    const logoUrl = logoDoc && logoDoc.value ? String(logoDoc.value) : null
    c.content = logoUrl ? { ...raw, brand: { ...(raw.brand || {}), logo: logoUrl } } : raw
    c.at = Date.now()
    c.version = landingVersion()
  } catch (err) {
    console.warn('[public] Failed to load landing page content, serving cached/default content:', err.message)
    // Keep what this shop had last (or the defaults before the first ever read); don't update c.at,
    // so the next request tries the DB again instead of being stuck on a failure for the full TTL.
  }
  return c
}

/** Languages that currently have a stored translation (Portuguese is always there). */
const availableLangs = (c) => ['pt', ...TRANSLATED_LANGS.filter((l) => c.translations[l] && c.translations[l].content)]

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300') // 5 min — plain content, changes rarely
  const c = await loadContent(req)
  res.type('html').send(renderLandingPage(c.content, { lang: 'pt', available: availableLangs(c), prices: c.prices, legal: c.legal, siteUrl: siteUrlFor(req, c), base: c.base }))
})

// The same page in another language: /en /fr /de /es. Text written by the admin comes from the stored
// translation; the business facts (name, address, phone, hours, logo) are always the current ones.
// No translation yet (or the service never ran) -> back to the Portuguese page rather than an empty one.
router.get('/:lang(en|fr|de|es)', async (req, res) => {
  const lang = req.params.lang
  const c = await loadContent(req)
  const stored = c.translations[lang]
  if (!stored || !stored.content) return res.redirect(302, '/')
  res.set('Cache-Control', 'public, max-age=300')
  res.set('Content-Language', lang)
  const merged = { ...stored.content, brand: mergeContent(c.content, c.base).brand }
  res.type('html').send(renderLandingPage(merged, { lang, available: availableLangs(c), prices: c.prices, legal: c.legal, siteUrl: siteUrlFor(req, c), base: c.base }))
})

// Legal pages: /legal/privacy, /legal/terms, /legal/cookies and the same under /en /fr /de /es.
// The text is the one the kiosk shows; a language without a translation falls back to Portuguese.
async function sendLegal(req, res, lang) {
  const doc = req.params.doc
  const c = await loadContent(req)
  const brand = mergeContent(c.content, c.base).brand
  res.set('Cache-Control', 'public, max-age=300')
  res.set('Content-Language', lang)
  res.type('html').send(renderLegalPage(doc, { lang, brand, legal: c.legal, available: availableLangs(c), siteUrl: siteUrlFor(req, c) }))
}
router.get('/legal/:doc(privacy|terms|cookies)', (req, res) => sendLegal(req, res, 'pt'))
router.get('/:lang(en|fr|de|es)/legal/:doc(privacy|terms|cookies)', (req, res) => sendLegal(req, res, req.params.lang))

// Where nginx sends every address that is neither a page nor a file: a real 404 (never the app shell with a 200).
router.get('/404', async (req, res) => {
  const c = await loadContent(req)
  res.status(404).set('Cache-Control', 'no-store').type('html').send(renderNotFoundPage({ brand: mergeContent(c.content, c.base).brand }))
})

router.get('/robots.txt', async (req, res) => {
  const c = await loadContent(req)
  res.type('text/plain').send(renderRobotsTxt(siteUrlFor(req, c)))
})

router.get('/sitemap.xml', async (req, res) => {
  const c = await loadContent(req)
  res.type('application/xml').send(renderSitemapXml(availableLangs(c), { lastmod: c.lastmod, legalLastmod: c.legalLastmod, siteUrl: siteUrlFor(req, c) }))
})

export default router

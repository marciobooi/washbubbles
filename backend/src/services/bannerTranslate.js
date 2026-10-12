/**
 * The home-screen banner slides (setting `banners`, written in Portuguese in the admin) are translated into
 * en/fr/de/es with the server's translator and the shop dictionary, and stored in `bannersTranslations`.
 * Each translation remembers the Portuguese title/text it came from, so a stale one is never shown.
 */
import Setting from '../models/setting.js'
import { translateBatch, translatorEnabled } from './translator.js'
import { loadGlossary, translateWithGlossary } from './landingGlossary.js'
import { LEGAL_GLOSSARY } from './legalGlossary.js'

export const BANNERS_KEY = 'banners'
export const TRANSLATIONS_KEY = 'bannersTranslations'
export const BANNER_LANGS = ['en', 'fr', 'de', 'es']

const inFlight = new Map()

export function translateBanners(tenantId, { translate = translateBatch } = {}) {
  const key = String(tenantId)
  const running = inFlight.get(key)
  if (running) { running.again = true; return running.promise }
  const state = { again: false }
  state.promise = (async () => {
    try { do { state.again = false; await runOnce(tenantId, translate) } while (state.again) } finally { inFlight.delete(key) }
  })()
  inFlight.set(key, state)
  return state.promise
}

async function runOnce(tenantId, translate) {
  const doc = await Setting.findOne({ tenantId, key: BANNERS_KEY }).lean()
  const slides = Array.isArray(doc && doc.value) ? doc.value : []
  if (!slides.length) return
  const { entries: shop } = await loadGlossary(Setting, tenantId)
  const glossary = [...LEGAL_GLOSSARY, ...shop]
  const out = {}
  for (const s of slides) {
    const id = String(s.id || '')
    if (!id) continue
    const pt = { title: String(s.title || ''), text: String(s.text || '') }
    out[id] = { pt }
    for (const lang of BANNER_LANGS) {
      try {
        const { out: done } = await translateWithGlossary([pt.title, pt.text], lang, glossary, (list) => translate(list, { source: 'pt', target: lang }))
        // keep the capital letter of the Portuguese (dictionary entries are written in lower case)
        const cap = (src, s) => (src && src[0] !== src[0].toLowerCase() && s ? s[0].toUpperCase() + s.slice(1) : s)
        out[id][lang] = { title: cap(pt.title, done[0]), text: cap(pt.text, done[1]) }
      } catch (err) {
        console.warn(`[banner-translate] ${id} ${lang} failed: ${err.message}`)
      }
    }
  }
  await Setting.updateOne({ tenantId, key: TRANSLATIONS_KEY }, { $set: { value: { slides: out, at: new Date() } } }, { upsert: true })
}

export function translateBannersSoon(tenantId) {
  if (!translatorEnabled()) return false
  translateBanners(tenantId).catch((err) => console.warn('[banner-translate]', err.message))
  return true
}

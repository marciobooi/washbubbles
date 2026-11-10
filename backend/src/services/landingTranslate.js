/**
 * Translations of the public page's admin-written text (hero, steps, services, reviews, custom
 * sections ...) into every language it is served in.
 *
 * Translated when the admin SAVES, never when a visitor loads the page: the result is stored
 * (Setting `landingPage.translations`) and served as ordinary content at /en, /fr, /de, /es. So the
 * page stays fast, Google can index every language, and a stopped translation service only means
 * "no new translation yet" — the Portuguese page and the last stored translations keep working.
 *
 * Not translated: the `brand` block (name, address, phone, e-mail, hours, links), people's names,
 * links and ids. The fixed labels are a hand-written dictionary (views/landingI18n.js).
 */
import crypto from 'crypto'
import Setting from '../models/setting.js'
import { mergeContent, CONTENT_SETTING_KEY } from '../views/landing.js'
import { landingBaseFor } from './landingBase.js'
import { TRANSLATED_LANGS } from '../views/landingI18n.js'
import { translateBatch, translatorEnabled } from './translator.js'
import { bumpLandingVersion } from './landingCache.js'
import { loadGlossary, translateWithGlossary } from './landingGlossary.js'

export const TRANSLATIONS_KEY = 'landingPage.translations'
export const STATUS_KEY = 'landingPage.translationStatus'

/** Keys whose value is never translated: names, links, contact data, ids and switches. */
const SKIP_KEYS = new Set(['id', 'url', 'href', 'src', 'logo', 'image', 'icon', 'author', 'email', 'phone', 'name', 'ctaHref', 'visible', 'showLoginLink', 'type'])
/** Top-level blocks that are translated. `brand` is deliberately not one of them. */
const TRANSLATED_BLOCKS = ['hero', 'steps', 'features', 'prices', 'cta', 'visit', 'reviews', 'customSections']

/** Every translatable string in the content, with the path to put its translation back. */
export function collectStrings(content) {
  const paths = []
  const strings = []
  const walk = (node, path) => {
    if (typeof node === 'string') {
      if (node.trim()) { paths.push(path); strings.push(node) }
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, [...path, i]))
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) if (!SKIP_KEYS.has(k)) walk(v, [...path, k])
    }
  }
  for (const block of TRANSLATED_BLOCKS) if (content[block] !== undefined) walk(content[block], [block])
  return { paths, strings }
}

/** A copy of `content` with the translated strings put back at their paths. */
export function applyTranslations(content, paths, translated) {
  const out = JSON.parse(JSON.stringify(content))
  paths.forEach((path, n) => {
    let node = out
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]]
    node[path[path.length - 1]] = translated[n]
  })
  return out
}

/**
 * Free machine translation sometimes changes a number ("dos 8 aos 20kg" came back as "10 to 20 kilos").
 * A wrong size or price is worse than Portuguese text, so a sentence whose numbers differ from the
 * original is not used: the Portuguese stays for that one sentence.
 */
export const numbersIn = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.')).sort().join('|')
export function guardNumbers(sources, translated) {
  let kept = 0
  const out = translated.map((t, i) => {
    if (numbersIn(sources[i]) === numbersIn(t)) return t
    kept += 1
    return sources[i]
  })
  return { out, kept }
}

const hashOf = (strings) => crypto.createHash('sha1').update(JSON.stringify(strings)).digest('hex')

async function loadSource(tenantId) {
  const doc = await Setting.findOne({ tenantId, key: CONTENT_SETTING_KEY }).lean()
  return mergeContent(doc && doc.value, (await landingBaseFor(tenantId)).base)
}

export async function getTranslations(tenantId) {
  const doc = await Setting.findOne({ tenantId, key: TRANSLATIONS_KEY }).lean()
  return (doc && doc.value && typeof doc.value === 'object') ? doc.value : {}
}

export async function getStatus(tenantId) {
  const doc = await Setting.findOne({ tenantId, key: STATUS_KEY }).lean()
  const v = (doc && doc.value) || { state: 'never' }
  // "running" with nobody running it: the server restarted in the middle (see legalTranslate.settleStale)
  if (v.state === 'running' && !inFlight.has(String(tenantId)) && Date.now() - new Date(v.startedAt).getTime() >= 30_000) {
    return { state: 'error', interrupted: true, startedAt: v.startedAt, error: 'A tradução foi interrompida (o servidor reiniciou). Carregue outra vez em Guardar e traduzir.' }
  }
  return v
}

/** After a restart: translations that were running when the server stopped are started again. */
export async function resumeInterrupted() {
  const rows = await Setting.find({ key: STATUS_KEY, 'value.state': 'running' }).select('tenantId').lean()
  for (const r of rows) { console.warn('[landing-translate] a translation was interrupted by the restart: starting it again'); translateLandingSoon(r.tenantId) }
  return rows.length
}

const setStatus = (tenantId, value) =>
  Setting.updateOne({ tenantId, key: STATUS_KEY }, { $set: { value } }, { upsert: true })

const inFlight = new Map() // tenantId -> { promise, again }

/**
 * Translate the saved Portuguese content into every language and store it.
 * Safe to call often: one run at a time per tenant; a call that arrives meanwhile makes the run
 * start once more at the end, so the newest text is always what ends up translated.
 */
export function translateLanding(tenantId, { langs = TRANSLATED_LANGS, translate = translateBatch } = {}) {
  const key = String(tenantId)
  const running = inFlight.get(key)
  if (running) { running.again = true; return running.promise }

  const state = { again: false }
  state.promise = (async () => {
    try {
      do {
        state.again = false
        await runOnce(tenantId, langs, translate)
      } while (state.again)
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, state)
  return state.promise
}

async function runOnce(tenantId, langs, translate) {
  const startedAt = new Date()
  await setStatus(tenantId, { state: 'running', startedAt })
  const source = await loadSource(tenantId)
  const { paths, strings } = collectStrings(source)
  const sourceHash = hashOf(strings)
  const failed = {}
  const done = []
  const keptPt = {}
  const { entries: glossary } = await loadGlossary(Setting, tenantId) // the small dictionary (built-in or the admin's own)

  for (const lang of langs) {
    try {
      const { out: raw, stats } = await translateWithGlossary(strings, lang, glossary, (list) => translate(list, { source: 'pt', target: lang }))
      const { out: translated, kept } = guardNumbers(strings, raw)
      const content = applyTranslations(source, paths, translated)
      await Setting.updateOne(
        { tenantId, key: TRANSLATIONS_KEY },
        { $set: { [`value.${lang}`]: { content, at: new Date(), sourceHash, keptPortuguese: kept, glossary: stats } } },
        { upsert: true },
      )
      bumpLandingVersion() // the page can show it right away
      if (kept) keptPt[lang] = kept
      done.push(lang)
    } catch (err) {
      failed[lang] = err.message
      console.warn(`[landing-translate] ${lang} failed: ${err.message}`)
    }
  }
  const state = Object.keys(failed).length === 0 ? 'done' : (done.length ? 'partial' : 'error')
  await setStatus(tenantId, { state, startedAt, finishedAt: new Date(), done, failed, keptPortuguese: keptPt, sourceHash })
}

/** Fire and forget — what the admin "save" does. Never throws into the request. */
export function translateLandingSoon(tenantId) {
  if (!translatorEnabled()) return false
  translateLanding(tenantId).catch((err) => console.warn('[landing-translate]', err.message))
  return true
}

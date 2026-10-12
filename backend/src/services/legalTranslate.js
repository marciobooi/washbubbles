/**
 * The legal texts (privacy policy, terms and rules) are written by the admin in Portuguese only
 * (setting `legal.info`). This translates them into English, French and German with the server's own
 * translator and stores the result (`legal.translations`), so the kiosk simply reads the text for the
 * customer's language. A translation remembers the Portuguese text it came from, so a stale one is
 * never shown after the Portuguese was edited. Same pattern as services/landingTranslate.js.
 */
import Setting from '../models/setting.js'
import { translateBatch, translatorEnabled } from './translator.js'
import { loadGlossary, translateWithGlossary } from './landingGlossary.js'
import { LEGAL_GLOSSARY } from './legalGlossary.js'

export const INFO_KEY = 'legal.info'
export const TRANSLATIONS_KEY = 'legal.translations'
export const STATUS_KEY = 'legal.translationStatus'
export const LEGAL_LANGS = ['en', 'fr', 'de', 'es']
const DOCS = ['privacy', 'terms']

const setStatus = (tenantId, value) =>
  Setting.updateOne({ tenantId, key: STATUS_KEY }, { $set: { value } }, { upsert: true })

/** "## Title" / "- item" keep their marker; only the words are translated. */
export async function translateText(text, target, translate = translateBatch, glossary = []) {
  const lines = String(text).split('\n')
  const parts = lines.map((l) => {
    const m = /^(##\s+|-\s+)?(.*)$/.exec(l)
    return { marker: m[1] || '', body: m[2] }
  })
  const bodies = parts.map((p) => p.body)
  // the shop's own dictionary (the same one the landing page uses) wins over the machine translation
  const { out: done } = await translateWithGlossary(bodies, target, glossary, (list) => translate(list, { source: 'pt', target }))
  return parts.map((p, i) => (p.body.trim() ? p.marker + done[i] : p.marker + p.body)).join('\n')
}

const inFlight = new Map()

export function translateLegal(tenantId, { translate = translateBatch } = {}) {
  const key = String(tenantId)
  const running = inFlight.get(key)
  if (running) { running.again = true; return running.promise }
  const state = { again: false }
  state.promise = (async () => {
    try {
      do { state.again = false; await runOnce(tenantId, translate) } while (state.again)
    } finally { inFlight.delete(key) }
  })()
  inFlight.set(key, state)
  return state.promise
}

async function runOnce(tenantId, translate) {
  const startedAt = new Date()
  await setStatus(tenantId, { state: 'running', startedAt })
  const infoDoc = await Setting.findOne({ tenantId, key: INFO_KEY }).lean()
  const info = (infoDoc && infoDoc.value) || {}
  // the legal dictionary first, then the shop's own dictionary (the admin's entries win)
  const { entries: shopGlossary } = await loadGlossary(Setting, tenantId)
  const glossary = [...LEGAL_GLOSSARY, ...shopGlossary]
  const result = {}
  const failed = {}
  for (const docName of DOCS) {
    const pt = info[docName] && typeof info[docName].pt === 'string' ? info[docName].pt : ''
    if (!pt.trim()) continue
    result[docName] = { pt } // the Portuguese this translation belongs to
    // one press of the button translates every language; one at a time so the translator is not flooded,
    // and a language that fails is tried once more before giving up
    for (const lang of LEGAL_LANGS) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          result[docName][lang] = await translateText(pt, lang, translate, glossary)
          break
        } catch (err) {
          if (attempt === 2) {
            failed[`${docName}.${lang}`] = err.message
            console.warn(`[legal-translate] ${docName} ${lang} failed: ${err.message}`)
          }
        }
      }
    }
  }
  const okCount = Object.values(result).reduce((n, d) => n + LEGAL_LANGS.filter((l) => d[l]).length, 0)
  if (okCount > 0) {
    // keep an earlier translation of a language that failed this time (only if it belongs to the same Portuguese)
    const oldDoc = await Setting.findOne({ tenantId, key: TRANSLATIONS_KEY }).lean()
    const old = (oldDoc && oldDoc.value) || {}
    for (const docName of Object.keys(result)) {
      for (const lang of LEGAL_LANGS) {
        if (!result[docName][lang] && old[docName] && old[docName].pt === result[docName].pt && old[docName][lang]) {
          result[docName][lang] = old[docName][lang]
        }
      }
    }
    await Setting.updateOne({ tenantId, key: TRANSLATIONS_KEY }, { $set: { value: { ...result, at: new Date() } } }, { upsert: true })
  }
  const state = Object.keys(failed).length === 0 ? 'done' : (okCount ? 'partial' : 'error')
  await setStatus(tenantId, { state, startedAt, finishedAt: new Date(), failed })
}

/** Fire and forget — what saving the legal texts does. Never throws into the request. */
export function translateLegalSoon(tenantId) {
  if (!translatorEnabled()) return false
  translateLegal(tenantId).catch((err) => console.warn('[legal-translate]', err.message))
  return true
}

export async function getLegalStatus(tenantId) {
  const doc = await Setting.findOne({ tenantId, key: STATUS_KEY }).lean()
  const tr = await Setting.findOne({ tenantId, key: TRANSLATIONS_KEY }).lean()
  return { status: (doc && doc.value) || { state: 'never' }, translations: (tr && tr.value) || {}, translatorEnabled: translatorEnabled() }
}

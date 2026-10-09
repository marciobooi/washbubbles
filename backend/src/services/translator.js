/**
 * Machine translation through LibreTranslate — free and open source, run by us (the `libretranslate`
 * container in docker-compose.yml), so no account, no key and no per-character cost.
 *
 * Disabled (translatorEnabled() === false) unless TRANSLATE_URL is set, e.g. http://libretranslate:5000.
 * Used only to translate text the admin writes (see services/landingTranslate.js); the fixed labels of
 * the public page are a hand-written dictionary (views/landingI18n.js), not machine translated.
 */

export function translatorEnabled() {
  return Boolean(process.env.TRANSLATE_URL)
}

/**
 * Translate `strings` (array) and return the translations in the same order.
 * Empty strings are returned as they are. Throws if the service cannot be reached or answers badly:
 * the caller must treat a translation as optional, never as something the page depends on.
 */
export async function translateBatch(strings, {
  source = 'pt',
  target,
  url = process.env.TRANSLATE_URL,
  apiKey = process.env.TRANSLATE_API_KEY,
  fetchImpl = globalThis.fetch,
  chunkSize = 40,
  timeoutMs = 120_000,
} = {}) {
  if (!url) throw new Error('Translation is not configured (TRANSLATE_URL)')
  if (!target) throw new Error('Missing target language')
  const base = String(url).replace(/\/+$/, '')
  const out = strings.map((s) => (typeof s === 'string' ? s : ''))

  const todo = []
  strings.forEach((s, i) => { if (typeof s === 'string' && s.trim()) todo.push(i) })

  for (let at = 0; at < todo.length; at += chunkSize) {
    const idx = todo.slice(at, at + chunkSize)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res
    try {
      res = await fetchImpl(`${base}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: idx.map((i) => strings[i]), source, target, format: 'text', ...(apiKey ? { api_key: apiKey } : {}) }),
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      let detail = ''
      try { detail = ` — ${(await res.text()).slice(0, 200)}` } catch { /* ignore */ }
      throw new Error(`Translation service answered HTTP ${res.status}${detail}`)
    }
    const body = await res.json()
    const list = body?.translatedText
    if (!Array.isArray(list) || list.length !== idx.length) throw new Error('Translation service returned an unexpected answer')
    idx.forEach((i, k) => { out[i] = typeof list[k] === 'string' ? list[k] : strings[i] })
  }
  return out
}

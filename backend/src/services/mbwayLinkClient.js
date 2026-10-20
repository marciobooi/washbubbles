/**
 * The shop side of "MB WAY by QR": asks the central server for a link to show as a QR code, and polls it for the number the customer
 * typed on their own phone. Same SYNC_SERVER_URL / SYNC_API_KEY as the rest of the shop <-> central traffic.
 */
let fetchImpl = (...a) => globalThis.fetch(...a)
export function _setFetch(f) { fetchImpl = f || ((...a) => globalThis.fetch(...a)) }

async function call(path, init = {}) {
  const base = String(process.env.SYNC_SERVER_URL || '').replace(/\/+$/, '')
  const key = process.env.SYNC_API_KEY
  if (!base || !key) throw Object.assign(new Error('The central server is not configured'), { status: 503, code: 'no-central' })
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res = await fetchImpl(`${base}/mbway-link${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${key}` }, signal: ctrl.signal })
    const body = await res.json().catch(() => ({}))
    if (!res.ok && res.status !== 404) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: 502, code: 'central-error' })
    return { status: res.status, body }
  } catch (e) {
    if (e.code) throw e
    throw Object.assign(new Error('The central server did not answer'), { status: 502, code: 'central-unreachable' })
  } finally { clearTimeout(t) }
}

export async function createLink({ amount, machines }) {
  const { body } = await call('/create', { method: 'POST', body: JSON.stringify({ amount, machines }) })
  return body // { token, url, expiresAt }
}

export async function cancelLink(token) {
  try { await call(`/${encodeURIComponent(token)}/cancel`, { method: 'POST', body: '{}' }) } catch { /* it expires by itself in 5 minutes */ }
}

export async function fetchPhone(token) {
  const { body } = await call(`/${encodeURIComponent(token)}/phone`)
  return body // { status, phone? }
}

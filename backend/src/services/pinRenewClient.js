/**
 * The shop side of "a new staff PIN made at the kiosk": the central server holds the PIN (it sends it down to every shop PC), so
 * the renewal is made THERE first (it checks the old, expired PIN itself) and only then written on this PC. Same SYNC_SERVER_URL /
 * SYNC_API_KEY as the rest of the shop <-> central traffic. If the central server cannot be reached nothing is changed.
 */
let fetchImpl = (...a) => globalThis.fetch(...a)
export function _setFetch(f) { fetchImpl = f || ((...a) => globalThis.fetch(...a)) }

/** True when this PC talks to a central server (a standalone PC keeps the PIN only here). */
export const hasCentral = () => Boolean(String(process.env.SYNC_SERVER_URL || '').trim() && process.env.SYNC_API_KEY)

/** @returns {{ok:true}|{ok:false,status:number,code:string,error:string}} */
export async function relayPinRenewal({ oldPin, newPin }) {
  const base = String(process.env.SYNC_SERVER_URL || '').replace(/\/+$/, '')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res = await fetchImpl(`${base}/sync/pin-renew`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${process.env.SYNC_API_KEY}` }, body: JSON.stringify({ oldPin, newPin }), signal: ctrl.signal })
    const body = await res.json().catch(() => ({}))
    if (res.ok) return { ok: true }
    return { ok: false, status: res.status >= 500 ? 502 : res.status, code: body.code || 'central-error', error: body.error || `HTTP ${res.status}` }
  } catch {
    return { ok: false, status: 502, code: 'offline', error: 'Sem ligação ao servidor: o PIN não foi mudado. Tente de novo quando houver internet.' }
  } finally { clearTimeout(t) }
}

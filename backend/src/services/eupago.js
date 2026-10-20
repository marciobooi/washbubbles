/**
 * Eupago (eupago.pt) MB WAY, the only online payment the shop uses.
 *
 *  - create:  POST {base}/api/v1.02/mbway/create   (header `Authorization: ApiKey <key>`) -> 201 { transactionStatus, transactionID, reference }
 *             The customer then has 5 minutes to approve it in the MB WAY app. The smallest amount the sandbox accepted is 1 EUR (0.50 -> AMOUNT_INVALID).
 *  - status:  POST {base}/clientes/rest_api/multibanco/info  { chave, referencia }  -> { estado_referencia: "pendente" | ... }
 *             Works for MB WAY references too (checked on the sandbox, 2026-10-20): the shop can confirm a payment by itself, no webhook needed.
 *  - base:    sandbox  https://sandbox.eupago.pt   production  https://clientes.eupago.pt
 */
export const BASES = { sandbox: 'https://sandbox.eupago.pt', production: 'https://clientes.eupago.pt' }

export const baseFor = (env) => (env === 'production' ? BASES.production : BASES.sandbox)

/** The customer's phone as Eupago wants it: the 9 digits of a Portuguese mobile number. Returns '' when it is not one. */
export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00351')) d = d.slice(5)
  else if (d.startsWith('351') && d.length === 12) d = d.slice(3)
  return /^9\d{8}$/.test(d) ? d : ''
}

/** 912 345 678 -> "9•• ••• 678": what is kept and shown (the full number is not stored). */
export const maskPhone = (p) => (p && p.length === 9 ? `${p[0]}•• ••• ${p.slice(-3)}` : '')

const PAID = ['paga', 'transferida', 'pago', 'paid', 'success', 'sucesso']   // docs.eupago.pt/reference/transactions: paga, transferida (paid and already transferred)
const FAILED = ['expirada', 'expired', 'cancelada', 'cancelado', 'cancelled', 'canceled', 'erro', 'error', 'rejeitada', 'rejected', 'recusada', 'falhada', 'failed']
const PENDING = ['pendente', 'pending']

/** Eupago's own word for the state -> ours. Unknown words are treated as "pending" (never as paid). */
export function normalizeState(word) {
  const s = String(word ?? '').trim().toLowerCase()
  if (PAID.includes(s)) return 'paid'
  if (FAILED.includes(s)) return 'failed'
  return 'pending'
}

/** A word we have seen or expect. Anything else is reported (the "paid" spelling was never observed on the sandbox). */
export const isKnownState = (word) => { const s = String(word ?? '').trim().toLowerCase(); return PAID.includes(s) || FAILED.includes(s) || PENDING.includes(s) }

async function http(fetchImpl, url, init, timeoutMs = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal })
    let body = null
    try { body = await res.json() } catch { /* not JSON */ }
    return { status: res.status, body }
  } finally { clearTimeout(t) }
}

export async function createMbway({ env, apiKey, amount, phone, identifier, fetchImpl = globalThis.fetch }) {
  // The official WooCommerce plugin waits up to 60 s for this call. If it breaks (timeout, network) we do NOT know whether the request was
  // created: the answer says so (`uncertain`) and the caller reports it instead of pretending nothing happened.
  let status, body
  try {
    ;({ status, body } = await http(fetchImpl, `${baseFor(env)}/api/v1.02/mbway/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `ApiKey ${apiKey}` },
    body: JSON.stringify({ payment: { amount: { value: Number(Number(amount).toFixed(2)), currency: 'EUR' }, identifier, customerPhone: phone, countryCode: '+351' }, customer: { notify: false } }),
    }, 30000))
  } catch (e) {
    return { ok: false, uncertain: true, httpStatus: 0, code: 'NO_ANSWER', text: e.name === 'AbortError' ? 'timeout' : e.message }
  }
  if (status === 201 && body && body.transactionStatus === 'Success' && body.reference) {
    return { ok: true, transactionId: String(body.transactionID || ''), reference: String(body.reference) }
  }
  return { ok: false, httpStatus: status, code: body?.code || '', text: body?.text || body?.message || `HTTP ${status}` }
}

/** The state of a reference, read straight from Eupago. { state: 'paid'|'pending'|'failed', raw } or { error }. */
export async function referenceState({ env, apiKey, reference, fetchImpl = globalThis.fetch }) {
  try {
    const { status, body } = await http(fetchImpl, `${baseFor(env)}/clientes/rest_api/multibanco/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: apiKey, referencia: String(reference) }),
    })
    if (status !== 200 || !body || body.sucesso === false) return { error: `HTTP ${status}${body?.resposta ? ` ${body.resposta}` : ''}` }
    const raw = body.estado_referencia ?? body.estado
    return { state: normalizeState(typeof raw === 'string' ? raw : ''), raw }
  } catch (e) { return { error: e.name === 'AbortError' ? 'timeout' : e.message } }
}

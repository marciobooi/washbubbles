/**
 * The shop's key to the central server (SYNC_API_KEY), changed from the kiosk's staff menu.
 *
 * The new key is first CHECKED against the central server (a rejected or mistyped key is never saved), then written to the
 * backend's .env (so it survives a restart) and handed to the running sync workers at once (no restart). If the server cannot be
 * reached the key is NOT saved: a key that cannot be verified is not trusted.
 *
 * With no SYNC_SERVER_URL yet (a new shop that was never linked) `serverUrl` links it: both values are saved.
 */
import fs from 'fs'
import path from 'path'
import { normalizeKey } from './apiKeys.js'

const ENV_FILE = () => path.resolve(process.cwd(), '.env')

/** Set (or add) KEY=value in an .env text, keeping every other line as it is. */
export function setEnvLine(text, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^\\s*#?\\s*${key}\\s*=.*$`, 'm')
  if (new RegExp(`^${key}\\s*=`, 'm').test(text)) return text.replace(new RegExp(`^${key}\\s*=.*$`, 'm'), line)
  if (re.test(text)) return text.replace(re, line) // a commented-out template line becomes the real one
  return text.replace(/\s*$/, '\n') + line + '\n'
}

function writeEnv(values, file = ENV_FILE()) {
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { /* no .env yet: it is created */ }
  const crlf = text.includes('\r\n')
  text = text.replace(/\r\n/g, '\n')
  for (const [k, v] of Object.entries(values)) text = setEnvLine(text, k, v)
  if (crlf) text = text.replace(/\n/g, '\r\n')
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

/**
 * @returns {{ok:true}|{ok:false, code:'invalid-format'|'rejected'|'offline'|'no-server'|'server-error', message:string}}
 */
export async function applyCentralKey(rawKey, { serverUrl, coin, fetchImpl = globalThis.fetch, envFile } = {}) {
  const key = normalizeKey(rawKey)
  if (!/^[0-9a-f]{24,64}$/.test(key)) return { ok: false, code: 'invalid-format', message: 'A chave não tem o formato certo (24 caracteres, letras de a a f e números).' }
  const url = String(serverUrl || process.env.SYNC_SERVER_URL || '').replace(/\/+$/, '')
  if (!url) return { ok: false, code: 'no-server', message: 'Este posto ainda não tem o endereço do servidor. Indique-o também.' }

  // A PC installed for one shop is locked to it (SHOP_TENANT_ID, written by the installer): another shop's key is refused, so a
  // PC that already holds a shop's data can never start mixing in another shop's.
  if (process.env.SHOP_TENANT_ID) {
    try {
      const w = await fetchImpl(`${url}/installer/whoami`, { headers: { Authorization: `ApiKey ${key}` }, signal: AbortSignal.timeout?.(10_000) })
      if (w.ok) {
        const { tenantId } = await w.json()
        if (tenantId && tenantId !== process.env.SHOP_TENANT_ID) return { ok: false, code: 'rejected', message: 'Esta chave é de OUTRA loja. Este posto está bloqueado à sua loja; para o mudar de loja é preciso reinstalá-lo.' }
      }
    } catch { /* offline: the check below reports it */ }
  }

  let res
  try {
    res = await fetchImpl(`${url}/sync/pull/settings`, { headers: { Authorization: `ApiKey ${key}` }, signal: AbortSignal.timeout?.(10_000) })
  } catch {
    return { ok: false, code: 'offline', message: 'Sem ligação ao servidor: a chave não foi guardada. Tente de novo quando houver internet.' }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, code: 'rejected', message: 'O servidor não aceitou esta chave. Confirme-a (sem espaços) ou gere outra no admin.' }
  if (!res.ok) return { ok: false, code: 'server-error', message: `O servidor respondeu ${res.status}. Tente de novo.` }

  const values = { SYNC_API_KEY: key }
  if (!process.env.SYNC_SERVER_URL || (serverUrl && url !== process.env.SYNC_SERVER_URL)) values.SYNC_SERVER_URL = url
  // The server has accepted the key (and, if it was a staged one, made it THE key): from here the shop must use it. The running
  // process takes it first; the .env write is what makes it survive a restart, and its failure is reported, not hidden.
  let warning
  try { writeEnv(values, envFile) } catch (err) { warning = `A chave está a funcionar mas não foi possível gravá-la no ficheiro .env (${err.message}): volte a introduzi-la antes de reiniciar o PC.` }
  process.env.SYNC_API_KEY = key
  if (values.SYNC_SERVER_URL) process.env.SYNC_SERVER_URL = url
  // The running workers hold their own copy: hand them the new key now.
  for (const w of [coin?.uplink, coin?.downlink, coin?.remoteCommands]) {
    if (!w) continue
    w.apiKey = key
    if (values.SYNC_SERVER_URL) w.url = url
  }
  if (coin?.uplink) { coin.uplink.authFailed = false; coin.uplink.nextTryAt = 0; coin.uplink.flush?.().catch(() => {}) }
  return warning ? { ok: true, warning } : { ok: true }
}

// ---------------------------------------------------------------------------------------------------------------------
// A key typed at the kiosk while the shop has no internet is KEPT here (in the shop's own database) and tried again whenever
// the connection returns, so nobody has to come back and type it twice. Until then the old key stays in use.
// The setting is local to the shop: the downlink never prunes settings and the uplink never sends them.
// ---------------------------------------------------------------------------------------------------------------------
export const PENDING_KEY = 'sync.pendingKey'
export const PENDING_RESULT_KEY = 'sync.pendingKeyResult'

export async function savePendingKey(SettingModel, tenantId, rawKey) {
  const key = normalizeKey(rawKey)
  await SettingModel.updateOne({ tenantId, key: PENDING_KEY }, { $set: { value: { key, at: new Date().toISOString() } } }, { upsert: true })
  await SettingModel.deleteOne({ tenantId, key: PENDING_RESULT_KEY })
}

export async function pendingKeyStatus(SettingModel, tenantId) {
  const [p, r] = await Promise.all([
    SettingModel.findOne({ tenantId, key: PENDING_KEY }).lean(),
    SettingModel.findOne({ tenantId, key: PENDING_RESULT_KEY }).lean(),
  ])
  return { pending: Boolean(p?.value?.key), since: p?.value?.at || null, lastResult: r?.value || null }
}

/**
 * Try the saved key now. Connection still down: it stays saved. Accepted: it becomes the active key and the saved copy goes away.
 * Rejected by the server (mistyped, or already replaced): the saved copy is dropped and the reason is kept for the staff menu.
 * @returns 'none' | 'waiting' | 'applied' | 'rejected'
 */
export async function tryPendingKey(SettingModel, tenantId, opts = {}) {
  const p = await SettingModel.findOne({ tenantId, key: PENDING_KEY }).lean()
  const key = p?.value?.key
  if (!key) return 'none'
  const r = await applyCentralKey(key, opts)
  if (r.ok) {
    await SettingModel.deleteOne({ tenantId, key: PENDING_KEY })
    await SettingModel.updateOne({ tenantId, key: PENDING_RESULT_KEY }, { $set: { value: { ok: true, at: new Date().toISOString(), message: 'A chave nova foi ativada.' } } }, { upsert: true })
    return 'applied'
  }
  if (r.code === 'offline' || r.code === 'server-error') return 'waiting'
  await SettingModel.deleteOne({ tenantId, key: PENDING_KEY })
  await SettingModel.updateOne({ tenantId, key: PENDING_RESULT_KEY }, { $set: { value: { ok: false, at: new Date().toISOString(), message: r.message } } }, { upsert: true })
  return 'rejected'
}

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

/**
 * UniFi Network Controller client — issues a single-use guest hotspot
 * voucher, entirely over the shop's own LAN.
 *
 * This is the whole point of doing this locally rather than through the
 * cloud backend: the controller lives on the same network as the kiosk, so
 * it's reachable even when the kiosk's own uplink to the cloud is down —
 * which is exactly the situation a customer most wants the shop's WiFi for.
 * Mirrors backend/src/services/unifiVoucher.js — see its header for the
 * self-signed-cert / UniFi-OS-console notes, identical here.
 */
const https = require('https')

function request(cfg, path, { method = 'GET', body, cookie, csrfToken } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const headers = { 'Content-Type': 'application/json' }
    if (cookie) headers.Cookie = cookie
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload)

    const req = https.request(
      { hostname: cfg.host, port: cfg.port || 8443, path: `${cfg.basePath || ''}${path}`, method, headers, rejectUnauthorized: Boolean(cfg.verifySsl) },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          let json = null
          try { json = data ? JSON.parse(data) : null } catch { /* non-JSON response body */ }
          resolve({ status: res.statusCode, json, headers: res.headers })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function extractCookie(headers) {
  const setCookie = headers['set-cookie']
  if (!setCookie) return null
  return setCookie.map((c) => c.split(';')[0]).join('; ')
}

async function login(cfg) {
  if (!cfg.host || !cfg.username || !cfg.password) {
    throw new Error('UniFi controller is not configured (pos-client/config.json "wifi" block)')
  }
  const res = await request(cfg, '/api/login', { method: 'POST', body: { username: cfg.username, password: cfg.password } })
  if (res.status !== 200) throw new Error(`UniFi login failed (HTTP ${res.status})`)
  const cookie = extractCookie(res.headers)
  if (!cookie) throw new Error('UniFi login did not return a session cookie')
  return { cookie, csrfToken: res.headers['x-csrf-token'] }
}

async function createVoucher(cfg, durationMinutes, note) {
  const site = cfg.site || 'default'
  const { cookie, csrfToken } = await login(cfg)
  const create = await request(cfg, `/api/s/${site}/cmd/hotspot`, {
    method: 'POST', cookie, csrfToken,
    body: { cmd: 'create-voucher', n: 1, quota: 1, expire: durationMinutes, note }
  })
  const createTime = create.json?.data?.[0]?.create_time
  if (create.status !== 200 || !createTime) throw new Error(`UniFi voucher creation failed (HTTP ${create.status})`)

  const stat = await request(cfg, `/api/s/${site}/stat/voucher?create_time=${createTime}`, { cookie, csrfToken })
  const code = stat.json?.data?.[0]?.code
  if (!code) throw new Error('UniFi did not return a voucher code')
  return code
}

module.exports = { createVoucher }

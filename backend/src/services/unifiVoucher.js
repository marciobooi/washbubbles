/**
 * UniFi Network Controller client — just enough to create a single-use guest
 * hotspot voucher and read its code back.
 *
 * Self-hosted controllers almost always run on a self-signed cert on the
 * shop's LAN, so TLS verification defaults off (UNIFI_VERIFY_SSL=true to turn
 * it back on for a controller with a real cert). A UniFi OS console (UDM/UDM
 * Pro) proxies the same API under `/proxy/network` — set
 * UNIFI_BASE_PATH=/proxy/network for those; a classic software controller
 * leaves it empty.
 */
import https from 'https'

const HOST = process.env.UNIFI_HOST || ''
const PORT = process.env.UNIFI_PORT || '8443'
const SITE = process.env.UNIFI_SITE || 'default'
const USERNAME = process.env.UNIFI_USERNAME || ''
const PASSWORD = process.env.UNIFI_PASSWORD || ''
const BASE_PATH = process.env.UNIFI_BASE_PATH || ''
const VERIFY_SSL = process.env.UNIFI_VERIFY_SSL === 'true'

function request(path, { method = 'GET', body, cookie, csrfToken } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const headers = { 'Content-Type': 'application/json' }
    if (cookie) headers.Cookie = cookie
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload)

    const req = https.request(
      { hostname: HOST, port: PORT, path: `${BASE_PATH}${path}`, method, headers, rejectUnauthorized: VERIFY_SSL },
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

async function login() {
  if (!HOST || !USERNAME || !PASSWORD) {
    throw new Error('UniFi controller is not configured (UNIFI_HOST/UNIFI_USERNAME/UNIFI_PASSWORD)')
  }
  const res = await request('/api/login', { method: 'POST', body: { username: USERNAME, password: PASSWORD } })
  if (res.status !== 200) throw new Error(`UniFi login failed (HTTP ${res.status})`)
  const cookie = extractCookie(res.headers)
  if (!cookie) throw new Error('UniFi login did not return a session cookie')
  return { cookie, csrfToken: res.headers['x-csrf-token'] }
}

/**
 * Create a single-use voucher good for `durationMinutes`, and return its code.
 * One controller round trip to create it, one to read the generated code back
 * — the create call only echoes a `create_time` key, not the code itself.
 */
export async function createVoucher(durationMinutes, note) {
  const { cookie, csrfToken } = await login()
  const create = await request(`/api/s/${SITE}/cmd/hotspot`, {
    method: 'POST',
    cookie,
    csrfToken,
    body: { cmd: 'create-voucher', n: 1, quota: 1, expire: durationMinutes, note }
  })
  const createTime = create.json?.data?.[0]?.create_time
  if (create.status !== 200 || !createTime) {
    throw new Error(`UniFi voucher creation failed (HTTP ${create.status})`)
  }

  const stat = await request(`/api/s/${SITE}/stat/voucher?create_time=${createTime}`, { cookie, csrfToken })
  const code = stat.json?.data?.[0]?.code
  if (!code) throw new Error('UniFi did not return a voucher code')
  return code
}

export default { createVoucher }

/**
 * Pictures the admin uploads (logo, banners, ...) are stored on the central server. A shop PC does not have them,
 * so on the kiosk they showed as broken images. This keeps a copy on the shop PC:
 *
 *  - fetch-through: a request for /uploads/<name> that is not on disk is fetched once from the central server,
 *    saved, and served. From then on it works with no internet at all.
 *  - prefetch: after each sync, every picture mentioned in the settings is fetched, so even the first request
 *    (or the first one after losing the internet) finds it.
 *
 * Does nothing on the central server itself (no SYNC_SERVER_URL). Only plain image file names are accepted.
 */
import fs from 'fs'
import path from 'path'

const NAME_RE = /^[A-Za-z0-9._-]{1,200}\.(?:webp|png|jpe?g|gif)$/i
const MAX_BYTES = 6 * 1024 * 1024
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }

const originOf = (url) => { try { return new URL(url).origin } catch { return '' } }
export const contentTypeFor = (name) => TYPES[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream'

/** Download one picture from the central server into `uploadDir`. Resolves to the file path, or null. */
export async function fetchUpload(name, { uploadDir, baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  const origin = originOf(baseUrl)
  if (!origin || !NAME_RE.test(name)) return null
  const target = path.join(uploadDir, name)
  if (fs.existsSync(target)) return target
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${origin}/uploads/${encodeURIComponent(name)}`, { signal: ctrl.signal })
    if (!res.ok) return null
    const type = String(res.headers?.get?.('content-type') || '')
    if (!type.startsWith('image/')) return null // e.g. the site's HTML page answering a missing file
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_BYTES) return null
    const tmp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(tmp, buf)
    fs.renameSync(tmp, target) // never leave a half-written picture behind
    return target
  } catch {
    return null // offline or slow: the picture shows when the internet is back
  } finally {
    clearTimeout(timer)
  }
}

/** Express handler for GET /uploads/:name, placed after express.static: only reached when the file is not on disk. */
export function uploadsFetchThrough({ uploadDir, baseUrl = () => process.env.SYNC_SERVER_URL, fetchImpl }) {
  return async (req, res, next) => {
    const name = req.path.replace(/^\//, '')
    const file = await fetchUpload(name, { uploadDir, baseUrl: baseUrl(), fetchImpl })
    if (!file) return next()
    res.type(contentTypeFor(name)).set('Cache-Control', 'public, max-age=86400').sendFile(file)
  }
}

/** Fetch every /uploads/<picture> that the settings mention and the disk does not have yet. Returns how many were fetched. */
export async function prefetchUploads({ SettingModel, tenantId, uploadDir, baseUrl = process.env.SYNC_SERVER_URL, fetchImpl }) {
  if (!originOf(baseUrl)) return 0
  const docs = await SettingModel.find({ tenantId }).lean()
  const names = new Set()
  for (const d of docs) {
    const text = JSON.stringify(d.value ?? '')
    for (const m of text.matchAll(/\/uploads\/([A-Za-z0-9._-]+\.(?:webp|png|jpe?g|gif))/gi)) names.add(m[1])
  }
  let got = 0
  for (const name of names) {
    if (fs.existsSync(path.join(uploadDir, name))) continue
    if (await fetchUpload(name, { uploadDir, baseUrl, fetchImpl })) got += 1
  }
  return got
}

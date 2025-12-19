import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'
import FormData from 'form-data'

async function main() {
  const base = 'http://localhost:3000/api'
  // Login as seeded admin (default password from scripts/seed.cjs)
  const loginResp = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin1234' })
  })
  if (!loginResp.ok) {
    console.error('Login failed', await loginResp.text())
    process.exit(1)
  }
  const loginJson = await loginResp.json()
  const token = loginJson.token || loginJson.accessToken || (loginJson && loginJson.token)
  if (!token) {
    console.error('No token returned from login', loginJson)
    process.exit(1)
  }

  // create small test image (1x1 PNG)
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAn0B9U5VgSMAAAAASUVORK5CYII='
  const imgPath = path.join(process.cwd(), 'test-logo.png')
  fs.writeFileSync(imgPath, Buffer.from(pngBase64, 'base64'))

  const form = new FormData()
  form.append('logo', fs.createReadStream(imgPath))

  const uploadResp = await fetch(`${base}/admin/settings/logo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  })

  const body = await uploadResp.text()
  console.log('Upload status', uploadResp.status, body)
}

main().catch((e) => { console.error(e); process.exit(1) })
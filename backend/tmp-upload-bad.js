import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'
import FormData from 'form-data'

async function main() {
  const base = 'http://localhost:3000/api'
  const loginResp = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin1234' })
  })
  const loginJson = await loginResp.json()
  const token = loginJson.token || loginJson.accessToken

  const txtPath = path.join(process.cwd(), 'test-file.txt')
  fs.writeFileSync(txtPath, 'this is not an image')

  const form = new FormData()
  form.append('logo', fs.createReadStream(txtPath))

  const uploadResp = await fetch(`${base}/admin/settings/logo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  })

  const body = await uploadResp.text()
  console.log('Upload status', uploadResp.status, body)
}

main().catch((e) => { console.error(e); process.exit(1) })
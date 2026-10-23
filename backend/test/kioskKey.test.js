import { expect } from 'chai'
import fs from 'fs'
import os from 'os'
import path from 'path'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { setEnvLine, applyCentralKey } from '../src/services/centralKey.js'
import { normalizeKey, groupKey } from '../src/services/apiKeys.js'

describe('Kiosk key rotation: staged, so the shop is never cut off', function () {
  this.timeout(30000)
  let app, tenant, kiosk, admin, adminToken, User
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    ;({ tenant, kiosk, admin } = await seedTenantAndUsers())
    User = (await import('../src/models/user.js')).default
    adminToken = signToken(admin)
  })
  after(async () => { await stopTestDb() })
  const asKiosk = (key) => request(app).get('/api/sync/pull/settings').set('Authorization', `ApiKey ${key}`)
  const rotate = () => request(app).post(`/api/admin/users/${kiosk._id}/rotate`).set('Authorization', `Bearer ${adminToken}`)

  it('rotating stages a short, typable key and the OLD key keeps working', async () => {
    const r = await rotate()
    expect(r.status).to.equal(200)
    expect(r.body.staged).to.equal(true)
    expect(r.body.apiKey).to.match(/^([0-9a-f]{4}-){5}[0-9a-f]{4}$/) // 24 hex in groups of four
    expect((await asKiosk('test-kiosk-api-key')).status).to.equal(200) // old key still fine
    const listed = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${adminToken}`)
    expect(listed.body.find((u) => u.username === 'kiosk').pendingKey).to.equal(true)
    expect(JSON.stringify(listed.body)).to.not.include(normalizeKey(r.body.apiKey)) // the staged key is never listed
    // the new key, as displayed (dashes) and even in capitals, works and becomes THE key
    const typed = r.body.apiKey.toUpperCase()
    expect((await asKiosk(typed)).status).to.equal(200)
    const after = await User.findById(kiosk._id)
    expect(after.apiKey).to.equal(normalizeKey(r.body.apiKey))
    expect(after.apiKeyNext).to.equal(null)
    expect((await asKiosk('test-kiosk-api-key')).status).to.equal(401) // the old key stops working once the new one was used
  })

  it('generating another key replaces a staged one that was never used', async () => {
    const a = await rotate(); const b = await rotate()
    expect(a.body.apiKey).to.not.equal(b.body.apiKey)
    expect((await asKiosk(a.body.apiKey)).status).to.equal(401)
    expect((await asKiosk(b.body.apiKey)).status).to.equal(200)
  })

  it('groupKey / normalizeKey are inverse of each other', () => {
    expect(groupKey('a1b2c3d4e5f6a7b8c9d0e1f2')).to.equal('a1b2-c3d4-e5f6-a7b8-c9d0-e1f2')
    expect(normalizeKey(' A1B2-c3d4  e5f6 ')).to.equal('a1b2c3d4e5f6')
  })
})

describe('Shop side: changing the key to the central server', function () {
  this.timeout(30000)
  let dir, envFile
  const goodKey = 'a1b2c3d4e5f6a7b8c9d0e1f2'
  const fetchOk = async () => ({ ok: true, status: 200 })
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbkey-'))
    envFile = path.join(dir, '.env')
    fs.writeFileSync(envFile, 'PORT=3000\r\n# SYNC_SERVER_URL=https://example.invalid/api\r\nSYNC_API_KEY=oldkey\r\nOTHER=1\r\n')
    process.env.SYNC_SERVER_URL = 'https://central.test/api'
    process.env.SYNC_API_KEY = 'oldkey'
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.SYNC_SERVER_URL; delete process.env.SYNC_API_KEY })

  it('setEnvLine replaces, uncomments or appends, leaving the other lines alone', () => {
    expect(setEnvLine('A=1\nK=old\nB=2\n', 'K', 'new')).to.equal('A=1\nK=new\nB=2\n')
    expect(setEnvLine('A=1\n# K=\nB=2\n', 'K', 'new')).to.equal('A=1\nK=new\nB=2\n')
    expect(setEnvLine('A=1\n', 'K', 'new')).to.equal('A=1\nK=new\n')
  })

  it('a key the server accepts is saved to .env (line endings kept), set live, and handed to the running workers', async () => {
    const coin = { uplink: { apiKey: 'oldkey', authFailed: true, nextTryAt: 999, flush: async () => {} }, downlink: { apiKey: 'oldkey' }, remoteCommands: { apiKey: 'oldkey' } }
    const calls = []
    const r = await applyCentralKey('A1B2-C3D4-E5F6-A7B8-C9D0-E1F2', { coin, envFile, fetchImpl: async (u, o) => { calls.push({ u, auth: o.headers.Authorization }); return { ok: true, status: 200 } } })
    expect(r).to.deep.equal({ ok: true })
    expect(calls[0]).to.deep.equal({ u: 'https://central.test/api/sync/pull/settings', auth: `ApiKey ${goodKey}` })
    const text = fs.readFileSync(envFile, 'utf8')
    expect(text).to.include(`SYNC_API_KEY=${goodKey}\r\n`)
    expect(text).to.include('PORT=3000\r\n').and.include('OTHER=1')
    expect(process.env.SYNC_API_KEY).to.equal(goodKey)
    expect(coin.uplink).to.include({ apiKey: goodKey, authFailed: false, nextTryAt: 0 })
    expect(coin.downlink.apiKey).to.equal(goodKey)
    expect(coin.remoteCommands.apiKey).to.equal(goodKey)
  })

  it('a key the server rejects, a mistyped one, or no connection: nothing is saved, nothing changes', async () => {
    const before = fs.readFileSync(envFile, 'utf8')
    const coin = { uplink: { apiKey: 'oldkey' } }
    const rej = await applyCentralKey(goodKey, { coin, envFile, fetchImpl: async () => ({ ok: false, status: 401 }) })
    expect(rej).to.include({ ok: false, code: 'rejected' })
    const bad = await applyCentralKey('not a key!', { coin, envFile, fetchImpl: fetchOk })
    expect(bad).to.include({ ok: false, code: 'invalid-format' })
    const off = await applyCentralKey(goodKey, { coin, envFile, fetchImpl: async () => { throw new TypeError('fetch failed') } })
    expect(off).to.include({ ok: false, code: 'offline' })
    expect(fs.readFileSync(envFile, 'utf8')).to.equal(before)
    expect(process.env.SYNC_API_KEY).to.equal('oldkey')
    expect(coin.uplink.apiKey).to.equal('oldkey')
  })

  it('a shop never linked before: the server address is saved together with the key', async () => {
    delete process.env.SYNC_SERVER_URL
    fs.writeFileSync(envFile, 'PORT=3000\n')
    const r = await applyCentralKey(goodKey, { serverUrl: 'https://novo.test/api/', envFile, fetchImpl: fetchOk })
    expect(r.ok).to.equal(true)
    const text = fs.readFileSync(envFile, 'utf8')
    expect(text).to.include('SYNC_SERVER_URL=https://novo.test/api').and.include(`SYNC_API_KEY=${goodKey}`)
  })

  it('the key is still accepted if the .env cannot be written (it works now), with a warning', async () => {
    const r = await applyCentralKey(goodKey, { envFile: path.join(dir, 'no', 'such', 'dir', '.env'), fetchImpl: fetchOk })
    expect(r.ok).to.equal(true)
    expect(r.warning).to.be.a('string')
    expect(process.env.SYNC_API_KEY).to.equal(goodKey)
  })
})

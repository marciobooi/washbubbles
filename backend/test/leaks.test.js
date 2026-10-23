import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers } from './setup.test-helper.js'
import { redactPkg } from '../src/services/logRedact.js'
import { savePendingKey, pendingKeyStatus, tryPendingKey, PENDING_KEY } from '../src/services/centralKey.js'

describe('Nothing sensitive in what the server says or logs', function () {
  this.timeout(30000)
  let app, tenant, adminToken, Setting
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    let admin
    ;({ tenant, admin } = await seedTenantAndUsers())
    const { signToken } = await import('./setup.test-helper.js')
    adminToken = signToken(admin)
    Setting = (await import('../src/models/setting.js')).default
    await Setting.create({ tenantId: tenant._id, key: 'branding.companyName', value: 'FreshBubbles' })
    await Setting.create({ tenantId: tenant._id, key: 'adminPin', value: '9876' })
    await Setting.create({ tenantId: tenant._id, key: 'payments.mbway.apiKey', value: 'SECRET-EUPAGO' })
  })
  after(async () => { await stopTestDb() })

  it('the public setting answer carries only key and value (no database ids), and secrets are not readable at all', async () => {
    const ok = await request(app).get('/api/pos/settings/branding.companyName')
    expect(ok.status).to.equal(200)
    expect(Object.keys(ok.body).sort()).to.deep.equal(['key', 'value'])
    for (const k of ['adminPin', 'payments.mbway.apiKey', 'sync.pendingKey']) expect((await request(app).get(`/api/pos/settings/${k}`)).status, k).to.equal(404)
  })

  it('an unknown API address answers JSON (not the framework page), and the response does not announce Express', async () => {
    const r = await request(app).get('/api/does-not-exist')
    expect(r.status).to.equal(404)
    expect(r.body).to.deep.equal({ error: 'Not found' })
    expect(r.headers['x-powered-by']).to.equal(undefined)
  })

  it('the key waiting for the connection is never listed by the admin settings', async () => {
    await Setting.create({ tenantId: tenant._id, key: PENDING_KEY, value: { key: 'a'.repeat(24), at: 'x' } })
    const list = await request(app).get('/api/admin/settings').set('Authorization', `Bearer ${adminToken}`)
    expect(list.body.map((s) => s.key)).to.not.include(PENDING_KEY)
    expect(JSON.stringify(list.body)).to.not.include('aaaaaaaaaaaa')
    const one = await request(app).get(`/api/admin/settings/${PENDING_KEY}`).set('Authorization', `Bearer ${adminToken}`)
    expect(one.body.value).to.equal(null)
    // secrets are listed as set / not set, never with their value
    const pin = list.body.find((s) => s.key === 'adminPin')
    expect(pin.value).to.equal('••••••')
    expect(JSON.stringify(list.body)).to.not.include('9876').and.not.include('SECRET-EUPAGO')
    await Setting.deleteOne({ tenantId: tenant._id, key: PENDING_KEY })
  })

  it('log lines mask the card holder (name, tax id, e-mail, phone) and change nothing else', () => {
    const pkg = { cl: '180', c: { op: 'write-card', data: { cardId: '-1173654100', name: 'Ana Silva', nif: '123456789', email: 'a@b.pt', phone: '912345678', balance: '500' } } }
    const out = redactPkg(pkg)
    expect(out.c.data).to.deep.equal({ cardId: '-1173654100', name: '***', nif: '***', email: '***', phone: '***', balance: '500' })
    expect(pkg.c.data.name).to.equal('Ana Silva') // the original is untouched
    expect(redactPkg({ data: { name: ' ', nif: '' } })).to.deep.equal({ data: { name: ' ', nif: '' } }) // nothing to hide
  })

  describe('a key typed while offline is kept in the shop database and activated when the connection returns', () => {
    const goodKey = 'a1b2c3d4e5f6a7b8c9d0e1f2'
    afterEach(async () => { await Setting.deleteMany({ tenantId: tenant._id, key: { $in: ['sync.pendingKey', 'sync.pendingKeyResult'] } }) })

    it('saved while offline, still waiting while offline, applied once the server answers', async () => {
      await savePendingKey(Setting, tenant._id, 'A1B2-C3D4-E5F6-A7B8-C9D0-E1F2')
      expect(await pendingKeyStatus(Setting, tenant._id)).to.include({ pending: true })
      const offline = async () => { throw new TypeError('fetch failed') }
      expect(await tryPendingKey(Setting, tenant._id, { serverUrl: 'https://c.test/api', fetchImpl: offline, envFile: '/nonexistent/x/.env' })).to.equal('waiting')
      expect((await pendingKeyStatus(Setting, tenant._id)).pending).to.equal(true) // still there
      process.env.SYNC_API_KEY = 'old'
      const online = async () => ({ ok: true, status: 200 })
      expect(await tryPendingKey(Setting, tenant._id, { serverUrl: 'https://c.test/api', fetchImpl: online, envFile: '/nonexistent/x/.env' })).to.equal('applied')
      expect(process.env.SYNC_API_KEY).to.equal(goodKey)
      const st = await pendingKeyStatus(Setting, tenant._id)
      expect(st.pending).to.equal(false)
      expect(st.lastResult.ok).to.equal(true)
      delete process.env.SYNC_API_KEY
    })

    it('a key the server rejects is dropped (not retried for ever) and the reason is kept for the staff menu', async () => {
      await savePendingKey(Setting, tenant._id, goodKey)
      const rejected = async () => ({ ok: false, status: 401 })
      expect(await tryPendingKey(Setting, tenant._id, { serverUrl: 'https://c.test/api', fetchImpl: rejected })).to.equal('rejected')
      const st = await pendingKeyStatus(Setting, tenant._id)
      expect(st.pending).to.equal(false)
      expect(st.lastResult).to.include({ ok: false })
      expect(st.lastResult.message).to.match(/não aceitou/)
    })

    it('nothing pending: nothing happens', async () => {
      expect(await tryPendingKey(Setting, tenant._id, {})).to.equal('none')
    })
  })
})

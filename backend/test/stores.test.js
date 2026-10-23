import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { resetSoleTenantCache } from '../src/middleware/tenant.js'
import { resetDomainCache } from '../src/services/tenantDomains.js'

describe('Superadmin creates and oversees shops', function () {
  this.timeout(60000)
  let app, super_, superTok, adminTok, User, Tenant, Setting, Machine
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    ;({ admin: super_ } = await seedTenantAndUsers())
    User = (await import('../src/models/user.js')).default
    Tenant = (await import('../src/models/tenant.js')).default
    Setting = (await import('../src/models/setting.js')).default
    Machine = (await import('../src/models/machine.js')).default
    await Tenant.init()
    superTok = signToken(super_)
    const plain = await User.create({ tenantId: super_.tenantId, username: 'plainadmin', password: 'x', role: 'ADMIN' })
    adminTok = signToken(plain)
    resetSoleTenantCache(); resetDomainCache()
  })
  after(async () => { await stopTestDb() })
  const auth = (t) => ({ Authorization: `Bearer ${t}` })

  it('only a superadmin may use it', async () => {
    expect((await request(app).get('/api/admin/stores/overview').set(auth(adminTok))).status).to.equal(403)
    expect((await request(app).post('/api/admin/stores').set(auth(adminTok)).send({ name: 'X' })).status).to.equal(403)
  })

  it('creates an EMPTY shop with its administrator (no password known), the www address too, and the customer e-mail address kept', async () => {
    const r = await request(app).post('/api/admin/stores').set(auth(superTok)).send({ name: 'Lavandaria do Márcio', domains: 'www.marcioslvinc.ro', customerEmail: 'Cliente@Example.com' })
    expect(r.status).to.equal(201)
    expect(r.body.tenant.slug).to.equal('lavandaria-do-marcio')
    expect(r.body.tenant.domains).to.have.members(['marcioslvinc.ro', 'www.marcioslvinc.ro'])
    expect(r.body.tenant.domainState.state).to.equal('pending_dns')
    expect(r.body.dns.map((d) => d.name)).to.deep.equal(['@', 'www'])
    const admin = await User.findById(r.body.admin.id).lean()
    expect(admin.role).to.equal('ADMIN')
    expect(admin.email).to.equal('cliente@example.com')
    expect(admin.resetPasswordToken).to.be.a('string').with.length(64) // the set-password link
    expect(admin.resetPasswordExpires.getTime()).to.be.greaterThan(Date.now() + 6 * 24 * 3600 * 1000)
    const tid = r.body.tenant._id
    expect(await Machine.countDocuments({ tenantId: tid })).to.equal(0)
    expect(await Setting.countDocuments({ tenantId: tid })).to.equal(0) // nothing copied from another shop
  })

  it('refuses an address that already belongs to another shop, and a bad e-mail', async () => {
    const dup = await request(app).post('/api/admin/stores').set(auth(superTok)).send({ name: 'Outra', domains: 'marcioslvinc.ro' })
    expect(dup.status).to.equal(409)
    const bad = await request(app).post('/api/admin/stores').set(auth(superTok)).send({ name: 'Outra', customerEmail: 'not-an-email' })
    expect(bad.status).to.equal(400)
  })

  it('a second shop with the same name gets its own identifier and administrator name', async () => {
    const r = await request(app).post('/api/admin/stores').set(auth(superTok)).send({ name: 'Lavandaria do Márcio' })
    expect(r.status).to.equal(201)
    expect(r.body.tenant.slug).to.equal('lavandaria-do-marcio-2')
    expect(r.body.admin.username).to.equal('lavandaria-do-marcio-2')
  })

  it('the overview lists every shop with its checklist; a new shop has nothing done', async () => {
    const r = await request(app).get('/api/admin/stores/overview').set(auth(superTok))
    expect(r.status).to.equal(200)
    const s = r.body.stores.find((x) => x.slug === 'lavandaria-do-marcio')
    expect(s.machines).to.equal(0)
    expect(s.checklist.every((c) => c.done === false)).to.equal(true)
    expect(s.kioskOnline).to.equal(false)
    expect(r.body.stores.length).to.equal(3)
  })

  it('suspends and re-activates a shop', async () => {
    const t = await Tenant.findOne({ slug: 'lavandaria-do-marcio' })
    const r = await request(app).put(`/api/admin/stores/${t._id}/status`).set(auth(superTok)).send({ status: 'suspended' })
    expect(r.body.status).to.equal('suspended')
    expect((await request(app).put(`/api/admin/stores/${t._id}/status`).set(auth(superTok)).send({ status: 'nope' })).status).to.equal(400)
  })
})

describe('A suspended shop is closed', function () {
  this.timeout(60000)
  let app, Tenant, User, tokB, tokSuper
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    const { tenant, admin } = await seedTenantAndUsers()
    Tenant = (await import('../src/models/tenant.js')).default
    User = (await import('../src/models/user.js')).default
    await Tenant.init()
    tokSuper = signToken(admin)
    const b = await Tenant.create({ name: 'B', slug: 'b-susp', domains: ['b.susp.pt'] })
    const ub = await User.create({ tenantId: b._id, username: 'b-admin', password: await (await import('bcryptjs')).default.hash('pw123456', 10), role: 'ADMIN' })
    tokB = signToken(ub)
    resetSoleTenantCache(); resetDomainCache()
    const { resetTenantStatusCache } = await import('../src/services/tenantStatus.js')
    await request(app).put(`/api/admin/stores/${b._id}/status`).set('Authorization', `Bearer ${tokSuper}`).send({ status: 'suspended' })
    resetTenantStatusCache()
  })
  after(async () => { await stopTestDb() })
  it('its admin cannot sign in or use a session, the superadmin still can', async () => {
    const login = await request(app).post('/api/auth/login').send({ username: 'b-admin', password: 'pw123456' })
    expect(login.status).to.equal(403)
    expect((await request(app).get('/api/admin/users').set('Authorization', `Bearer ${tokB}`)).status).to.equal(403)
    expect((await request(app).get('/api/admin/stores/overview').set('Authorization', `Bearer ${tokSuper}`)).status).to.equal(200)
  })
})

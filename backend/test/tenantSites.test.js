import { expect } from 'chai'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { normalizeHost, withWww, tenantForHost, ensurePrimaryDomain, resetDomainCache } from '../src/services/tenantDomains.js'
import { resetSoleTenantCache } from '../src/middleware/tenant.js'
import { ensureGlobalUsernameIndex } from '../src/services/ensureIndexes.js'

describe('Site addresses decide the shop; superadmin acts as a shop; user names are unique everywhere', function () {
  this.timeout(60000)
  let app, tA, tB, admin, adminToken, plainToken, User, Tenant, Setting, Machine
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    ;({ tenant: tA, admin } = await seedTenantAndUsers())
    User = (await import('../src/models/user.js')).default
    Tenant = (await import('../src/models/tenant.js')).default
    Setting = (await import('../src/models/setting.js')).default
    Machine = (await import('../src/models/machine.js')).default
    await Tenant.init()
    adminToken = signToken(admin)
    tB = await Tenant.create({ name: "Márcio's Lavandaria", slug: 'marcios' })
    const plain = await User.create({ tenantId: tA._id, username: 'plain-admin', password: 'x', role: 'ADMIN' })
    plainToken = signToken(plain)
    await Setting.create({ tenantId: tA._id, key: 'branding.companyName', value: 'FreshBubbles' })
    await Setting.create({ tenantId: tB._id, key: 'branding.companyName', value: "Márcio's Lavandaria" })
    await Machine.create({ tenantId: tA._id, name: 'Lavar A', type: 'wash', weight: 8 })
    await Machine.create({ tenantId: tB._id, name: 'Lavar B', type: 'wash', weight: 8 })
    resetSoleTenantCache()
  })
  after(async () => { await stopTestDb() })

  it('host names are cleaned; a bare domain gets its www', () => {
    expect(normalizeHost('HTTPS://WWW.Marcioslvinc.RO/pagina?x=1')).to.equal('www.marcioslvinc.ro')
    expect(normalizeHost('marcioslvinc.ro:8080')).to.equal('marcioslvinc.ro')
    for (const bad of ['', 'localhost', '127.0.0.1', 'not a host', 'a..b', 'x;rm -rf', '-bad.ro']) expect(normalizeHost(bad), bad).to.equal('')
    expect(withWww('www.marcioslvinc.ro')).to.deep.equal(['marcioslvinc.ro', 'www.marcioslvinc.ro'])
  })

  it('the first shop gets PRIMARY_DOMAIN (and www) once, and only when no shop has an address', async () => {
    expect(await ensurePrimaryDomain('freshbubbles.pt')).to.equal(true)
    expect((await Tenant.findById(tA._id).lean()).domains).to.deep.equal(['freshbubbles.pt', 'www.freshbubbles.pt'])
    expect(await ensurePrimaryDomain('freshbubbles.pt')).to.equal(false)
    expect(await ensurePrimaryDomain('')).to.equal(false)
  })

  it('with two shops each address shows ITS shop; an unknown address shows nobody\'s', async () => {
    const put = await request(app).put(`/api/admin/tenants/${tB._id}`).set('Authorization', `Bearer ${adminToken}`).send({ domains: 'https://www.marcioslvinc.ro, marcioslvinc.ro' })
    expect(put.status).to.equal(200)
    expect(put.body.domains).to.deep.equal(['www.marcioslvinc.ro', 'marcioslvinc.ro'])
    resetDomainCache()
    const brand = (host) => request(app).get('/api/pos/settings/branding.companyName').set('Host', host)
    expect((await brand('freshbubbles.pt')).body.value).to.equal('FreshBubbles')
    expect((await brand('www.freshbubbles.pt')).body.value).to.equal('FreshBubbles')
    expect((await brand('marcioslvinc.ro')).body.value).to.equal("Márcio's Lavandaria")
    expect((await brand('www.marcioslvinc.ro')).body.value).to.equal("Márcio's Lavandaria")
    expect((await brand('someone-else.example')).body.value).to.equal(null) // nobody's address
    expect((await brand('127.0.0.1')).body.value).to.equal(null) // no default shop configured
    const machines = await request(app).get('/api/pos/machine-status').set('Host', 'marcioslvinc.ro')
    expect(machines.body.map((m) => m.name)).to.deep.equal(['Lavar B'])
  })

  it('an address belongs to ONE shop; bad addresses are refused, not dropped', async () => {
    const dup = await request(app).put(`/api/admin/tenants/${tB._id}`).set('Authorization', `Bearer ${adminToken}`).send({ domains: ['freshbubbles.pt'] })
    expect(dup.status).to.equal(409)
    const bad = await request(app).put(`/api/admin/tenants/${tB._id}`).set('Authorization', `Bearer ${adminToken}`).send({ domains: ['ok.ro', 'x;rm -rf /'] })
    expect(bad.status).to.equal(400)
    expect((await Tenant.findById(tB._id).lean()).domains).to.include('marcioslvinc.ro') // unchanged
    // only a superadmin edits shops
    expect((await request(app).put(`/api/admin/tenants/${tB._id}`).set('Authorization', `Bearer ${plainToken}`).send({ domains: ['x.ro'] })).status).to.equal(403)
  })

  it('a SUPERADMIN can act as another shop (audited); nobody else can, and a made-up shop id changes nothing', async () => {
    const own = await request(app).get('/api/admin/machines').set('Authorization', `Bearer ${adminToken}`)
    expect(own.body.map((m) => m.name)).to.deep.equal(['Lavar A'])
    const as = await request(app).get('/api/admin/machines').set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-Id', String(tB._id))
    expect(as.body.map((m) => m.name)).to.deep.equal(['Lavar B'])
    const ordinary = await request(app).get('/api/admin/machines').set('Authorization', `Bearer ${plainToken}`).set('X-Tenant-Id', String(tB._id))
    expect(ordinary.body.map((m) => m.name)).to.deep.equal(['Lavar A']) // the header is ignored for an ordinary admin
    const fake = await request(app).get('/api/admin/machines').set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-Id', '64b0000000000000000000aa')
    expect(fake.status).to.equal(400) // a shop that does not exist is refused, never guessed
    const AuditLog = (await import('../src/models/auditLog.js')).default
    await new Promise((r) => setTimeout(r, 100))
    expect(await AuditLog.countDocuments({ tenantId: tB._id, action: 'tenant.act_as' })).to.be.greaterThan(0)
  })

  it('a user created while acting as shop B belongs to shop B; the same name cannot be reused in any shop', async () => {
    const mk = (name, tenantHeader) => request(app).post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-Id', String(tenantHeader)).send({ username: name, role: 'ADMIN', password: 'password-1234' })
    const r = await mk('Dono-B', tB._id)
    expect(r.status).to.equal(200)
    expect((await User.findOne({ username: 'Dono-B' }).lean()).tenantId.toString()).to.equal(String(tB._id))
    expect((await mk('dono-b', tA._id)).status).to.equal(409) // other shop, other capitals
    const login = await request(app).post('/api/auth/login').send({ username: 'DONO-b', password: 'password-1234' })
    expect(login.status).to.equal(200)
    expect(login.body.tenant).to.include({ slug: 'marcios' })
  })

  it('the system-wide unique index is created when there are no duplicates, and reports them (never fixes them silently) when there are', async () => {
    expect((await ensureGlobalUsernameIndex(User)).status).to.equal('created')
    expect((await ensureGlobalUsernameIndex(User)).status).to.equal('exists')
    await User.collection.dropIndex('username_ci_unique')
    await User.collection.insertOne({ tenantId: tB._id, username: 'ADMIN', password: 'x', role: 'ADMIN' }) // same name as shop A's "admin", other capitals
    const r = await ensureGlobalUsernameIndex(User)
    expect(r.status).to.equal('duplicates')
    expect(r.duplicates).to.include('admin')
    await User.deleteOne({ tenantId: tB._id, username: 'ADMIN' })
  })
})

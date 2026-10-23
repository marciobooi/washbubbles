import { expect } from 'chai'
import express from 'express'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import '../src/services/asyncRoutes.js'

describe('Creating users from the admin', function () {
  this.timeout(30000)
  let app, tenant, admin, User, adminToken, plainAdminToken
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    ;({ tenant, admin } = await seedTenantAndUsers())
    User = (await import('../src/models/user.js')).default
    adminToken = signToken(admin)
    const plain = await User.create({ tenantId: tenant._id, username: 'plainadmin', password: 'x', role: 'ADMIN' })
    plainAdminToken = signToken(plain)
  })
  after(async () => { await stopTestDb() })
  const create = (tok, body) => request(app).post('/api/admin/users').set('Authorization', `Bearer ${tok}`).send(body)

  it('several users WITHOUT an email can be created (the old unique email index made the second one fail)', async () => {
    // reproduce production: the old non-partial unique index on (tenantId, email)
    await User.init() // wait for the model's own index build before touching indexes
    try { await User.collection.dropIndex('tenantId_1_email_1') } catch (e) { if (e.codeName !== 'IndexNotFound') throw e }
    await User.collection.createIndex({ tenantId: 1, email: 1 }, { name: 'tenantId_1_email_1', unique: true })
    const { ensureUserIndexes } = await import('../src/services/ensureIndexes.js')
    expect(await ensureUserIndexes(User)).to.include('tenantId_1_email_1')
    expect(await ensureUserIndexes(User)).to.deep.equal([]) // already right: nothing to do
    const a = await create(adminToken, { username: 'op1', role: 'OPERATOR', password: 'password-1234' })
    const b = await create(adminToken, { username: 'op2', role: 'OPERATOR', password: 'password-1234' })
    expect(a.status).to.equal(200)
    expect(b.status).to.equal(200)
  })

  it('a name already in use answers 409 at once instead of never answering', async () => {
    const r = await create(adminToken, { username: 'op1', role: 'OPERATOR', password: 'password-1234' })
    expect(r.status).to.equal(409)
  })

  it('a tenant admin cannot create a superadmin; a superadmin can', async () => {
    expect((await create(plainAdminToken, { username: 'boss1', role: 'SUPERADMIN', password: 'password-1234' })).status).to.equal(400)
    expect((await create(adminToken, { username: 'boss2', role: 'SUPERADMIN', password: 'password-1234' })).status).to.equal(200)
    expect((await create(adminToken, { username: 'bad1', role: 'NOT_A_ROLE', password: 'password-1234' })).status).to.equal(400)
  })

  it('any async route that fails answers 500 instead of hanging (Express 4 would never answer)', async () => {
    const a = express()
    a.get('/boom', async () => { throw new Error('database said no') })
    a.use((err, req, res, next) => res.status(500).json({ error: err.message })) // eslint-disable-line no-unused-vars
    const r = await request(a).get('/boom').timeout(3000)
    expect(r.status).to.equal(500)
    expect(r.body.error).to.equal('database said no')
  })
})

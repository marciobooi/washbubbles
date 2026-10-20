import { expect } from 'chai'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'

describe('every dashboard user changes their own password', function () {
  this.timeout(20000)
  let app, tenant, token
  before(async () => { await startTestDb(); app = await buildTestApp() })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant } = await seedTenantAndUsers())
    const User = (await import('../src/models/user.js')).default
    const op = await User.create({ username: 'tatiana-test', email: 'op@test.local', password: await bcrypt.hash('old-pass-123', 10), role: 'OPERATOR', tenantId: tenant._id })
    token = signToken(op)
  })
  const change = (body) => request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${token}`).send(body)

  it('an operator can change it, and signs in with the new one afterwards', async () => {
    const r = await change({ currentPassword: 'old-pass-123', newPassword: 'new-pass-456' })
    expect(r.status).to.equal(200)
    const User = (await import('../src/models/user.js')).default
    const u = await User.findOne({ username: 'tatiana-test' })
    expect(await bcrypt.compare('new-pass-456', u.password)).to.equal(true)
    expect(await bcrypt.compare('old-pass-123', u.password)).to.equal(false)
  })
  it('refuses a wrong current password and a new one shorter than 8', async () => {
    expect((await change({ currentPassword: 'wrong', newPassword: 'new-pass-456' })).status).to.equal(401)
    expect((await change({ currentPassword: 'old-pass-123', newPassword: 'short' })).status).to.equal(400)
  })
})

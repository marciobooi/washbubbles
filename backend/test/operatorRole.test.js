import { expect } from 'chai'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'

describe('OPERATOR role: a shop assistant can only start or release a machine', function () {
  this.timeout(20000)
  let app, tenant, opToken, machine, Machine
  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Machine = (await import('../src/models/machine.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant } = await seedTenantAndUsers())
    const User = (await import('../src/models/user.js')).default
    const op = await User.create({ username: 'tatiana-test', email: 'op@test.local', password: await bcrypt.hash('x-pass-123', 10), role: 'OPERATOR', tenantId: tenant._id })
    opToken = signToken(op)
    machine = await Machine.create({ tenantId: tenant._id, name: 'Secar 7', type: 'dry', number: 7, status: 'free' })
  })
  const as = (m, url) => request(app)[m](url).set('Authorization', `Bearer ${opToken}`)

  it('can list the machines', async () => {
    const r = await as('get', '/api/admin/machines')
    expect(r.status).to.equal(200)
    expect(r.body).to.have.length(1)
  })
  it('can start and release a machine (the guard lets it through: not 401/403)', async () => {
    const s = await as('post', `/api/admin/machines/${machine._id}/start`).send({})
    expect(s.status).to.not.be.oneOf([401, 403])
    const e = await as('post', `/api/admin/machines/${machine._id}/end`).send({})
    expect(e.status).to.not.be.oneOf([401, 403])
  })
  it('cannot reach anything else: users, settings, prices, cards, day close, audit, service state', async () => {
    for (const [m, url] of [
      ['get', '/api/admin/users'], ['post', '/api/admin/users'], ['get', '/api/admin/cards'], ['get', '/api/admin/audit-log'],
      ['post', '/api/admin/hopper/empty'], ['post', '/api/admin/cards/blank-reader'], ['get', '/api/admin/day-close/summary'],
      ['put', `/api/admin/machines/${machine._id}`], ['delete', `/api/admin/machines/${machine._id}`], ['post', `/api/admin/machines/${machine._id}/service`],
    ]) {
      const r = await as(m, url).send({})
      expect(r.status, `${m} ${url}`).to.equal(403)
    }
  })
})

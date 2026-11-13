import { expect } from 'chai'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'

describe('OPERATOR role: a shop assistant runs the machines, the till and the hopper, and nothing else', function () {
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
  it('cannot reach anything else: users, settings, cards, audit, service state', async () => {
    for (const [m, url] of [
      ['get', '/api/admin/users'], ['post', '/api/admin/users'], ['get', '/api/admin/cards'], ['get', '/api/admin/audit-log'],
      ['post', '/api/admin/cards/blank-reader'], ['get', '/api/admin/settings/adminPin'],
      ['put', `/api/admin/machines/${machine._id}`], ['delete', `/api/admin/machines/${machine._id}`], ['post', `/api/admin/machines/${machine._id}/service`],
    ]) {
      const r = await as(m, url).send({})
      expect(r.status, `${m} ${url}`).to.equal(403)
    }
  })
})

describe('OPERATOR role: the till and the hopper are hers (2026-11-13)', function () {
  this.timeout(20000)
  let app, tenant, opToken
  before(async () => { await startTestDb(); app = await buildTestApp() })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant } = await seedTenantAndUsers())
    const User = (await import('../src/models/user.js')).default
    const op = await User.create({ username: 'tatiana-caixa', email: 'op2@test.local', password: await bcrypt.hash('x-pass-123', 10), role: 'OPERATOR', tenantId: tenant._id })
    opToken = signToken(op)
  })
  const as = (m, url) => request(app)[m](url).set('Authorization', `Bearer ${opToken}`)

  it('reads the day close, its history, and does the cash and hopper actions (the guard lets her through: not 401/403)', async () => {
    expect((await as('get', '/api/admin/day-close/summary')).status).to.equal(200)
    expect((await as('get', '/api/admin/day-close')).status).to.equal(200)
    for (const [m, url, body] of [
      ['post', '/api/admin/day-close/adjust-float', { amount: 10 }],
      ['post', '/api/admin/day-close/withdraw', { amount: 1 }],
      ['post', '/api/admin/day-close/exchange', { notesOut: [{ value: 10, count: 1 }], coinsIn: [{ value: 1, count: 10 }] }],
      ['post', '/api/admin/hopper/restore', { coins: [{ value: 2, count: 5 }] }],
      ['post', '/api/admin/hopper/refill', { coins: [{ value: 2, count: 5 }] }],
      ['post', '/api/admin/hopper/empty', {}],            // refused for lack of the confirmation, not for the role
      ['post', '/api/admin/day-close/payout-coins', { amount: 5 }],
    ]) {
      const r = await as(m, url).send(body)
      expect(r.status, `${m} ${url}`).to.not.be.oneOf([401, 403])
    }
  })
})

describe('an admin can create and edit OPERATOR users', function () {
  this.timeout(20000)
  let app, adminToken, User
  before(async () => { await startTestDb(); app = await buildTestApp(); User = (await import('../src/models/user.js')).default })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); const { admin } = await seedTenantAndUsers(); adminToken = signToken(admin) })

  it('creates one, and changes an existing user to OPERATOR (was "Invalid role")', async () => {
    const c = await request(app).post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`).send({ username: 'nova', role: 'OPERATOR', password: 'op-pass-1234' })
    expect(c.status).to.be.oneOf([200, 201])
    const u = await User.findOne({ username: 'nova' })
    expect(u.role).to.equal('OPERATOR')
    const other = await User.create({ username: 'outra', role: 'STAFF', password: 'x', tenantId: u.tenantId })
    const r = await request(app).put(`/api/admin/users/${other._id}`).set('Authorization', `Bearer ${adminToken}`).send({ role: 'OPERATOR' })
    expect(r.status).to.equal(200)
    expect((await User.findById(other._id)).role).to.equal('OPERATOR')
  })
  it('refuses a password shorter than 8', async () => {
    const r = await request(app).post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`).send({ username: 'curta', role: 'OPERATOR', password: 'short' })
    expect(r.status).to.equal(400)
  })
})

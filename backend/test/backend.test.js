import { expect } from 'chai'
import request from 'supertest'
import {
  startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers,
} from './setup.test-helper.js'

// NOTE: /api/auth/login is rate-limited to 6 requests/15min per IP (see
// routes/auth.js). Every test below logs in at most once and reuses the
// resulting token, to stay well under that limit across the whole file.
describe('WashBubbles backend', function () {
  this.timeout(20000)

  let app, tenant, kiosk, adminToken, kioskToken

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    await clearTestDb()
    ;({ tenant, kiosk } = await seedTenantAndUsers())
  })

  after(async () => {
    await stopTestDb()
  })

  describe('GET /api/health', () => {
    it('responds ok', async () => {
      const res = await request(app).get('/api/health')
      expect(res.status).to.equal(200)
      expect(res.body).to.deep.equal({ ok: true })
    })
  })

  describe('POST /api/auth/login', () => {
    it('logs an admin in with correct credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })
      expect(res.status).to.equal(200)
      expect(res.body.token).to.be.a('string')
      expect(res.body.role).to.equal('SUPERADMIN')
      adminToken = res.body.token
    })

    it('rejects a wrong password', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' })
      expect(res.status).to.equal(401)
    })

    it('logs a kiosk in via apiKey', async () => {
      const res = await request(app).post('/api/auth/login').send({ apiKey: kiosk.apiKey })
      expect(res.status).to.equal(200)
      expect(res.body.role).to.equal('KIOSK')
      kioskToken = res.body.token
    })
  })

  describe('Admin machines', () => {
    it('creates, lists and deletes a machine', async () => {
      const create = await request(app)
        .post('/api/admin/machines')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Machine A', type: 'wash' })
      expect(create.status).to.equal(200)
      expect(create.body.name).to.equal('Machine A')

      const list = await request(app).get('/api/admin/machines').set('Authorization', `Bearer ${adminToken}`)
      expect(list.status).to.equal(200)
      expect(list.body).to.have.length(1)

      const del = await request(app)
        .delete(`/api/admin/machines/${create.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(del.status).to.equal(200)
    })

    // Regression test: two machines with no `number` used to collide on the
    // {tenantId, number} unique index (compound sparse indexes don't skip a
    // doc unless ALL indexed fields are missing — see models/machine.js).
    it('allows creating multiple machines with no explicit number', async () => {
      const first = await request(app)
        .post('/api/admin/machines')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Machine A' })
      expect(first.status).to.equal(200)

      const second = await request(app)
        .post('/api/admin/machines')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Machine B' })
      expect(second.status).to.equal(200)
    })
  })

  describe('Admin tenants (superadmin only)', () => {
    it('lists tenants for a superadmin', async () => {
      const res = await request(app).get('/api/admin/tenants').set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).to.equal(200)
      expect(res.body.map((t) => t.slug)).to.include('test-tenant')
    })
  })

  describe('POS sale (kiosk)', () => {
    it('rejects unauthenticated access', async () => {
      const res = await request(app).get('/api/pos/machines')
      expect(res.status).to.equal(401)
    })

    it('creates a sale for an existing machine', async () => {
      const Machine = (await import('../src/models/machine.js')).default
      const machine = await Machine.create({ tenantId: tenant._id, name: 'Sale Test Machine', type: 'wash' })

      const res = await request(app)
        .post('/api/pos/sale')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ machineId: machine._id.toString(), amount: 5, items: [{ name: 'Sale Test Machine' }], method: 'cash', inserted: 5 })

      expect(res.status).to.equal(200)
      expect(res.body.sale.amount).to.equal(5)
      expect(res.body.machine.status).to.equal('working')
    })
  })
})

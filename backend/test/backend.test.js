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

  // These lock in the money-handling fixes. Every one of them was a live bug:
  // an unchecked amount on any of these paths was unlimited free credit.
  describe('Money input validation', () => {
    let card

    before(async () => {
      const Card = (await import('../src/models/card.js')).default
      card = await Card.create({ tenantId: tenant._id, code: 'VALIDATION-CARD', balance: 10 })
    })

    it('rejects a negative spend instead of crediting the card', async () => {
      const res = await request(app)
        .post('/api/pos/cards/VALIDATION-CARD/spend')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ amount: -50, items: [] })

      expect(res.status).to.equal(400)
      const Card = (await import('../src/models/card.js')).default
      const after = await Card.findById(card._id)
      expect(after.balance).to.equal(10)
    })

    it('rejects a non-numeric amount', async () => {
      const res = await request(app)
        .post('/api/pos/cards/VALIDATION-CARD/spend')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ amount: 'free', items: [] })
      expect(res.status).to.equal(400)
    })

    it('does not treat a string `inserted` as greater than the total', async () => {
      const Machine = (await import('../src/models/machine.js')).default
      const Price = (await import('../src/models/price.js')).default
      const machine = await Machine.create({ tenantId: tenant._id, name: 'Cash Pay Machine', type: 'wash', weight: 20 })
      await Price.create({ tenantId: tenant._id, type: 'wash', weight: 20, cashPrice: 20, cardPrice: 20 })

      const res = await request(app)
        .post('/api/gateways/cash/pay')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ items: [{ id: machine._id.toString(), price: 20 }], inserted: '5' })

      // "5" + 0.0001 used to be the string "50.0001", which compared greater
      // than 20 — a free wash plus €45 of change out of the hopper.
      expect(res.status).to.equal(400)
      expect(res.body.error).to.equal('Insufficient cash')
    })

    it('prices machine lines from the DB, not from the client', async () => {
      const Machine = (await import('../src/models/machine.js')).default
      const Price = (await import('../src/models/price.js')).default
      const machine = await Machine.create({ tenantId: tenant._id, name: 'Priced Machine', type: 'wash', weight: 12 })
      await Price.create({ tenantId: tenant._id, type: 'wash', weight: 12, cashPrice: 8, cardPrice: 7 })

      const res = await request(app)
        .post('/api/gateways/cash/pay')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ items: [{ id: machine._id.toString(), price: 0.01 }], inserted: 10 })

      expect(res.status).to.equal(200)
      expect(res.body.total).to.equal(8)
      expect(res.body.change).to.equal(2)
    })
  })

  describe('Sync push idempotency', () => {
    let card

    before(async () => {
      const Card = (await import('../src/models/card.js')).default
      card = await Card.create({ tenantId: tenant._id, code: 'SYNC-CARD', balance: 0 })
    })

    it('applies a card delta only once when the push is retried', async () => {
      const body = { code: 'SYNC-CARD', delta: 20, localId: 'op-abc-123' }

      const first = await request(app).post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`).send(body)
      expect(first.status).to.equal(200)
      expect(first.body.balance).to.equal(20)

      // Same operation replayed — a timeout or power cut on the kiosk does
      // exactly this. Without the dedupe key the customer ends up with €40.
      const retry = await request(app).post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`).send(body)
      expect(retry.status).to.equal(200)
      expect(retry.body.status).to.equal('duplicate')
      expect(retry.body.balance).to.equal(20)
    })

    it('refuses a delta with no idempotency key', async () => {
      const res = await request(app).post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`).send({ code: 'SYNC-CARD', delta: 5 })
      expect(res.status).to.equal(400)
    })

    it('refuses a delta that would drive the balance negative', async () => {
      // Balance is 20 at this point; -50 is within the ±1000 cap but overdraws.
      const res = await request(app).post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ code: 'SYNC-CARD', delta: -50, localId: 'op-overdraw' })
      expect(res.status).to.equal(409)
    })

    it('rejects a delta beyond the per-push cap', async () => {
      const res = await request(app).post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ code: 'SYNC-CARD', delta: 999999, localId: 'op-huge' })
      expect(res.status).to.equal(400)
    })

    it('accepts a sale pushed with a UUID local id', async () => {
      // The kiosk generates UUIDs, which are not ObjectIds. Casting one used to
      // throw a CastError and 500, so offline sales never synced at all.
      const res = await request(app).post('/api/sync/push/sale')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ id: '3f6c1b2e-9a4d-4c7e-8b1f-2d5a6c7e8f90', local_id: '3f6c1b2e-9a4d-4c7e-8b1f-2d5a6c7e8f90', amount: 5, method: 'cash', type: 'payment' })
      expect(res.status).to.equal(200)
      expect(res.body.status).to.equal('created')
    })

    it('accepts a day-close push', async () => {
      const res = await request(app).post('/api/sync/push/day-close')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ local_id: 'dc-1', date: '2026-09-07', total_sales: 100, total_cash: 60, total_card: 40, sale_count: 12 })
      expect(res.status).to.equal(200)
      expect(res.body.status).to.equal('created')

      const dup = await request(app).post('/api/sync/push/day-close')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ local_id: 'dc-1', date: '2026-09-07', total_sales: 100 })
      expect(dup.body.status).to.equal('duplicate')
    })
  })

  describe('Tenant isolation', () => {
    it('will not let one tenant\'s admin modify another tenant\'s user', async () => {
      const Tenant = (await import('../src/models/tenant.js')).default
      const User = (await import('../src/models/user.js')).default
      const other = await Tenant.create({ name: 'Other Tenant', slug: 'other-tenant' })
      const victim = await User.create({
        username: 'victim', password: 'x', role: 'ADMIN', tenantId: other._id,
      })

      const res = await request(app)
        .put(`/api/admin/users/${victim._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'USER', password: 'takeover123' })

      expect(res.status).to.equal(404)
      const after = await User.findById(victim._id)
      expect(after.role).to.equal('ADMIN')
      expect(after.password).to.equal('x')
    })

    it('has no public register route', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'attacker', password: 'password', role: 'SUPERADMIN' })
      expect(res.status).to.equal(404)
    })
  })
})

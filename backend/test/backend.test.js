import { expect } from 'chai'
import request from 'supertest'
import {
  startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken,
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

    it('a purchase re-keyed to the chip id renames the card here instead of making a second one', async () => {
      const Card = (await import('../src/models/card.js')).default
      await Card.create({ tenantId: tenant._id, code: 'OLD-GEN-ID', balance: 5, status: 'pending_write' })
      const res = await request(app).post('/api/sync/push/card').set('Authorization', `Bearer ${kioskToken}`)
        .send({ create: true, code: 'CHIP-ID-1', previousCode: 'OLD-GEN-ID', balance: 5, status: 'active' })
      expect(res.status).to.equal(200)
      expect(await Card.countDocuments({ tenantId: tenant._id, code: 'OLD-GEN-ID' })).to.equal(0)
      const all = await Card.find({ tenantId: tenant._id, code: 'CHIP-ID-1' })
      expect(all).to.have.length(1)
      expect(all[0].balance).to.equal(5)
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

  describe('Sync: peripheral status up, full config down', () => {
    it('stores the shop-reported status on the central peripheral, and ignores bad input', async () => {
      const Peripheral = (await import('../src/models/peripheral.js')).default
      const p = await Peripheral.create({ tenantId: tenant._id, name: 'Coin', type: 'coin_acceptor', status: 'fault' })
      const res = await request(app).post('/api/sync/push/peripheral-status')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ peripherals: [{ id: p._id.toString(), status: 'ok' }, { id: 'not-an-id', status: 'ok' }, { id: p._id.toString(), status: 'exploded' }] })
      expect(res.status).to.equal(200)
      expect(res.body.updated).to.equal(1)
      expect((await Peripheral.findById(p._id)).status).to.equal('ok')
    })

    it('returns machines and settings on a full pull (they have no updatedAt)', async () => {
      const Machine = (await import('../src/models/machine.js')).default
      await Machine.create({ tenantId: tenant._id, name: 'Pull Me', type: 'wash', weight: 7 })
      const res = await request(app).get('/api/sync/pull/machines').set('Authorization', `Bearer ${kioskToken}`)
      expect(res.status).to.equal(200)
      expect(res.body.map((m) => m.name)).to.include('Pull Me')
    })
  })

  describe('Sync push: card creation and status (offline card purchase)', () => {
    it('creates a card at the id the kiosk generated, and is idempotent on code', async () => {
      const id = 'aaaaaaaaaaaaaaaaaaaaaaaa' // 24 hex chars, like a Mongo ObjectId
      const body = { create: true, id, code: 'OFFLINE-CARD-1', balance: 5, status: 'pending_write' }

      const first = await request(app).post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`).send(body)
      expect(first.status).to.equal(200)
      expect(first.body.status).to.equal('created')
      expect(first.body.id).to.equal(id)
      expect(first.body.balance).to.equal(5)

      // Retried create (popup reopened, a timeout) must not mint a second card.
      const retry = await request(app).post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`).send(body)
      expect(retry.status).to.equal(200)
      expect(retry.body.id).to.equal(id)

      const Card = (await import('../src/models/card.js')).default
      const count = await Card.countDocuments({ tenantId: tenant._id, code: 'OFFLINE-CARD-1' })
      expect(count).to.equal(1)
    })

    it('refuses to create a card with no code', async () => {
      const res = await request(app).post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`).send({ create: true, balance: 5 })
      expect(res.status).to.equal(400)
    })

    it('lets the kiosk confirm pending_write -> active once the card is written', async () => {
      const Card = (await import('../src/models/card.js')).default
      const pending = await Card.create({ tenantId: tenant._id, code: 'WRITE-ME', balance: 5, status: 'pending_write' })

      const res = await request(app).post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`).send({ code: 'WRITE-ME', status: 'active' })
      expect(res.status).to.equal(200)
      expect(res.body.status).to.equal('active')

      const reloaded = await Card.findById(pending._id)
      expect(reloaded.status).to.equal('active')
    })

    it('refuses to reactivate a blocked card via a status push', async () => {
      // A compromised kiosk credential silently un-blocking a lost/stolen
      // card would defeat the entire point of blocking it.
      const Card = (await import('../src/models/card.js')).default
      await Card.create({ tenantId: tenant._id, code: 'BLOCKED-CARD', balance: 5, status: 'blocked' })

      const res = await request(app).post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`).send({ code: 'BLOCKED-CARD', status: 'active' })
      expect(res.status).to.equal(409)

      const reloaded = await Card.findOne({ tenantId: tenant._id, code: 'BLOCKED-CARD' })
      expect(reloaded.status).to.equal('blocked')
    })
  })

  // The whole point of the atomic helpers in services/cardBalance.js: two kiosks
  // in the same tenant hitting one card concurrently used to both read the old
  // balance, and the second save() overwrote the first.
  describe('Concurrent card access', () => {
    it('lets only one of two simultaneous spends succeed on an underfunded card', async () => {
      const Card = (await import('../src/models/card.js')).default
      const card = await Card.create({ tenantId: tenant._id, code: 'RACE-CARD', balance: 10 })

      // Two €8 spends against a €10 balance. Exactly one may win.
      const spend = () => request(app)
        .post('/api/pos/cards/RACE-CARD/spend')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ amount: 8, items: [] })

      const [a, b] = await Promise.all([spend(), spend()])
      const statuses = [a.status, b.status].sort()
      expect(statuses).to.deep.equal([200, 400])

      const after = await Card.findById(card._id)
      expect(after.balance).to.equal(2)
    })

    it('applies concurrent credits without losing one', async () => {
      const Card = (await import('../src/models/card.js')).default
      const card = await Card.create({ tenantId: tenant._id, code: 'CREDIT-RACE', balance: 0 })

      // Five distinct €10 recharges at once. A read-modify-write would lose some.
      const pushes = [1, 2, 3, 4, 5].map((n) => request(app)
        .post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ code: 'CREDIT-RACE', delta: 10, localId: `race-op-${n}` }))

      const results = await Promise.all(pushes)
      expect(results.every((r) => r.status === 200)).to.equal(true)

      const after = await Card.findById(card._id)
      expect(after.balance).to.equal(50)
      expect(after.appliedDeltas).to.have.length(5)
    })

    it('applies a concurrently-retried delta exactly once', async () => {
      const Card = (await import('../src/models/card.js')).default
      const card = await Card.create({ tenantId: tenant._id, code: 'RETRY-RACE', balance: 0 })

      // The SAME operation pushed three times simultaneously — what a kiosk does
      // when a request times out and it retries while the original is in flight.
      const push = () => request(app)
        .post('/api/sync/push/card')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ code: 'RETRY-RACE', delta: 25, localId: 'same-op-id' })

      await Promise.all([push(), push(), push()])

      const after = await Card.findById(card._id)
      expect(after.balance).to.equal(25)
      expect(after.appliedDeltas).to.have.length(1)
    })
  })

  // The physical lifecycle: pay -> dispenser ejects a BLANK card -> customer
  // inserts it in the reader -> we write their id + balance onto it -> usable.
  describe('Loyalty card lifecycle', () => {
    it('refuses to sell a card when no dispenser is configured, and does not charge', async () => {
      const Setting = (await import('../src/models/setting.js')).default
      const Sale = (await import('../src/models/sale.js')).default
      await Setting.create({ tenantId: tenant._id, key: 'loyaltyCard.cost', value: 5 })
      await Setting.create({ tenantId: tenant._id, key: 'loyaltyCard.credit', value: 2 })

      const before = await Sale.countDocuments({ tenantId: tenant._id, type: 'card_purchase' })
      const res = await request(app)
        .post('/api/pos/card/purchase')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ inserted: 10 })

      // No dispenser in the test environment, so this must fail closed.
      expect(res.status).to.equal(503)
      const after = await Sale.countDocuments({ tenantId: tenant._id, type: 'card_purchase' })
      expect(after, 'no sale may be recorded when no card comes out').to.equal(before)
    })

    it('rejects an underpayment for a card', async () => {
      const res = await request(app)
        .post('/api/pos/card/purchase')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ inserted: 1 })
      expect(res.status).to.equal(400)
      expect(res.body.error).to.match(/Insufficient payment/)
    })

    it('will not let a blank (unwritten) card be spent', async () => {
      const Card = (await import('../src/models/card.js')).default
      const Machine = (await import('../src/models/machine.js')).default
      await Card.create({
        tenantId: tenant._id, code: 'BLANK-CARD', balance: 50, status: 'pending_write',
      })
      const machine = await Machine.create({ tenantId: tenant._id, name: 'Blank Card Machine', type: 'wash' })

      const spend = await request(app)
        .post('/api/pos/cards/BLANK-CARD/spend')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ amount: 5, items: [] })
      expect(spend.status).to.equal(409)
      expect(spend.body.error).to.match(/not activated/)

      const sale = await request(app)
        .post('/api/pos/sale')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ machineId: machine._id.toString(), amount: 5, items: [{}], method: 'card', cardCode: 'BLANK-CARD' })
      expect(sale.status).to.equal(409)

      // Balance untouched on both attempts.
      const after = await Card.findOne({ code: 'BLANK-CARD' })
      expect(after.balance).to.equal(50)
    })

    it('lets an activated card be spent normally', async () => {
      const Card = (await import('../src/models/card.js')).default
      await Card.create({ tenantId: tenant._id, code: 'ACTIVE-CARD', balance: 20, status: 'active' })

      const res = await request(app)
        .post('/api/pos/cards/ACTIVE-CARD/spend')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ amount: 5, items: [] })
      expect(res.status).to.equal(200)

      const after = await Card.findOne({ code: 'ACTIVE-CARD' })
      expect(after.balance).to.equal(15)
    })
  })

  describe('Admin PIN', () => {
    it('refuses when no PIN is configured', async () => {
      const res = await request(app)
        .post('/api/pos/admin/verify-pin')
        .set('Authorization', `Bearer ${kioskToken}`)
        .send({ pin: '1234' })
      expect(res.status).to.equal(409)
      expect(res.body.configured).to.equal(false)
    })

    it('accepts the right PIN and rejects a wrong one', async () => {
      const Setting = (await import('../src/models/setting.js')).default
      await Setting.create({ tenantId: tenant._id, key: 'adminPin', value: '4821' })

      const good = await request(app).post('/api/pos/admin/verify-pin')
        .set('Authorization', `Bearer ${kioskToken}`).send({ pin: '4821' })
      expect(good.status).to.equal(200)

      const bad = await request(app).post('/api/pos/admin/verify-pin')
        .set('Authorization', `Bearer ${kioskToken}`).send({ pin: '0000' })
      expect(bad.status).to.equal(401)
    })
  })

  // Isolated tenant so these totals are never polluted by sales created in
  // earlier describe blocks that share the same test database.
  describe('Day close — cash reconciliation', () => {
    let dcTenant, dcAdminToken, dcKioskToken, dcMachine

    before(async () => {
      const Tenant = (await import('../src/models/tenant.js')).default
      const User = (await import('../src/models/user.js')).default
      const bcrypt = (await import('bcryptjs')).default

      dcTenant = await Tenant.create({ name: 'Day Close Tenant', slug: 'day-close-tenant' })
      const adminHash = await bcrypt.hash('admin1234', 10)
      const dcAdmin = await User.create({ username: 'dc-admin', password: adminHash, role: 'SUPERADMIN', tenantId: dcTenant._id })
      const kioskHash = await bcrypt.hash('kiosk1234', 10)
      const dcKiosk = await User.create({ username: 'dc-kiosk', password: kioskHash, role: 'KIOSK', apiKey: 'dc-kiosk-api-key', tenantId: dcTenant._id })

      // signToken, not a real login — this block only needs tokens for a
      // freshly-created tenant, it isn't testing the login route itself.
      dcAdminToken = signToken(dcAdmin)
      dcKioskToken = signToken(dcKiosk)

      const Machine = (await import('../src/models/machine.js')).default
      dcMachine = await Machine.create({ tenantId: dcTenant._id, name: 'DC Machine', type: 'wash' })
    })

    async function makeCashSale(amount) {
      // Each sale marks the machine 'working'; free it first so this helper can
      // be called repeatedly across tests without a real wash cycle in between.
      const Machine = (await import('../src/models/machine.js')).default
      await Machine.updateOne({ _id: dcMachine._id }, { $set: { status: 'free' } })
      return request(app).post('/api/pos/sale')
        .set('Authorization', `Bearer ${dcKioskToken}`)
        .send({ machineId: dcMachine._id.toString(), amount, items: [{}], method: 'cash', inserted: amount })
    }

    it('starts with an empty session (no prior close)', async () => {
      const res = await request(app).get('/api/admin/day-close/summary').set('Authorization', `Bearer ${dcAdminToken}`)
      expect(res.status).to.equal(200)
      expect(res.body.openingFloat).to.equal(0)
      expect(res.body.totalCash).to.equal(0)
    })

    it('rolls up cash sales into the live summary', async () => {
      const sale = await makeCashSale(5)
      expect(sale.status).to.equal(200)

      const res = await request(app).get('/api/admin/day-close/summary').set('Authorization', `Bearer ${dcAdminToken}`)
      expect(res.body.totalCash).to.equal(5)
      expect(res.body.expectedCash).to.equal(5) // openingFloat 0 + 5 cash
      expect(res.body.salesCount).to.equal(1)
    })

    it('rejects a close where amountToBank + floatLeft does not equal countedCash', async () => {
      const res = await request(app).post('/api/admin/day-close')
        .set('Authorization', `Bearer ${dcAdminToken}`)
        .send({ amountToBank: 3, floatLeft: 1, countedCash: 5 }) // 3+1 != 5
      expect(res.status).to.equal(400)
      expect(res.body.error).to.match(/must equal countedCash/)
    })

    it('closes the session, computing discrepancy and tagging the covered sales', async () => {
      const res = await request(app).post('/api/admin/day-close')
        .set('Authorization', `Bearer ${dcAdminToken}`)
        .send({ amountToBank: 4, floatLeft: 1, countedCash: 5 })
      expect(res.status).to.equal(200)
      expect(res.body.expectedCash).to.equal(5)
      expect(res.body.discrepancy).to.equal(0)
      expect(res.body.floatLeft).to.equal(1)
      expect(res.body.source).to.equal('dashboard')

      const Sale = (await import('../src/models/sale.js')).default
      const tagged = await Sale.find({ tenantId: dcTenant._id, dayCloseId: res.body._id })
      expect(tagged).to.have.length(1)
      expect(tagged[0].amount).to.equal(5)
    })

    it('carries floatLeft forward as the next session\'s opening float', async () => {
      const res = await request(app).get('/api/admin/day-close/summary').set('Authorization', `Bearer ${dcAdminToken}`)
      expect(res.body.openingFloat).to.equal(1) // floatLeft from the previous close
      expect(res.body.totalCash).to.equal(0) // no new sales yet this session
      expect(res.body.expectedCash).to.equal(1)
    })

    it('does not lose a sale that lands in the gap between periodTo and createdAt', async () => {
      // Simulates the real timing gap directly: a close whose periodTo (when the
      // counted period logically ended) is a moment before its createdAt (when
      // Mongo actually wrote the document) — inescapable, since periodTo is
      // captured at the start of the request and createdAt at the very end.
      // The fix reads periodTo, not createdAt, as the next session's start.
      // In production periodTo is captured at the START of the closing request
      // and createdAt is set when the document is finally saved, moments LATER
      // — so periodTo is always a little earlier than createdAt. Reproduce that
      // ordering directly rather than relying on real timing.
      const DayClose = (await import('../src/models/dayClose.js')).default
      const priorClose = await DayClose.findOne({ tenantId: dcTenant._id }).sort({ createdAt: -1 })
      const periodTo = new Date(priorClose.createdAt.getTime() - 5)
      await DayClose.updateOne({ _id: priorClose._id }, { $set: { periodTo } })

      // A sale timestamped between the (earlier) periodTo and the (later)
      // createdAt: under the old buggy boundary (`$gt: createdAt`) this falls
      // BEFORE createdAt and is excluded forever; under the fix (`$gt: periodTo`)
      // it correctly lands in the next open session.
      const gapSale = await makeCashSale(2)
      const Sale = (await import('../src/models/sale.js')).default
      await Sale.updateOne({ _id: gapSale.body.sale._id }, { $set: { createdAt: new Date(priorClose.createdAt.getTime() - 2) } })

      const res = await request(app).get('/api/admin/day-close/summary').set('Authorization', `Bearer ${dcAdminToken}`)
      expect(res.body.totalCash).to.equal(2)
      expect(new Date(res.body.periodFrom).getTime()).to.equal(periodTo.getTime())
    })

    it('never lets a kiosk-pushed Z-report reset the float chain', async () => {
      // The kiosk pushes its own informational record to the same collection.
      // It must be invisible to the dashboard's reconciliation chain.
      const kioskPush = await request(app).post('/api/sync/push/day-close')
        .set('Authorization', `Bearer ${dcKioskToken}`)
        .send({ local_id: 'kiosk-close-1', date: '2026-01-01', total_sales: 999, total_cash: 999 })
      expect(kioskPush.status).to.equal(200)

      const res = await request(app).get('/api/admin/day-close/summary').set('Authorization', `Bearer ${dcAdminToken}`)
      // Still chained off the last DASHBOARD close's floatLeft (1), not reset to
      // 0 by the kiosk's push, and totalCash still reflects the gap sale above,
      // not the kiosk's unrelated figures.
      expect(res.body.openingFloat).to.equal(1)
      expect(res.body.totalCash).to.equal(2)
    })

    it('refuses to double-book two closes racing on the same opening state', async () => {
      // Two submissions fired together, same tenant. The lock is acquired
      // atomically at the very start of the route — before any of the slower
      // read/compute work — so exactly one of two truly concurrent callers can
      // ever hold it; the other is rejected immediately rather than being left
      // to race the reconciliation logic itself.
      const submit = () => request(app).post('/api/admin/day-close')
        .set('Authorization', `Bearer ${dcAdminToken}`)
        .send({ amountToBank: 3, floatLeft: 0, countedCash: 3 })

      const [a, b] = await Promise.all([submit(), submit()])
      const statuses = [a.status, b.status].sort()
      expect(statuses, `got statuses ${a.status},${b.status}`).to.deep.equal([200, 409])
    })

    // The kiosk can now perform the same close, not just the admin dashboard.
    describe('from the kiosk', () => {
      before(async () => {
        const Setting = (await import('../src/models/setting.js')).default
        await Setting.updateOne(
          { tenantId: dcTenant._id, key: 'adminPin' },
          { $set: { value: '7391' } },
          { upsert: true }
        )
      })

      it('lets a kiosk token read the live summary with no PIN required', async () => {
        const res = await request(app).get('/api/pos/day-close/summary').set('Authorization', `Bearer ${dcKioskToken}`)
        expect(res.status).to.equal(200)
        expect(res.body).to.have.property('expectedCash')
      })

      it('refuses a kiosk-submitted close with no PIN', async () => {
        const summary = await request(app).get('/api/pos/day-close/summary').set('Authorization', `Bearer ${dcKioskToken}`)
        const cash = summary.body.expectedCash
        const res = await request(app).post('/api/pos/day-close')
          .set('Authorization', `Bearer ${dcKioskToken}`)
          .send({ amountToBank: cash, floatLeft: 0, countedCash: cash })
        expect(res.status).to.equal(400)
      })

      it('refuses a kiosk-submitted close with the wrong PIN', async () => {
        const summary = await request(app).get('/api/pos/day-close/summary').set('Authorization', `Bearer ${dcKioskToken}`)
        const cash = summary.body.expectedCash
        const res = await request(app).post('/api/pos/day-close')
          .set('Authorization', `Bearer ${dcKioskToken}`)
          .send({ amountToBank: cash, floatLeft: 0, countedCash: cash, pin: '0000' })
        expect(res.status).to.equal(401)
      })

      it('accepts a kiosk-submitted close with the right PIN, recorded exactly like a dashboard close', async () => {
        const summary = await request(app).get('/api/pos/day-close/summary').set('Authorization', `Bearer ${dcKioskToken}`)
        const cash = summary.body.expectedCash
        const res = await request(app).post('/api/pos/day-close')
          .set('Authorization', `Bearer ${dcKioskToken}`)
          .send({ amountToBank: cash, floatLeft: 0, countedCash: cash, pin: '7391' })
        expect(res.status).to.equal(200)
        // Tagged as a real reconciliation, not a kiosk auto-push -- it must
        // chain into future closes' opening float the same way a dashboard
        // close does.
        expect(res.body.source).to.equal('dashboard')
      })

      it('does not require a PIN when the SAME route is called with an admin token', async () => {
        const summary = await request(app).get('/api/pos/day-close/summary').set('Authorization', `Bearer ${dcAdminToken}`)
        const cash = summary.body.expectedCash
        const res = await request(app).post('/api/pos/day-close')
          .set('Authorization', `Bearer ${dcAdminToken}`)
          .send({ amountToBank: cash, floatLeft: 0, countedCash: cash })
        expect(res.status).to.equal(200)
      })
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

describe('Admin start/end without payment', function () {
  let app, tenant, kiosk, adminToken, kioskToken, machine
  before(async () => {
    await startTestDb()
    await clearTestDb()
    app = await buildTestApp()
    ;({ tenant, kiosk } = await seedTenantAndUsers())
    const login = (u, p) => request(app).post('/api/auth/login').send({ username: u, password: p })
    adminToken = (await login('admin', 'admin1234')).body.token
    kioskToken = signToken(kiosk)
    const Machine = (await import('../src/models/machine.js')).default
    machine = await Machine.create({ tenantId: tenant._id, name: 'Lavar Remoto', type: 'wash', weight: 8 })
  })
  after(async () => { await stopTestDb() })

  it('on the central server (no hardware) it queues a command for the shop and leaves the machine alone', async () => {
    const SyncCommand = (await import('../src/models/syncCommand.js')).default
    const res = await request(app).post(`/api/admin/machines/${machine._id}/start`).set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).to.equal(200)
    expect(res.body.queued).to.equal(true)
    const cmd = await SyncCommand.findOne({ kioskId: kiosk._id, type: 'start_machine' })
    expect(cmd.payload.machineId).to.equal(String(machine._id))
    const Machine = (await import('../src/models/machine.js')).default
    expect((await Machine.findById(machine._id)).status).to.equal('free') // not changed until the shop confirms
  })

  it('the shop receives it, and its "done" report marks the machine running on the central copy', async () => {
    const pulled = await request(app).get('/api/sync/commands').set('Authorization', `Bearer ${kioskToken}`)
    expect(pulled.body).to.have.length(1)
    expect(pulled.body[0].type).to.equal('start_machine')
    expect(pulled.body[0].createdAt).to.be.a('string')
    await request(app).post(`/api/sync/commands/${pulled.body[0].id}/done`).set('Authorization', `Bearer ${kioskToken}`).send({})
    const Machine = (await import('../src/models/machine.js')).default
    expect((await Machine.findById(machine._id)).status).to.equal('working')
    // handed out once only
    const again = await request(app).get('/api/sync/commands').set('Authorization', `Bearer ${kioskToken}`)
    expect(again.body).to.have.length(0)
  })

  it('a kiosk cannot ask for it (admin only)', async () => {
    const res = await request(app).post(`/api/admin/machines/${machine._id}/start`).set('Authorization', `Bearer ${kioskToken}`)
    expect(res.status).to.be.oneOf([401, 403])
  })

  it('on the shop (hardware present) the machine is started at once through the interface, and refused without a wiring', async () => {
    const coinMachine = (await import('../src/services/coinMachine.js')).default
    const Machine = (await import('../src/models/machine.js')).default
    const Interface = (await import('../src/models/interface.js')).default
    const sent = []
    const saved = { running: coinMachine.running, tenantId: coinMachine.tenantId, send: coinMachine.middleware.sendMachineActivation }
    coinMachine.running = true
    coinMachine.tenantId = tenant._id
    coinMachine.middleware.sendMachineActivation = async (m, iface) => { sent.push({ machine: m.name, address: iface.address, port: m.port }) }
    try {
      const unwired = await request(app).post(`/api/admin/machines/${machine._id}/start`).set('Authorization', `Bearer ${adminToken}`)
      expect(unwired.status).to.equal(400)
      expect(unwired.body.error).to.match(/no interface/)

      const iface = await Interface.create({ tenantId: tenant._id, name: 'Int T', address: '12', serialNumber: 'SN-T-12', status: 'active' })
      const wired = await Machine.create({ tenantId: tenant._id, name: 'Lavar Ligada', type: 'wash', weight: 8, interfaceId: iface._id, port: 2 })
      const ok = await request(app).post(`/api/admin/machines/${wired._id}/start`).set('Authorization', `Bearer ${adminToken}`)
      expect(ok.status).to.equal(200)
      expect(ok.body.queued).to.equal(false)
      expect(sent).to.have.length(1)
      expect(sent[0].machine).to.equal('Lavar Ligada')
      expect(String(sent[0].address)).to.equal('12')
      expect(sent[0].port).to.equal(2)
      expect((await Machine.findById(wired._id)).status).to.equal('working')

      const twice = await request(app).post(`/api/admin/machines/${wired._id}/start`).set('Authorization', `Bearer ${adminToken}`)
      expect(twice.status).to.equal(400) // already running: no second pulse
      expect(sent).to.have.length(1)

      const end = await request(app).post(`/api/admin/machines/${wired._id}/end`).set('Authorization', `Bearer ${adminToken}`)
      expect(end.status).to.equal(200)
      expect((await Machine.findById(wired._id)).status).to.equal('free')
    } finally {
      coinMachine.running = saved.running
      coinMachine.tenantId = saved.tenantId
      coinMachine.middleware.sendMachineActivation = saved.send
    }
  })
})

describe('Admin setting: automatic refund time', function () {
  let app, adminToken
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    await seedTenantAndUsers()
    adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })).body.token
  })
  after(async () => { await stopTestDb() })
  const save = (value) => request(app).post('/api/admin/settings').set('Authorization', `Bearer ${adminToken}`).send({ key: 'creditRefundSeconds', value })

  it('accepts whole seconds from 0 to 3600', async () => {
    for (const v of [0, 30, 120, 3600]) expect((await save(v)).status).to.equal(200)
  })

  it('refuses anything that could keep or dump a customer\'s money', async () => {
    for (const v of [-1, 3601, 1.5, 'abc', '', null]) expect((await save(v)).status, `value ${JSON.stringify(v)}`).to.equal(400)
  })

  it('a running shop kiosk uses a new value at once, without a restart', async () => {
    const coinMachine = (await import('../src/services/coinMachine.js')).default
    const before = coinMachine.settings
    coinMachine.settings = { creditRefundSeconds: 120 }
    try {
      await save(45)
      expect(coinMachine.creditRefundSeconds).to.equal(45)
    } finally { coinMachine.settings = before }
  })
})

describe('Admin: the translation dictionary', function () {
  let app, adminToken
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    await seedTenantAndUsers()
    adminToken = (await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin1234' })).body.token
  })
  after(async () => { await stopTestDb() })
  const auth = (r) => r.set('Authorization', `Bearer ${adminToken}`)

  it('starts with the built-in list, marked as such', async () => {
    const res = await auth(request(app).get('/api/admin/landing/glossary'))
    expect(res.status).to.equal(200)
    expect(res.body.isDefault).to.equal(true)
    expect(res.body.entries.length).to.be.greaterThan(20)
  })

  it('saves the admin\'s list (cleaned), which then replaces the built-in one', async () => {
    const res = await auth(request(app).put('/api/admin/landing/glossary')).send({ entries: [{ pt: ' sem filas ', en: 'no queues', fr: 'sans file', de: 'ohne Schlange', es: 'sin colas' }, { pt: '' }] })
    expect(res.status).to.equal(200)
    expect(res.body.entries).to.have.length(1)
    const again = await auth(request(app).get('/api/admin/landing/glossary'))
    expect(again.body.isDefault).to.equal(false)
    expect(again.body.entries[0].de).to.equal('ohne Schlange')
  })

  it('refuses a broken list instead of saving it', async () => {
    const bad = await auth(request(app).put('/api/admin/landing/glossary')).send({ entries: 'not a list' })
    expect(bad.status).to.equal(400)
    const long = await auth(request(app).put('/api/admin/landing/glossary')).send({ entries: [{ pt: 'x'.repeat(200) }] })
    expect(long.status).to.equal(400)
    expect((await auth(request(app).get('/api/admin/landing/glossary'))).body.entries[0].pt).to.equal('sem filas') // unchanged
  })

  it('"restore" brings the built-in list back', async () => {
    const res = await auth(request(app).delete('/api/admin/landing/glossary'))
    expect(res.status).to.equal(200)
    expect(res.body.isDefault).to.equal(true)
    expect((await auth(request(app).get('/api/admin/landing/glossary'))).body.entries.length).to.be.greaterThan(20)
  })

  it('only an admin can change it', async () => {
    const res = await request(app).put('/api/admin/landing/glossary').send({ entries: [] })
    expect(res.status).to.be.oneOf([401, 403])
  })
})

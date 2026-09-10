import { expect } from 'chai'
import request from 'supertest'
import {
  startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken,
} from './setup.test-helper.js'

describe('Round 14 — refunds, roles, coupons, audit log', function () {
  this.timeout(20000)

  let app, tenant, admin, kiosk, adminToken, kioskToken

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
  })

  after(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, admin, kiosk } = await seedTenantAndUsers())
    adminToken = signToken(admin)
    kioskToken = signToken(kiosk)
  })

  describe('Refunds', () => {
    async function createSale(overrides = {}) {
      const Sale = (await import('../src/models/sale.js')).default
      return Sale.create({ tenantId: tenant._id, amount: 5, type: 'payment', method: 'cash', batchId: 'b1', ...overrides })
    }

    it('credits the card back and records a new refund Sale, not a mutation', async () => {
      const Card = (await import('../src/models/card.js')).default
      const card = await Card.create({ tenantId: tenant._id, code: 'CARD1', balance: 10 })
      const sale = await createSale({ amount: 4, method: 'card', cardId: card._id, cardCode: card.code })

      const res = await request(app)
        .post(`/api/admin/transactions/${sale._id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Máquina avariada' })
      expect(res.status).to.equal(200)
      expect(res.body.refund.type).to.equal('refund')
      expect(res.body.refund.amount).to.equal(-4)
      expect(res.body.refund.refundOf).to.equal(String(sale._id))

      const updatedCard = await Card.findById(card._id)
      expect(updatedCard.balance).to.equal(14)

      const original = (await import('../src/models/sale.js')).default
      const reloaded = await original.findById(sale._id)
      expect(reloaded.status).to.equal('refunded')
    })

    it('does not touch a card balance for a cash sale', async () => {
      const sale = await createSale({ amount: 3, method: 'cash' })
      const res = await request(app)
        .post(`/api/admin/transactions/${sale._id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Cliente não recebeu o serviço' })
      expect(res.status).to.equal(200)
      expect(res.body.refund.cardId).to.be.null
    })

    it('rejects a refund with no reason', async () => {
      const sale = await createSale()
      const res = await request(app)
        .post(`/api/admin/transactions/${sale._id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
      expect(res.status).to.equal(400)
    })

    it('refuses to refund the same sale twice', async () => {
      const sale = await createSale()
      await request(app).post(`/api/admin/transactions/${sale._id}/refund`).set('Authorization', `Bearer ${adminToken}`).send({ reason: 'x' })
      const second = await request(app).post(`/api/admin/transactions/${sale._id}/refund`).set('Authorization', `Bearer ${adminToken}`).send({ reason: 'x' })
      expect(second.status).to.equal(400)
    })

    it('refuses to refund a refund', async () => {
      const original = await createSale()
      const refundRes = await request(app).post(`/api/admin/transactions/${original._id}/refund`).set('Authorization', `Bearer ${adminToken}`).send({ reason: 'x' })
      const again = await request(app)
        .post(`/api/admin/transactions/${refundRes.body.refund._id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'x' })
      expect(again.status).to.equal(400)
    })

    it('leaves an already-closed sale`s dayCloseId untouched by the refund row', async () => {
      const DayClose = (await import('../src/models/dayClose.js')).default
      const dc = await DayClose.create({ tenantId: tenant._id, periodFrom: new Date(), periodTo: new Date(), openingFloat: 0, totalCash: 0, totalCard: 0, totalSales: 0, salesCount: 0, countedCash: 0, amountToBank: 0, floatLeft: 0 })
      const sale = await createSale({ dayCloseId: dc._id })
      const res = await request(app).post(`/api/admin/transactions/${sale._id}/refund`).set('Authorization', `Bearer ${adminToken}`).send({ reason: 'x' })
      expect(res.status).to.equal(200)
      expect(res.body.refund.dayCloseId).to.be.null
    })

    it('logs the refund to the audit log', async () => {
      const sale = await createSale()
      await request(app).post(`/api/admin/transactions/${sale._id}/refund`).set('Authorization', `Bearer ${adminToken}`).send({ reason: 'motivo' })
      const log = await request(app).get('/api/admin/audit-log').set('Authorization', `Bearer ${adminToken}`)
      expect(log.status).to.equal(200)
      expect(log.body.some((e) => e.action === 'transaction.refund')).to.equal(true)
    })
  })

  describe('Audit log', () => {
    it('records a price update with the acting user', async () => {
      const create = await request(app)
        .post('/api/admin/prices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'wash', weight: 7, cashPrice: 3, cardPrice: 3 })
      await request(app)
        .put(`/api/admin/prices/${create.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cashPrice: 3.5 })

      const log = await request(app).get('/api/admin/audit-log').set('Authorization', `Bearer ${adminToken}`)
      const entry = log.body.find((e) => e.action === 'price.update')
      expect(entry).to.exist
      expect(entry.actorUsername).to.equal('admin')
    })

    it('flags a direct card balance override distinctly from a normal recharge', async () => {
      const Card = (await import('../src/models/card.js')).default
      const card = await Card.create({ tenantId: tenant._id, code: 'CARD2', balance: 5 })
      await request(app)
        .put(`/api/admin/cards/${card._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ balance: 100 })
      const log = await request(app).get('/api/admin/audit-log').set('Authorization', `Bearer ${adminToken}`)
      const entry = log.body.find((e) => e.action === 'card.balance_override')
      expect(entry).to.exist
      expect(entry.details.before).to.equal(5)
      expect(entry.details.after).to.equal(100)
    })
  })

  describe('Granular roles', () => {
    async function createStaffUser(role) {
      const User = (await import('../src/models/user.js')).default
      const bcrypt = (await import('bcryptjs')).default
      const user = await User.create({ tenantId: tenant._id, username: `u-${role}`, password: await bcrypt.hash('x', 10), role })
      return signToken(user)
    }

    it('lets STAFF read transactions but not create a price', async () => {
      const staffToken = await createStaffUser('STAFF')
      const read = await request(app).get('/api/admin/transactions').set('Authorization', `Bearer ${staffToken}`)
      expect(read.status).to.equal(200)

      const write = await request(app)
        .post('/api/admin/prices')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ type: 'wash', weight: 5, cashPrice: 3, cardPrice: 3 })
      expect(write.status).to.equal(403)
    })

    it('blocks TECHNICIAN from transactions but allows maintenance routes', async () => {
      const techToken = await createStaffUser('TECHNICIAN')
      const tx = await request(app).get('/api/admin/transactions').set('Authorization', `Bearer ${techToken}`)
      expect(tx.status).to.equal(403)

      const maint = await request(app).get('/api/admin/maintenance').set('Authorization', `Bearer ${techToken}`)
      expect(maint.status).to.equal(200)
    })

    it('lets a TECHNICIAN log a manual machine service', async () => {
      const techToken = await createStaffUser('TECHNICIAN')
      const machine = await request(app).post('/api/admin/machines').set('Authorization', `Bearer ${adminToken}`).send({ name: 'M1' })
      const res = await request(app).post(`/api/admin/machines/${machine.body._id}/service`).set('Authorization', `Bearer ${techToken}`)
      expect(res.status).to.equal(200)
      expect(res.body.lastServicedAt).to.exist
    })
  })

  describe('Coupons', () => {
    async function setupMachineAndPrice() {
      const machine = await request(app).post('/api/admin/machines').set('Authorization', `Bearer ${adminToken}`).send({ name: 'M1', type: 'wash', weight: 5 })
      await request(app).post('/api/admin/prices').set('Authorization', `Bearer ${adminToken}`).send({ type: 'wash', weight: 5, cashPrice: 10, cardPrice: 10 })
      return machine.body
    }

    it('applies a percent discount to a cash sale', async () => {
      const machine = await setupMachineAndPrice()
      await request(app).post('/api/admin/coupons').set('Authorization', `Bearer ${adminToken}`).send({ code: 'HALF50', discountType: 'percent', discountValue: 50 })

      const pay = await request(app)
        .post('/api/gateways/cash/pay')
        .set('Authorization', `ApiKey ${kiosk.apiKey}`)
        .send({ items: [{ _id: machine._id }], inserted: 5, couponCode: 'half50' })
      expect(pay.status).to.equal(200)
      expect(pay.body.total).to.equal(5)

      const coupons = await request(app).get('/api/admin/coupons').set('Authorization', `Bearer ${adminToken}`)
      expect(coupons.body[0].redemptionCount).to.equal(1)
    })

    it('refuses a redemption once maxRedemptions is hit', async () => {
      const machine = await setupMachineAndPrice()
      await request(app).post('/api/admin/coupons').set('Authorization', `Bearer ${adminToken}`).send({ code: 'ONCE', discountType: 'fixed', discountValue: 2, maxRedemptions: 1 })

      const first = await request(app).post('/api/gateways/cash/pay').set('Authorization', `ApiKey ${kiosk.apiKey}`).send({ items: [{ _id: machine._id }], inserted: 8, couponCode: 'ONCE' })
      expect(first.body.total).to.equal(8)

      // Machine is now 'working' from the first sale — reset it free for a second attempt.
      const Machine = (await import('../src/models/machine.js')).default
      await Machine.findByIdAndUpdate(machine._id, { status: 'free' })

      const second = await request(app).post('/api/gateways/cash/pay').set('Authorization', `ApiKey ${kiosk.apiKey}`).send({ items: [{ _id: machine._id }], inserted: 10, couponCode: 'ONCE' })
      // Coupon no longer usable — full price applies, so €10 covers it with no shortfall.
      expect(second.body.total).to.equal(10)
    })

    it('ignores an expired coupon', async () => {
      const machine = await setupMachineAndPrice()
      await request(app).post('/api/admin/coupons').set('Authorization', `Bearer ${adminToken}`).send({ code: 'OLD', discountType: 'fixed', discountValue: 5, expiresAt: '2000-01-01' })
      const pay = await request(app).post('/api/gateways/cash/pay').set('Authorization', `ApiKey ${kiosk.apiKey}`).send({ items: [{ _id: machine._id }], inserted: 10, couponCode: 'OLD' })
      expect(pay.body.total).to.equal(10)
    })
  })
})

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

    it('a sale pushed by the shop (card CODE only, no central card id) still credits the card back', async () => {
      const Card = (await import('../src/models/card.js')).default
      const card = await Card.create({ tenantId: tenant._id, code: '365656747', balance: 3.1 })
      const sale = await createSale({ amount: 1.8, method: 'card', cardCode: card.code })
      expect(sale.cardId).to.equal(undefined)

      const res = await request(app)
        .post(`/api/admin/transactions/${sale._id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Falha na ativação' })
      expect(res.status).to.equal(200)
      expect(String(res.body.refund.cardId)).to.equal(String(card._id))
      expect((await Card.findById(card._id)).balance).to.equal(4.9)
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

    describe('partial refund and hopper payout', () => {
      let coinMachine, saved
      const pay = (sale, body) => request(app).post(`/api/admin/transactions/${sale._id}/refund`).set('Authorization', `Bearer ${adminToken}`).send({ reason: 'Faltou troco', ...body })
      beforeEach(async () => {
        coinMachine = (await import('../src/services/coinMachine.js')).default
        saved = { running: coinMachine.running, payOutCash: coinMachine.payOutCash, tenantId: coinMachine.tenantId }
        coinMachine.running = true
        coinMachine.tenantId = tenant._id
        process.env.REFUND_PAYOUT_WAIT_MS = '150'
        process.env.REFUND_PAYOUT_GRACE_MS = '150'
        process.env.REFUND_PAYOUT_POLL_MS = '20'
      })
      afterEach(() => {
        coinMachine.running = saved.running
        coinMachine.payOutCash = saved.payOutCash
        coinMachine.tenantId = saved.tenantId
        delete process.env.REFUND_PAYOUT_WAIT_MS; delete process.env.REFUND_PAYOUT_GRACE_MS; delete process.env.REFUND_PAYOUT_POLL_MS
      })

      it('a part of the sale: records exactly that amount (0.50 of 4)', async () => {
        const sale = await createSale({ amount: 4 })
        const res = await pay(sale, { amount: 0.5 })
        expect(res.status).to.equal(200)
        expect(res.body.refund.amount).to.equal(-0.5)
        expect(res.body.payout).to.equal(null)
      })

      it('the amount cannot exceed the sale nor be zero or garbage', async () => {
        const sale = await createSale({ amount: 4 })
        expect((await pay(sale, { amount: 4.5 })).status).to.equal(400)
        expect((await pay(sale, { amount: 0 })).status).to.equal(400)
        expect((await pay(sale, { amount: 'abc' })).status).to.equal(400)
        expect((await pay(sale, { amount: '2,10' })).status).to.equal(200) // a comma is accepted
      })

      it('payout: the hopper pays the amount, then the refund is recorded', async () => {
        const calls = []
        coinMachine.payOutCash = async (a) => { calls.push(a); return { success: true, dispensed: a, remaining: 0 } }
        const sale = await createSale({ amount: 4 })
        const res = await pay(sale, { amount: 2.1, payout: true })
        expect(res.status).to.equal(200)
        expect(calls).to.deep.equal([2.1])
        expect(res.body.payout).to.deep.include({ requested: 2.1, dispensed: 2.1, owed: 0 })
        expect(res.body.refund.amount).to.equal(-2.1)
      })

      it('payout that comes up short: records the refund, says how much is still owed', async () => {
        coinMachine.payOutCash = async () => ({ success: false, dispensed: 2, remaining: 0.1, error: 'sem moedas de 10c' })
        const sale = await createSale({ amount: 4 })
        const res = await pay(sale, { amount: 2.1, payout: true })
        expect(res.status).to.equal(200)
        expect(res.body.payout.owed).to.equal(0.1)
        expect(res.body.refund.refundReason).to.match(/EM FALTA 0\.10/)
      })

      it('payout where the hopper pays NOTHING: nothing is recorded and the sale stays refundable', async () => {
        coinMachine.payOutCash = async () => ({ success: false, dispensed: 0, remaining: 2.1, error: 'hopper encravado' })
        const sale = await createSale({ amount: 4 })
        const res = await pay(sale, { amount: 2.1, payout: true })
        expect(res.status).to.equal(409)
        const Sale = (await import('../src/models/sale.js')).default
        expect((await Sale.findById(sale._id)).status).to.equal('completed')
        expect(await Sale.countDocuments({ type: 'refund' })).to.equal(0)
      })

      it('a card sale cannot be paid out by the hopper', async () => {
        const Card = (await import('../src/models/card.js')).default
        const card = await Card.create({ tenantId: tenant._id, code: 'CARDP', balance: 1 })
        const sale = await createSale({ amount: 4, method: 'card', cardId: card._id, cardCode: card.code })
        expect((await pay(sale, { payout: true })).status).to.equal(400)
      })

      it('central server: the shop PC is asked; no answer in time = nothing paid, nothing recorded, the order withdrawn', async () => {
        coinMachine.running = false // this process is the central server
        const sale = await createSale({ amount: 4 })
        const res = await pay(sale, { amount: 1, payout: true })
        expect(res.status).to.equal(504)
        const SyncCommand = (await import('../src/models/syncCommand.js')).default
        const cmd = await SyncCommand.findOne({ type: 'pay_out' })
        expect(cmd.status).to.equal('failed') // it can never run later
        const Sale = (await import('../src/models/sale.js')).default
        expect(await Sale.countDocuments({ type: 'refund' })).to.equal(0)
      })

      it('central server: the shop answers, the refund is recorded with what was paid', async () => {
        coinMachine.running = false
        const SyncCommand = (await import('../src/models/syncCommand.js')).default
        const sale = await createSale({ amount: 4 })
        const answer = (async () => {
          for (let i = 0; i < 100; i++) {
            const c = await SyncCommand.findOne({ type: 'pay_out', status: 'pending' })
            if (c) { expect(c.payload.amount).to.equal(0.5); await SyncCommand.updateOne({ _id: c._id }, { status: 'done', result: { success: true, dispensed: 0.5, remaining: 0 } }); return }
            await new Promise((r) => setTimeout(r, 10))
          }
        })()
        process.env.REFUND_PAYOUT_WAIT_MS = '3000'
        const res = await pay(sale, { amount: 0.5, payout: true })
        await answer
        expect(res.status).to.equal(200)
        expect(res.body.payout).to.deep.include({ dispensed: 0.5, owed: 0 })
      })
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

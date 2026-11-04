import { expect } from 'chai'
import mongoose from 'mongoose'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers } from './setup.test-helper.js'
import Sale from '../src/models/sale.js'
import Coupon from '../src/models/coupon.js'
import Card from '../src/models/card.js'
import { redeemCoupon } from '../src/services/coupons.js'
import modelEvents from '../src/services/modelEvents.js'
import { Downlink } from '../src/services/downlink.js'
import { salePayload } from '../src/services/uplink.js'

describe('Sales stay in step between the shop and the central server (refunds both ways)', function () {
  this.timeout(30000)
  let app, tenant
  const kioskKey = 'test-kiosk-api-key'
  before(async () => { await startTestDb(); app = await buildTestApp() })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); ({ tenant } = await seedTenantAndUsers()) })
  const push = (b) => request(app).post('/api/sync/push/sale').set('Authorization', `ApiKey ${kioskKey}`).send(b)
  const pull = () => request(app).get('/api/sync/pull/sale-corrections').set('Authorization', `ApiKey ${kioskKey}`)

  it('shop -> central: a refund made at the shop (even sent later, after being offline) reverses the central sale', async () => {
    expect((await push({ local_id: 'L1', amount: 9, method: 'cash', type: 'payment', batch_id: 'b1' })).body.status).to.equal('created')
    // the shop refunds it: a NEGATIVE row pointing at the shop's id of the sale, and the sale itself now 'refunded'
    const r = await push({ local_id: 'R1', type: 'refund', amount: -9, method: 'cash', batch_id: 'refund-L1', refund_of: 'L1', refund_reason: 'duplicado' })
    expect(r.status).to.equal(200)
    expect(r.body.status).to.equal('created')
    const orig = await Sale.findOne({ 'metadata.localId': 'L1' })
    const ref = await Sale.findOne({ 'metadata.localId': 'R1' })
    expect(orig.status).to.equal('refunded')
    expect(ref.amount).to.equal(-9)
    expect(String(ref.refundOf)).to.equal(String(orig._id))
    expect(ref.refundReason).to.equal('duplicado')
    // a positive "refund" or a negative payment is still refused
    expect((await push({ local_id: 'R2', type: 'refund', amount: 5 })).status).to.equal(400)
    expect((await push({ local_id: 'P2', type: 'payment', amount: -5 })).status).to.equal(400)
  })

  it('shop -> central: a sale that was refunded AFTER it had been sent gets its status updated (not "duplicate")', async () => {
    await push({ local_id: 'L2', amount: 7, method: 'cash', type: 'payment', batch_id: 'b2' })
    const again = await push({ local_id: 'L2', amount: 7, method: 'cash', type: 'payment', batch_id: 'b2', status: 'refunded' })
    expect(again.body.status).to.equal('updated')
    expect((await Sale.findOne({ 'metadata.localId': 'L2' })).status).to.equal('refunded')
    expect((await push({ local_id: 'L2', amount: 7, status: 'refunded' })).body.status).to.equal('duplicate') // and only once
  })

  it('the uplink payload carries the refund fields', () => {
    const id = new mongoose.Types.ObjectId()
    const p = salePayload({ _id: new mongoose.Types.ObjectId(), type: 'refund', amount: -9, refundOf: id, refundReason: 'x', status: 'completed' })
    expect(p.refund_of).to.equal(String(id))
    expect(p.refund_reason).to.equal('x')
    expect(salePayload({ _id: id, amount: 9, status: 'refunded' }).status).to.equal('refunded')
  })

  it('central -> shop: what the admin refunded on the server is copied to the shop, once, without going back up', async () => {
    // central side: a sale that the shop pushed (its own id is metadata.localId) and a refund the admin made on the server
    const shopId = new mongoose.Types.ObjectId() // the id this sale has in the SHOP's database
    const centralOrig = await Sale.create({ tenantId: tenant._id, amount: 9, type: 'payment', method: 'cash', batchId: 'b3', status: 'refunded', metadata: { localId: String(shopId) } })
    const centralRefund = await Sale.create({ tenantId: tenant._id, amount: -9, type: 'refund', method: 'cash', batchId: `refund-${centralOrig._id}`, refundOf: centralOrig._id, refundReason: 'duplicado', status: 'completed' })
    const body = (await pull()).body
    expect(body.refunded).to.deep.equal([{ id: String(centralOrig._id), localId: String(shopId) }])
    expect(body.refunds).to.have.length(1)
    expect(body.refunds[0].refundOfLocalId).to.equal(String(shopId))

    // shop side (same test database, so wipe the central rows and start from what the shop has: the sale as it was)
    await Sale.deleteMany({})
    await Sale.create({ _id: shopId, tenantId: tenant._id, amount: 9, type: 'payment', method: 'cash', batchId: 'b3', status: 'completed' })
    const dl = new Downlink({ tenantId: tenant._id, url: 'http://central.test/api', apiKey: 'k', resources: [], fetchImpl: async () => ({ ok: true, json: async () => body }) })
    expect(await dl.pullSaleCorrections()).to.equal(2)
    expect((await Sale.findById(shopId)).status).to.equal('refunded')
    const row = await Sale.findOne({ type: 'refund' })
    expect(row.amount).to.equal(-9)
    expect(String(row.refundOf)).to.equal(String(shopId))
    expect(row.refundReason).to.equal('duplicado')
    expect(row.metadata.centralId).to.equal(String(centralRefund._id))
    // again: nothing new (idempotent), and still exactly one refund row
    expect(await dl.pullSaleCorrections()).to.equal(0)
    expect(await Sale.countDocuments({ type: 'refund' })).to.equal(1)
  })
})

describe('Coupons and blocked cards stay in step between the shop and the central server', function () {
  this.timeout(30000)
  let app, tenant
  const kioskKey = 'test-kiosk-api-key'
  before(async () => { await startTestDb(); app = await buildTestApp() })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); ({ tenant } = await seedTenantAndUsers()) })
  const api = (m, path, b) => request(app)[m]('/api/sync' + path).set('Authorization', `ApiKey ${kioskKey}`).send(b)
  const fakeDownlink = (body) => new Downlink({ tenantId: tenant._id, url: 'http://central.test/api', apiKey: 'k', resources: [], fetchImpl: async () => ({ ok: true, json: async () => body }) })

  it('central -> shop: a coupon made on the server exists at the shop; changes follow; one removed there is switched off here; uses are never lowered', async () => {
    const dl = fakeDownlink([{ _id: new mongoose.Types.ObjectId(), code: 'verao10', discountType: 'percent', discountValue: 10, appliesTo: 'both', maxRedemptions: 5, redemptionCount: 2, active: true }])
    await dl.pullCoupons()
    let c = await Coupon.findOne({ code: 'VERAO10' })
    expect(c.discountValue).to.equal(10)
    expect(c.redemptionCount).to.equal(2)
    await Coupon.updateOne({ _id: c._id }, { redemptionCount: 4 }) // the shop used it twice more, central has not heard yet
    await fakeDownlink([{ _id: new mongoose.Types.ObjectId(), code: 'VERAO10', discountType: 'percent', discountValue: 15, appliesTo: 'both', maxRedemptions: 5, redemptionCount: 2, active: true }]).pullCoupons()
    c = await Coupon.findOne({ code: 'VERAO10' })
    expect(c.discountValue).to.equal(15) // the change made on the server arrived
    expect(c.redemptionCount).to.equal(4) // the shop's own count was not wound back
    await fakeDownlink([]).pullCoupons() // the admin deleted it on the server
    expect((await Coupon.findOne({ code: 'VERAO10' })).active).to.equal(false)
  })

  it('shop -> central: a use at the shop is announced, queued for the uplink, and the server keeps the larger number', async () => {
    await Coupon.create({ tenantId: tenant._id, code: 'AB', discountType: 'fixed', discountValue: 1, redemptionCount: 0 })
    const seen = []
    const on = (e) => seen.push(e)
    modelEvents.on('coupon:redeemed', on)
    await redeemCoupon(tenant._id, 'ab')
    modelEvents.off('coupon:redeemed', on)
    expect(seen).to.have.length(1)
    expect(seen[0]).to.include({ code: 'AB', redemptionCount: 1 })
    expect((await api('post', '/push/coupon', { code: 'AB', redemption_count: 3 })).status).to.equal(200)
    expect((await Coupon.findOne({ code: 'AB' })).redemptionCount).to.equal(3)
    await api('post', '/push/coupon', { code: 'AB', redemption_count: 1 }) // a late, older push
    expect((await Coupon.findOne({ code: 'AB' })).redemptionCount).to.equal(3)
    expect((await api('post', '/push/coupon', { code: '', redemption_count: 1 })).status).to.equal(400)
  })

  it('central -> shop: a card blocked on the server is blocked at the shop; nothing else of the card is touched', async () => {
    await Card.create({ tenantId: tenant._id, code: 'C1', balance: 12, status: 'active' })
    await Card.create({ tenantId: tenant._id, code: 'C2', balance: 5, status: 'active' })
    const n = await fakeDownlink([{ code: 'C1', status: 'blocked', balance: 0 }, { code: 'C2', status: 'active', balance: 99 }]).pullCardBlocks()
    expect(n).to.equal(1)
    const c1 = await Card.findOne({ code: 'C1' })
    expect(c1.status).to.equal('blocked')
    expect(c1.balance).to.equal(12) // the balance is the shop's
    expect((await Card.findOne({ code: 'C2' })).balance).to.equal(5)
    expect(await fakeDownlink([{ code: 'C1', status: 'blocked' }]).pullCardBlocks()).to.equal(0) // once
  })
})

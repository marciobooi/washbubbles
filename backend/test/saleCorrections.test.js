import { expect } from 'chai'
import mongoose from 'mongoose'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers } from './setup.test-helper.js'
import Sale from '../src/models/sale.js'
import Coupon from '../src/models/coupon.js'
import Card from '../src/models/card.js'
import { redeemCoupon } from '../src/services/coupons.js'
import modelEvents from '../src/services/modelEvents.js'
import AuditLog from '../src/models/auditLog.js'
import { signToken } from './setup.test-helper.js'
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
    const n = await fakeDownlink([{ code: 'C1', status: 'blocked', balance: 0 }, { code: 'C2', status: 'active', balance: 99 }]).pullCards()
    expect(n).to.equal(1)
    const c1 = await Card.findOne({ code: 'C1' })
    expect(c1.status).to.equal('blocked')
    expect(c1.balance).to.equal(12) // the balance is the shop's
    expect((await Card.findOne({ code: 'C2' })).balance).to.equal(5)
    expect(await fakeDownlink([{ code: 'C1', status: 'blocked' }]).pullCards()).to.equal(0) // once
  })
})

describe('Cards (details, balance changes) and the shop audit trail stay in step', function () {
  this.timeout(30000)
  let app, tenant, admin, savedSync
  const kioskKey = 'test-kiosk-api-key'
  // the CENTRAL server has no SYNC_SERVER_URL (a shop PC has): the adjustments are only recorded there
  before(async () => { savedSync = process.env.SYNC_SERVER_URL; delete process.env.SYNC_SERVER_URL; await startTestDb(); app = await buildTestApp() })
  after(async () => { if (savedSync !== undefined) process.env.SYNC_SERVER_URL = savedSync; await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); const s = await seedTenantAndUsers(); tenant = s.tenant; admin = s.admin })
  const fakeDownlink = (body, opts = {}) => {
    const sent = []
    const dl = new Downlink({ tenantId: tenant._id, url: 'http://central.test/api', apiKey: 'k', resources: [], ...opts, fetchImpl: async (url, init) => { if (init?.method === 'POST') sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => body } } })
    dl.sent = sent
    return dl
  }
  const kiosk = (m, path, b) => request(app)[m]('/api/sync' + path).set('Authorization', `ApiKey ${kioskKey}`).send(b)

  it('the NEWER edit of the holder\'s details wins, in both directions', async () => {
    await Card.create({ tenantId: tenant._id, code: 'P1', name: 'Local', status: 'active', profileEditedAt: new Date('2026-11-01T10:00:00Z') })
    // central edited later: the shop copies it
    await fakeDownlink([{ code: 'P1', status: 'active', name: 'Central', email: 'c@x.pt', profileEditedAt: '2026-11-02T10:00:00Z' }]).pullCards()
    let c = await Card.findOne({ code: 'P1' })
    expect(c.name).to.equal('Central')
    expect(c.email).to.equal('c@x.pt')
    // central's copy is OLDER than the shop's: the shop keeps its own
    await fakeDownlink([{ code: 'P1', status: 'active', name: 'Old', profileEditedAt: '2026-10-01T10:00:00Z' }]).pullCards()
    expect((await Card.findOne({ code: 'P1' })).name).to.equal('Central')
    // shop -> central: a later edit at the shop reaches the server; an older one does not
    await Card.create({ tenantId: tenant._id, code: 'P2', name: 'Server', status: 'active', profileEditedAt: new Date('2026-11-02T10:00:00Z') })
    await kiosk('post', '/push/card', { create: true, code: 'P2', status: 'active', name: 'Shop OLD', profileEditedAt: '2026-11-01T10:00:00Z' })
    expect((await Card.findOne({ code: 'P2' })).name).to.equal('Server')
    await kiosk('post', '/push/card', { create: true, code: 'P2', status: 'active', name: 'Shop NEW', email: 'n@x.pt', profileEditedAt: '2026-11-03T10:00:00Z' })
    const p2 = await Card.findOne({ code: 'P2' })
    expect(p2.name).to.equal('Shop NEW')
    expect(p2.email).to.equal('n@x.pt')
  })

  it('a balance change made on the server reaches the shop as a DELTA, applied once and acknowledged', async () => {
    // the admin edits the card on the server: balance 10 -> 25
    const card = await Card.create({ tenantId: tenant._id, code: 'B1', balance: 10, status: 'active' })
    const r = await request(app).put(`/api/admin/cards/${card._id}`).set('Authorization', `Bearer ${signToken(admin)}`).send({ balance: 25 })
    expect(r.status).to.equal(200)
    const central = await Card.findOne({ code: 'B1' }).lean()
    expect(central.balance).to.equal(25)
    expect(central.shopAdjustments).to.have.length(1)
    expect(central.shopAdjustments[0].delta).to.equal(15)
    // the shop: its own copy says 10; central offers the adjustment
    await Card.deleteMany({})
    await Card.create({ tenantId: tenant._id, code: 'B1', balance: 10, status: 'active' })
    const adjusted = []
    const dl = fakeDownlink([{ code: 'B1', status: 'active', shopAdjustments: central.shopAdjustments }], { onCardAdjusted: (c) => adjusted.push(c) })
    await dl.pullCards()
    expect((await Card.findOne({ code: 'B1' })).balance).to.equal(25)
    expect(adjusted).to.deep.equal(['B1'])
    expect(dl.sent).to.have.length(1)
    expect(dl.sent[0].url).to.match(/push\/card-ack/)
    expect(dl.sent[0].body.opIds).to.deep.equal([central.shopAdjustments[0].opId])
    // offered AGAIN (the acknowledgement never arrived): not applied twice, only acknowledged
    await dl.pullCards()
    expect((await Card.findOne({ code: 'B1' })).balance).to.equal(25)
    // a card in the reader is left for later
    await Card.updateOne({ code: 'B1' }, { $set: { balance: 10, appliedDeltas: [] } })
    const busy = fakeDownlink([{ code: 'B1', status: 'active', shopAdjustments: central.shopAdjustments }], { cardBusy: () => true })
    await busy.pullCards()
    expect((await Card.findOne({ code: 'B1' })).balance).to.equal(10)
    // the server removes what the shop acknowledged
    await kiosk('post', '/push/card-ack', { code: 'B1', opIds: [central.shopAdjustments[0].opId] })
    // (the central row was deleted above; this only proves the route answers)
  })

  it('the acknowledgement removes the adjustment on the server', async () => {
    await Card.create({ tenantId: tenant._id, code: 'B2', balance: 5, status: 'active', shopAdjustments: [{ opId: 'x1', delta: 2, reason: 'admin', at: new Date() }, { opId: 'x2', delta: 3, reason: 'admin', at: new Date() }] })
    expect((await kiosk('post', '/push/card-ack', { code: 'B2', opIds: ['x1'] })).status).to.equal(200)
    const c = await Card.findOne({ code: 'B2' }).lean()
    expect(c.shopAdjustments.map((a) => a.opId)).to.deep.equal(['x2'])
    expect((await kiosk('post', '/push/card-ack', { code: 'B2', opIds: [] })).status).to.equal(400)
  })

  it('the shop\'s audit entries reach the server once; an entry that came from a shop is not sent back', async () => {
    const seen = []
    const on = (a) => seen.push(a.action)
    modelEvents.on('audit:created', on)
    await AuditLog.create({ tenantId: tenant._id, action: 'hardware.reinit', details: { reason: 'auto' } }) // written at the shop
    await AuditLog.create({ tenantId: tenant._id, action: 'came.from.shop', shopLocalId: 'abc' }) // arrived from a shop
    modelEvents.off('audit:created', on)
    expect(seen).to.deep.equal(['hardware.reinit'])
    const body = { local_id: 'S1', action: 'cash.refund', target_type: 'Sale', target_id: 'z', actor: 'sistema', details: { amount: 4 }, created_at: '2026-11-04T10:00:00Z' }
    expect((await kiosk('post', '/push/audit', body)).status).to.equal(200)
    expect((await kiosk('post', '/push/audit', body)).status).to.equal(200) // a retry
    const rows = await AuditLog.find({ shopLocalId: 'S1' }).lean()
    expect(rows).to.have.length(1)
    expect(rows[0].details.source).to.equal('loja')
    expect(rows[0].details.amount).to.equal(4)
    expect((await kiosk('post', '/push/audit', { action: 'x' })).status).to.equal(400)
  })
})

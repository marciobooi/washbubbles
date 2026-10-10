import { expect } from 'chai'
import request from 'supertest'
import {
  startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken,
} from './setup.test-helper.js'

describe('Dryer blocks: one impulse now, one more every block', function () {
  this.timeout(20000)
  let app, tenant, kiosk, kioskToken, Machine, Interface, Price, Sale, coinMachine
  let sent
  const saved = {}

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Machine = (await import('../src/models/machine.js')).default
    Interface = (await import('../src/models/interface.js')).default
    Price = (await import('../src/models/price.js')).default
    Sale = (await import('../src/models/sale.js')).default
    coinMachine = (await import('../src/services/coinMachine.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, kiosk } = await seedTenantAndUsers())
    kioskToken = signToken(kiosk)
    sent = []
    saved.tenantId = coinMachine.tenantId
    saved.running = coinMachine.running
    saved.middleware = coinMachine.middleware
    coinMachine.tenantId = tenant._id
    coinMachine.running = true
    coinMachine.middleware = { sendMachineActivation: async (m) => { sent.push(m.name); if (coinMachine.__fail) throw new Error('controller offline') } }
    coinMachine.__fail = false
  })
  afterEach(() => {
    coinMachine.tenantId = saved.tenantId
    coinMachine.running = saved.running
    coinMachine.middleware = saved.middleware
    delete coinMachine.__fail
  })

  async function dryer() {
    const iface = await Interface.create({ tenantId: tenant._id, name: 'INT 5', address: 15, serialNumber: 'S15', status: 'active' })
    await Price.create({ tenantId: tenant._id, type: 'dry', weight: 18, cashPrice: 2, cardPrice: 1.8 })
    return Machine.create({ tenantId: tenant._id, name: 'Secar 7', type: 'dry', weight: 18, tImp: 15, interfaceId: iface._id, port: 1 })
  }

  it('blocksFor: dryers only, whole numbers, capped', () => {
    expect(coinMachine.blocksFor({ type: 'dry' }, { quantity: 3 })).to.equal(3)
    expect(coinMachine.blocksFor({ type: 'dry' }, { quantity: 99 })).to.equal(coinMachine.maxBlocks)
    expect(coinMachine.blocksFor({ type: 'dry' }, { quantity: 0 })).to.equal(1)
    expect(coinMachine.blocksFor({ type: 'dry' }, { quantity: 2.7 })).to.equal(2)
    expect(coinMachine.blocksFor({ type: 'wash' }, { quantity: 5 })).to.equal(1)
  })

  it('cash: 3 blocks cost 3 x the price, send ONE impulse now and keep two pending', async () => {
    const m = await dryer()
    const res = await request(app).post('/api/gateways/cash/pay').set('Authorization', `Bearer ${kioskToken}`)
      .send({ items: [{ _id: m._id, quantity: 3 }], inserted: 10, batchId: 'b-dry' })
    expect(res.status).to.equal(200)
    expect(res.body.total).to.equal(6)
    expect(res.body.change).to.equal(4)
    expect(sent).to.deep.equal(['Secar 7'])
    const after = await Machine.findById(m._id)
    expect(after.pendingImpulses).to.equal(2)
    expect(after.nextImpulseAt).to.be.instanceOf(Date)
    const sale = await Sale.findOne({ batchId: 'b-dry' })
    expect(sale.amount).to.equal(6)
  })

  it('the tick sends the next block only when its time has come, and stops after the last', async () => {
    const m = await dryer()
    await Machine.updateOne({ _id: m._id }, { status: 'working', pendingImpulses: 2, nextImpulseAt: new Date(Date.now() + 60_000) })
    expect(await coinMachine.tickImpulses()).to.equal(0) // not yet
    await Machine.updateOne({ _id: m._id }, { nextImpulseAt: new Date(Date.now() - 1000) })
    expect(await coinMachine.tickImpulses()).to.equal(1)
    let cur = await Machine.findById(m._id)
    expect(cur.pendingImpulses).to.equal(1)
    expect(cur.nextImpulseAt.getTime()).to.be.greaterThan(Date.now() + 14 * 60_000)
    await Machine.updateOne({ _id: m._id }, { nextImpulseAt: new Date(Date.now() - 1000) })
    expect(await coinMachine.tickImpulses()).to.equal(1)
    cur = await Machine.findById(m._id)
    expect(cur.pendingImpulses).to.equal(0)
    expect(cur.nextImpulseAt).to.equal(null)
    expect(await coinMachine.tickImpulses()).to.equal(0)
  })

  it('a controller that is away keeps the block pending and is retried', async () => {
    const m = await dryer()
    await Machine.updateOne({ _id: m._id }, { status: 'working', pendingImpulses: 1, nextImpulseAt: new Date(Date.now() - 1000) })
    coinMachine.__fail = true
    expect(await coinMachine.tickImpulses()).to.equal(0)
    expect((await Machine.findById(m._id)).pendingImpulses).to.equal(1)
    coinMachine.__fail = false
    expect(await coinMachine.tickImpulses()).to.equal(1)
    expect((await Machine.findById(m._id)).pendingImpulses).to.equal(0)
  })

  it('cash: when the machine cannot start nothing is recorded and the answer is a 502', async () => {
    const m = await dryer()
    coinMachine.__fail = true
    const res = await request(app).post('/api/gateways/cash/pay').set('Authorization', `Bearer ${kioskToken}`)
      .send({ items: [{ _id: m._id, quantity: 1 }], inserted: 2, batchId: 'b-fail' })
    expect(res.status).to.equal(502)
    expect(await Sale.countDocuments({ batchId: 'b-fail' })).to.equal(0)
    expect((await Machine.findById(m._id)).status).to.equal('free')
  })
})

import { expect } from 'chai'
import request from 'supertest'
import {
  startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken,
} from './setup.test-helper.js'

describe('Dryer blocks: one impulse now, one more every block', function () {
  this.timeout(20000)
  let app, tenant, kiosk, kioskToken, Machine, Interface, Price, Sale, coinMachine
  let sent
  let impulses
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
    impulses = []
    delete process.env.DRYER_IMPULSE_MODE
    process.env.DRYER_IMPULSE_GAP_MS = '5'
    saved.tenantId = coinMachine.tenantId
    saved.running = coinMachine.running
    saved.middleware = coinMachine.middleware
    coinMachine.tenantId = tenant._id
    coinMachine.running = true
    saved.balance = coinMachine.client.client.balance
    coinMachine.client.client.balance = 100 // the cash really inserted in the session: the pay routes check it
    coinMachine.middleware = { sendMachineActivation: async (m, iface, n) => { sent.push(m.name); impulses.push(n); if (coinMachine.__fail) throw new Error('controller offline') } }
    coinMachine.__fail = false
  })
  afterEach(() => {
    coinMachine.tenantId = saved.tenantId
    coinMachine.running = saved.running
    coinMachine.client.client.balance = saved.balance
    coinMachine.middleware = saved.middleware
    delete coinMachine.__fail
  })

  async function dryer() {
    const iface = await Interface.create({ tenantId: tenant._id, name: 'INT 5', address: 15, serialNumber: 'S15', status: 'active' })
    await Price.create({ tenantId: tenant._id, type: 'dry', weight: 18, cashPrice: 2, cardPrice: 1.8 })
    return Machine.create({ tenantId: tenant._id, name: 'Secar 7', type: 'dry', weight: 18, tImp: 15, interfaceId: iface._id, port: 1 })
  }

  it('default (spaced): 3 blocks = 3 SEPARATE one-impulse commands, the first at once, the others right after', async () => {
    const m = await dryer()
    const res = await request(app).post('/api/gateways/cash/pay').set('Authorization', `Bearer ${kioskToken}`)
      .send({ items: [{ _id: m._id, quantity: 3 }], inserted: 10, batchId: 'b-spaced' })
    expect(res.status).to.equal(200)
    expect(impulses[0]).to.equal(1) // the first impulse is in before the answer; the rest follow in the background
    await new Promise((r) => setTimeout(r, 250))
    expect(impulses).to.deep.equal([1, 1, 1])
    expect(sent).to.deep.equal(['Secar 7', 'Secar 7', 'Secar 7'])
    const after = await Machine.findById(m._id)
    expect(after.pendingImpulses).to.equal(0)
    expect(after.busyUntil).to.be.instanceOf(Date)
  })

  it('the same batch is paid once: a repeated request is answered, with no new sale, impulse or change', async () => {
    const m = await dryer()
    const pay = () => request(app).post('/api/gateways/cash/pay').set('Authorization', `Bearer ${kioskToken}`)
      .send({ items: [{ _id: m._id, quantity: 1 }], inserted: 10, batchId: 'b-twice' })
    const first = await pay()
    expect(first.status).to.equal(200)
    await new Promise((r) => setTimeout(r, 100))
    const sentBefore = impulses.length
    const second = await pay()
    expect(second.status).to.equal(200)
    expect(second.body.replayed).to.equal(true)
    await new Promise((r) => setTimeout(r, 100))
    expect(await Sale.countDocuments({ batchId: 'b-twice' })).to.equal(1)
    expect(impulses.length).to.equal(sentBefore)
  })

  it('blocksFor: dryers only, whole numbers, capped', () => {
    expect(coinMachine.blocksFor({ type: 'dry' }, { quantity: 3 })).to.equal(3)
    expect(coinMachine.blocksFor({ type: 'dry' }, { quantity: 99 })).to.equal(coinMachine.maxBlocks)
    expect(coinMachine.blocksFor({ type: 'dry' }, { quantity: 0 })).to.equal(1)
    expect(coinMachine.blocksFor({ type: 'dry' }, { quantity: 2.7 })).to.equal(2)
    expect(coinMachine.blocksFor({ type: 'wash' }, { quantity: 5 })).to.equal(1)
  })

  it('cash (batch mode): 3 blocks cost 3 x the price and go to the machine as ONE command with 3 impulses', async () => {
    process.env.DRYER_IMPULSE_MODE = 'batch'
    const m = await dryer()
    const res = await request(app).post('/api/gateways/cash/pay').set('Authorization', `Bearer ${kioskToken}`)
      .send({ items: [{ _id: m._id, quantity: 3 }], inserted: 10, batchId: 'b-dry' })
    expect(res.status).to.equal(200)
    expect(res.body.total).to.equal(6)
    expect(res.body.change).to.equal(4)
    expect(sent).to.deep.equal(['Secar 7'])
    expect(impulses).to.deep.equal([3])
    const after = await Machine.findById(m._id)
    expect(after.pendingImpulses).to.equal(0)
    expect(after.nextImpulseAt).to.equal(null)
    expect(after.busyUntil).to.be.instanceOf(Date) // the clock still holds it for 3 x 15 min
    const sale = await Sale.findOne({ batchId: 'b-dry' })
    expect(sale.amount).to.equal(6)
  })

  it('staggered mode: one impulse now and one more per block', async () => {
    process.env.DRYER_IMPULSE_MODE = 'staggered'
    const m = await dryer()
    await coinMachine.startPaidMachine(m._id, 3)
    expect(impulses).to.deep.equal([1])
    const cur = await Machine.findById(m._id)
    expect(cur.pendingImpulses).to.equal(2)
    expect(cur.nextImpulseAt).to.be.instanceOf(Date)
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

  describe('time block when the signal never shows the machine running', () => {
    const idle = (m) => ({ interfaceId: m.interfaceId, port: m.port, status: { fault: false, occupied: false, doorLocked: false, doorClosed: true } })
    const busy = (m) => ({ interfaceId: m.interfaceId, port: m.port, status: { fault: false, occupied: true, doorLocked: false, doorClosed: true } })

    it('a paid start sets the paid time; idle readings do not free it before then', async () => {
      const m = await dryer()
      await coinMachine.startPaidMachine(m._id, 2)
      let cur = await Machine.findById(m._id)
      expect(cur.busyUntil.getTime()).to.be.within(Date.now() + 29 * 60_000, Date.now() + 31 * 60_000) // 2 x 15 min
      expect(cur.sawBusy).to.equal(false)
      await Machine.updateOne({ _id: m._id }, { status: 'working' })
      for (let i = 0; i < 6; i++) await coinMachine.handleMachineStatusUpdate(idle(cur))
      cur = await Machine.findById(m._id)
      expect(cur.status).to.equal('working') // held by the clock
    })

    it('the clock frees it when the paid time is over and no signal ever said running', async () => {
      const m = await dryer()
      await Machine.updateOne({ _id: m._id }, { status: 'working', busyUntil: new Date(Date.now() - 1000), sawBusy: false, pendingImpulses: 0 })
      await coinMachine.tickImpulses()
      const cur = await Machine.findById(m._id)
      expect(cur.status).to.equal('free')
      expect(cur.busyUntil).to.equal(null)
    })

    it('when the line DID show it running, the signal decides (freed after the idle readings)', async () => {
      const m = await dryer()
      await coinMachine.startPaidMachine(m._id, 1)
      await Machine.updateOne({ _id: m._id }, { status: 'working' })
      let cur = await Machine.findById(m._id)
      await coinMachine.handleMachineStatusUpdate(busy(cur)) // the line goes busy: signal works
      cur = await Machine.findById(m._id)
      expect(cur.sawBusy).to.equal(true)
      for (let i = 0; i < 4; i++) await coinMachine.handleMachineStatusUpdate(idle(cur))
      cur = await Machine.findById(m._id)
      expect(cur.status).to.equal('free')
    })

    it('a washer is held for its price duration', async () => {
      const iface = await Interface.create({ tenantId: tenant._id, name: 'INT 1', address: 11, serialNumber: 'S11', status: 'active' })
      await Price.create({ tenantId: tenant._id, type: 'wash', weight: 8, cashPrice: 5, cardPrice: 4.5, duration: 40 })
      const w = await Machine.create({ tenantId: tenant._id, name: 'Lavar 6', type: 'wash', weight: 8, interfaceId: iface._id, port: 2 })
      await coinMachine.startPaidMachine(w._id, 1)
      const cur = await Machine.findById(w._id)
      expect(cur.busyUntil.getTime()).to.be.within(Date.now() + 39 * 60_000, Date.now() + 41 * 60_000)
    })
  })
})

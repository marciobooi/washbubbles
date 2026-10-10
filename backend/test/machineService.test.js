import { expect } from 'chai'
import request from 'supertest'
import {
  startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken,
} from './setup.test-helper.js'

describe('Machine out of service (admin Offline button)', function () {
  this.timeout(20000)
  let app, admin, kiosk, adminToken, kioskToken, Machine, Interface

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Machine = (await import('../src/models/machine.js')).default
    Interface = (await import('../src/models/interface.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ admin, kiosk } = await seedTenantAndUsers())
    adminToken = signToken(admin)
    kioskToken = signToken(kiosk)
  })

  it('sending only the status keeps the machine\'s interface, port, weight and polarity', async () => {
    const tenantId = admin.tenantId
    const iface = await Interface.create({ tenantId, name: 'INT 6', address: 16, serialNumber: 'SN-16' })
    const m = await Machine.create({ tenantId, name: 'Lavar 1', type: 'wash', weight: 8, interfaceId: iface._id, port: 1, activation: 'low' })

    const res = await request(app).put(`/api/admin/machines/${m._id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'offline', statusText: 'Offline' })
    expect(res.status).to.equal(200)

    const after = await Machine.findById(m._id)
    expect(after.status).to.equal('offline')
    expect(after.outOfService).to.equal(true)
    expect(String(after.interfaceId)).to.equal(String(iface._id))
    expect(after.port).to.equal(1)
    expect(after.weight).to.equal(8)
    expect(after.activation).to.equal('low')

    await request(app).put(`/api/admin/machines/${m._id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'free', statusText: 'Livre' })
    const back = await Machine.findById(m._id)
    expect(back.outOfService).to.equal(false)
    expect(back.port).to.equal(1)
  })

  it('Avariada also takes it out of service and keeps the reason', async () => {
    const m = await Machine.create({ tenantId: admin.tenantId, name: 'Lavar 3', type: 'wash', weight: 8 })
    await request(app).put(`/api/admin/machines/${m._id}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'fault', statusText: 'Avariada' })
    const f = await Machine.findById(m._id)
    expect(f.outOfService).to.equal(true)
    expect(f.serviceStatus).to.equal('fault')
    await request(app).put(`/api/admin/machines/${m._id}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'free' })
    expect((await Machine.findById(m._id)).outOfService).to.equal(false)
  })

  it('the shop reports occupied / free to central, but never overrides an out-of-service set by the operator', async () => {
    const tenantId = admin.tenantId
    const a = await Machine.create({ tenantId, name: 'Lavar 4', type: 'wash', weight: 8 })
    const b = await Machine.create({ tenantId, name: 'Lavar 5', type: 'wash', weight: 8, status: 'offline', outOfService: true, serviceStatus: 'offline' })
    const res = await request(app).post('/api/sync/push/machine-status').set('Authorization', `Bearer ${kioskToken}`)
      .send({ machines: [{ id: String(a._id), status: 'working', statusText: 'Ocupado' }, { id: String(b._id), status: 'free', statusText: 'Livre' }, { id: 'nope', status: 'free' }] })
    expect(res.status).to.equal(200)
    expect(res.body.updated).to.equal(1)
    expect((await Machine.findById(a._id)).status).to.equal('working')
    expect((await Machine.findById(b._id)).status).to.equal('offline')
  })

  it('a change made on the central server asks the shop to pull at once, once at a time', async () => {
    const SyncCommand = (await import('../src/models/syncCommand.js')).default
    const m = await Machine.create({ tenantId: admin.tenantId, name: 'Lavar 6', type: 'wash', weight: 0 })
    for (const w of [8, 9]) {
      const r = await request(app).put(`/api/admin/machines/${m._id}`).set('Authorization', `Bearer ${adminToken}`).send({ weight: w })
      expect(r.status).to.equal(200)
    }
    await new Promise((r) => setTimeout(r, 150))
    expect((await Machine.findById(m._id)).weight).to.equal(9)
    const pending = await SyncCommand.find({ tenantId: admin.tenantId, type: 'sync_now', status: 'pending' })
    expect(pending).to.have.length(1)
  })

  it('a cash recharge credits the card (it used to record only a sale and leave the card alone)', async () => {
    const Card = (await import('../src/models/card.js')).default
    const Sale = (await import('../src/models/sale.js')).default
    await Card.create({ tenantId: admin.tenantId, code: 'CASH-RECH', balance: 4.7, status: 'active' })
    const res = await request(app).post('/api/gateways/cash/pay').set('Authorization', `Bearer ${kioskToken}`)
      .send({ items: [{ type: 'Recarga de Cartão', id: 'recharge-1', amount: 10 }], inserted: 10, batchId: 'b-rech', cardCode: 'CASH-RECH' })
    expect(res.status).to.equal(200)
    expect((await Card.findOne({ code: 'CASH-RECH' })).balance).to.equal(14.7)
    const sale = await Sale.findOne({ batchId: 'b-rech' })
    expect(sale.type).to.equal('recharge')
    expect(sale.cardCode).to.equal('CASH-RECH')
  })

  it('a cash recharge with no card refuses and takes nothing', async () => {
    const Sale = (await import('../src/models/sale.js')).default
    const res = await request(app).post('/api/gateways/cash/pay').set('Authorization', `Bearer ${kioskToken}`)
      .send({ items: [{ type: 'Recarga de Cartão', id: 'recharge-2', amount: 10 }], inserted: 10, batchId: 'b-none' })
    expect(res.status).to.equal(409)
    expect(await Sale.countDocuments({ batchId: 'b-none' })).to.equal(0)
  })
})

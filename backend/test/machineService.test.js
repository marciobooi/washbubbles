import { expect } from 'chai'
import request from 'supertest'
import {
  startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken,
} from './setup.test-helper.js'

describe('Machine out of service (admin Offline button)', function () {
  this.timeout(20000)
  let app, admin, adminToken, Machine, Interface

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Machine = (await import('../src/models/machine.js')).default
    Interface = (await import('../src/models/interface.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ admin } = await seedTenantAndUsers())
    adminToken = signToken(admin)
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
})

import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'

describe('Hopper reinforcement: coins from outside raise the hopper stock and are booked as float', function () {
  this.timeout(20000)
  let app, tenant, admin, kiosk, adminToken, Peripheral, DayClose
  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Peripheral = (await import('../src/models/peripheral.js')).default
    DayClose = (await import('../src/models/dayClose.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, admin, kiosk } = await seedTenantAndUsers())
    adminToken = signToken(admin)
    await Peripheral.create({ tenantId: tenant._id, name: 'Hopper 1', type: 'hopper', enabled: true, hopperConfig: { coinValue: 1, currentCount: 3 } })
  })

  it('adds the coins to the matching hopper and books the amount as float', async () => {
    const res = await request(app).post('/api/admin/hopper/refill').set('Authorization', `Bearer ${adminToken}`)
      .send({ coins: [{ value: 1, count: 10 }, { value: 0.5, count: 4 }], notes: 'acabaram as de 1' })
    expect(res.status).to.equal(200)
    const h = await Peripheral.findOne({ type: 'hopper' })
    expect(h.hopperConfig.currentCount).to.equal(13)
    expect(res.body.refilled).to.have.length(1)
    expect(res.body.noHopper).to.deep.equal([{ value: 0.5, count: 4 }]) // no hopper for 0.50: float only, reported
    const adj = await DayClose.findOne({ source: 'adjustment' })
    expect(adj.metadata.adjustmentAmount).to.equal(12)
    expect(adj.notes).to.contain('Reforço do hopper')
  })

  it('refuses an empty reinforcement and a kiosk call without the staff PIN', async () => {
    const empty = await request(app).post('/api/admin/hopper/refill').set('Authorization', `Bearer ${adminToken}`).send({ coins: [] })
    expect(empty.status).to.equal(400)
    const k = await request(app).post('/api/pos/hopper/refill').set('Authorization', `ApiKey ${kiosk.apiKey}`).send({ coins: [{ value: 1, count: 5 }] })
    expect(k.status).to.be.oneOf([400, 401, 403, 409])
    const h = await Peripheral.findOne({ type: 'hopper' })
    expect(h.hopperConfig.currentCount).to.equal(3) // untouched
  })
})

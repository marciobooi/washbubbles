import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'

describe('Machines list: cycles', function () {
  this.timeout(20000)
  let app, tenant, admin
  before(async () => { await startTestDb(); app = await buildTestApp() })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); ({ tenant, admin } = await seedTenantAndUsers()) })

  it('counts the paid cycles of each machine (not refunded ones, not the staff\'s own starts)', async () => {
    const Machine = (await import('../src/models/machine.js')).default
    const Sale = (await import('../src/models/sale.js')).default
    const m1 = await Machine.create({ tenantId: tenant._id, name: 'Secar 8', number: 8, type: 'dry', weight: 18, port: 1, status: 'free' })
    const m2 = await Machine.create({ tenantId: tenant._id, name: 'Lavar 1', number: 1, type: 'wash', weight: 20, port: 2, status: 'free' })
    const S = (o) => Sale.create({ tenantId: tenant._id, batchId: 'b' + Math.random(), amount: 2, method: 'cash', type: 'payment', ...o })
    await S({ machineId: m1._id }); await S({ machineId: m1._id }); await S({ machineId: m1._id, status: 'refunded' })
    await S({ machineId: m1._id, type: 'admin_start', amount: 0 })
    const res = await request(app).get('/api/admin/machines').set('Authorization', `Bearer ${signToken(admin)}`)
    expect(res.status).to.equal(200)
    const by = Object.fromEntries(res.body.map((m) => [m.name, m.cycle]))
    expect(by['Secar 8']).to.equal(2)
    expect(by['Lavar 1']).to.equal(0)
  })
})

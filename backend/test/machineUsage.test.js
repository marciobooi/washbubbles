import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { backfillSaleMachines } from '../src/services/saleMachines.js'

// 2026-11-10: "Utilização das máquinas" showed 8 machines with 14 cycles: the sales reached the central server without their machine.
describe('Machine usage: every machine, and sales that lost their machine get it back', function () {
  this.timeout(20000)
  let app, tenant, admin, Machine, Sale, l1, l2, s9
  const get = async () => (await request(app).get('/api/admin/analytics/machines').set({ Authorization: `Bearer ${signToken(admin)}` })).body
  const sale = (extra) => Sale.create({ tenantId: tenant._id, amount: 3, method: 'cash', type: 'payment', ...extra })

  before(async () => { await startTestDb(); app = await buildTestApp(); Machine = (await import('../src/models/machine.js')).default; Sale = (await import('../src/models/sale.js')).default })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, admin } = await seedTenantAndUsers())
    ;[l1, l2, s9] = await Machine.create([{ tenantId: tenant._id, name: 'Lavar 1', type: 'wash' }, { tenantId: tenant._id, name: 'Lavar 2', type: 'wash' }, { tenantId: tenant._id, name: 'Secar 9', type: 'dry' }])
  })

  it('recovers the machine from the sale line (by id, else by an unambiguous name) and leaves the rest alone', async () => {
    const byId = await sale({ items: [{ productId: String(l1._id), name: 'whatever' }] })
    const byName = await sale({ items: [{ name: 'Secar 9' }] })
    const unknown = await sale({ items: [{ name: 'Lavar 77' }] })
    const noLine = await sale({ items: [] })
    const has = await sale({ machineId: l2._id, items: [{ productId: String(l1._id) }] }) // already has one: never changed
    expect(await backfillSaleMachines()).to.equal(2)
    expect(String((await Sale.findById(byId._id)).machineId)).to.equal(String(l1._id))
    expect(String((await Sale.findById(byName._id)).machineId)).to.equal(String(s9._id))
    expect((await Sale.findById(unknown._id)).machineId ?? null).to.equal(null)
    expect((await Sale.findById(noLine._id)).machineId ?? null).to.equal(null)
    expect(String((await Sale.findById(has._id)).machineId)).to.equal(String(l2._id))
    expect(await backfillSaleMachines()).to.equal(0) // again: nothing to do
  })

  it('a name two machines share is never guessed', async () => {
    await Machine.create({ tenantId: tenant._id, name: 'Lavar 1', type: 'wash' })
    const s = await sale({ items: [{ name: 'Lavar 1' }] })
    expect(await backfillSaleMachines()).to.equal(0)
    expect((await Sale.findById(s._id)).machineId ?? null).to.equal(null)
  })

  it('lists every machine (an unused one with 0), counting only paid, not refunded, machine payments', async () => {
    await sale({ machineId: l1._id, amount: 7 })
    await sale({ machineId: l1._id, amount: 3, method: 'card' })
    await sale({ machineId: l1._id, amount: 9, status: 'refunded' })
    await sale({ machineId: l1._id, amount: 0, type: 'admin_start' })
    await sale({ machineId: s9._id, amount: 2 })
    const rows = await get()
    const by = Object.fromEntries(rows.map((r) => [r.machineInfo.name, r]))
    expect(Object.keys(by).sort()).to.deep.equal(['Lavar 1', 'Lavar 2', 'Secar 9'])
    expect(by['Lavar 1']).to.include({ usageCount: 2, totalRevenue: 10 })
    expect(by['Secar 9']).to.include({ usageCount: 1, totalRevenue: 2 })
    expect(by['Lavar 2']).to.include({ usageCount: 0, totalRevenue: 0 })
    expect(rows[0].machineInfo.name).to.equal('Lavar 1') // used ones first, by revenue
  })
})

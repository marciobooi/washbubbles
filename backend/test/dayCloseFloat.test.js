import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'

// 2026-11-08: a hopper reinforcement ("Fundo adicionado +56.50") swept 48 days and 534 sales into one record that said "Balanceado"
// although nobody had counted, and made the whole 2182.40 EUR the new starting float. A float top-up must not close anything.
describe('A float top-up is not a close', function () {
  this.timeout(20000)
  let app, tenant, admin, DayClose, Sale
  const auth = () => ({ Authorization: `Bearer ${signToken(admin)}` })
  const day = (n) => new Date(Date.now() - n * 24 * 3600e3)
  const summary = async () => (await request(app).get('/api/admin/day-close/summary').set(auth())).body

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    DayClose = (await import('../src/models/dayClose.js')).default
    Sale = (await import('../src/models/sale.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, admin } = await seedTenantAndUsers())
    // the last REAL close, 10 days ago, which left 120 in the till
    await DayClose.create({ tenantId: tenant._id, source: 'dashboard', periodFrom: day(20), periodTo: day(10), createdAt: day(10), openingFloat: 120, expectedCash: 120, countedCash: 120, floatLeft: 120, amountToBank: 0 })
    await Sale.create({ tenantId: tenant._id, amount: 40, method: 'cash', type: 'payment', items: [{}], createdAt: day(5) })
    await Sale.create({ tenantId: tenant._id, amount: 25.9, method: 'cash', type: 'payment', items: [{}], createdAt: day(2) })
  })

  it('adds the cash to the float, leaves the sales open, and the next count expects float + sales + top-up', async () => {
    const r = await request(app).post('/api/admin/day-close/adjust-float').set(auth()).send({ amount: 56.5, notes: 'Reforço do hopper' })
    expect(r.status).to.equal(200)
    // the record is about the float only: no sales swept in, nothing "balanced" by a count nobody made
    expect(r.body).to.include({ source: 'adjustment', salesCount: 0, totalCash: 0, expectedCash: 176.5, floatLeft: 176.5 })
    expect(await Sale.countDocuments({ dayCloseId: { $ne: null } })).to.equal(0)
    const s = await summary()
    expect(s.openingFloat).to.equal(120) // still the last REAL close's float
    expect(s.floatAdded).to.equal(56.5)
    expect(s.totalCash).to.equal(65.9)
    expect(s.salesCount).to.equal(2)
    expect(s.expectedCash).to.equal(242.4) // 120 + 65.9 + 56.5
    const last = await DayClose.findOne({ source: 'dashboard' })
    expect(new Date(s.periodFrom).getTime()).to.equal(last.periodTo.getTime()) // the period still starts at the last real close
  })

  it('several top-ups add up, and a real close counts them once, then starts again from its own float', async () => {
    await request(app).post('/api/admin/day-close/adjust-float').set(auth()).send({ amount: 56.5 })
    const second = await request(app).post('/api/admin/day-close/adjust-float').set(auth()).send({ amount: 55.5 })
    expect(second.body.expectedCash).to.equal(232) // 120 + 56.5 + 55.5: the float, not the sales
    expect((await summary()).floatAdded).to.equal(112)
    // the real count: 120 + 65.9 + 112 = 297.9 expected; they find 250.9 (47 taken out and never written down)
    const close = await request(app).post('/api/admin/day-close').set(auth()).send({ amountToBank: 130.9, floatLeft: 120, countedCash: 250.9 })
    expect(close.status).to.equal(200)
    expect(close.body).to.include({ source: 'dashboard', openingFloat: 120, floatAdded: 112, expectedCash: 297.9, countedCash: 250.9, discrepancy: -47 })
    const after = await summary()
    expect(after.openingFloat).to.equal(120)
    expect(after.floatAdded).to.equal(0)
    expect(after.totalCash).to.equal(0)
    expect(after.expectedCash).to.equal(120)
  })

  describe('cash taken out of the machine between closes', () => {
    const withdraw = (body) => request(app).post('/api/admin/day-close/withdraw').set(auth()).send(body)

    it('lowers what the next count expects, sweeps no sale, and the real close then starts again from its float', async () => {
      await request(app).post('/api/admin/day-close/adjust-float').set(auth()).send({ amount: 56.5 })
      expect((await summary()).expectedCash).to.equal(242.4) // 120 + 65.9 + 56.5
      const w = await withdraw({ amount: 100, notes: 'para o banco' })
      expect(w.status).to.equal(200)
      expect(w.body.metadata).to.include({ withdrawalAmount: 100, expectedBefore: 242.4 })
      expect(w.body).to.include({ source: 'adjustment', expectedCash: 142.4, salesCount: 0 })
      expect(w.body.notes).to.contain('Levantamento: -100.00')
      expect(await Sale.countDocuments({ dayCloseId: { $ne: null } })).to.equal(0)
      const s = await summary()
      expect(s).to.include({ openingFloat: 120, floatAdded: 56.5, floatWithdrawn: 100, totalCash: 65.9, expectedCash: 142.4 })
      // the count finds exactly that: balanced; and the next period starts from the float left, with nothing carried over
      const close = await request(app).post('/api/admin/day-close').set(auth()).send({ amountToBank: 22.4, floatLeft: 120, countedCash: 142.4 })
      expect(close.body).to.include({ expectedCash: 142.4, discrepancy: 0, floatAdded: 56.5, floatWithdrawn: 100 })
      const after = await summary()
      expect(after).to.include({ openingFloat: 120, floatAdded: 0, floatWithdrawn: 0, totalCash: 0, expectedCash: 120 })
    })

    it('refuses to take out more than the machine is expected to hold, and a bad amount', async () => {
      const tooMuch = await withdraw({ amount: 500 })
      expect(tooMuch.status).to.equal(409)
      expect(tooMuch.body.expectedCash).to.equal(185.9) // 120 + 65.9
      expect((await withdraw({ amount: 0 })).status).to.equal(400)
      expect((await withdraw({ amount: 'x' })).status).to.equal(400)
      expect((await summary()).floatWithdrawn).to.equal(0)
    })

    it('from the kiosk it needs the staff PIN', async () => {
      const { hashPin } = await import('../src/services/staffPin.js')
      const Setting = (await import('../src/models/setting.js')).default
      await Setting.create({ tenantId: tenant._id, key: 'adminPin', value: await hashPin('4821') })
      await Setting.create({ tenantId: tenant._id, key: 'adminPin.setAt', value: new Date().toISOString() })
      const kiosk = (await import('../src/models/user.js')).default
      const k = await kiosk.findOne({ tenantId: tenant._id, role: 'KIOSK' })
      const post = (body) => request(app).post('/api/pos/day-close/withdraw').set({ Authorization: `ApiKey ${k.apiKey}` }).send(body)
      expect((await post({ amount: 10 })).status).to.equal(400) // no PIN
      expect((await post({ amount: 10, pin: '0000' })).status).to.equal(401)
      expect((await post({ amount: 10, pin: '4821' })).status).to.equal(200)
      expect((await summary()).floatWithdrawn).to.equal(10)
    })
  })
})

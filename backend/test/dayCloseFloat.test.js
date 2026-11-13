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

    it('exchange, put-back and empty from the kiosk also need the staff PIN', async () => {
      const { hashPin } = await import('../src/services/staffPin.js')
      const Setting = (await import('../src/models/setting.js')).default
      await Setting.create({ tenantId: tenant._id, key: 'adminPin', value: await hashPin('4821') })
      await Setting.create({ tenantId: tenant._id, key: 'adminPin.setAt', value: new Date().toISOString() })
      const User = (await import('../src/models/user.js')).default
      const k = await User.findOne({ tenantId: tenant._id, role: 'KIOSK' })
      const post = (path, body) => request(app).post(`/api/pos${path}`).set({ Authorization: `ApiKey ${k.apiKey}` }).send(body)
      const ex = { notesOut: [{ value: 10, count: 1 }], coinsIn: [{ value: 1, count: 10 }] }
      expect((await post('/day-close/exchange', ex)).status).to.equal(400)                       // no PIN
      expect((await post('/day-close/exchange', { ...ex, pin: '0000' })).status).to.equal(401)   // wrong PIN
      expect((await post('/day-close/exchange', { ...ex, pin: '4821' })).status).to.equal(200)
      expect((await post('/hopper/restore', { coins: [{ value: 2, count: 3 }] })).status).to.equal(400)
      expect((await post('/hopper/restore', { coins: [{ value: 2, count: 3 }], pin: '4821' })).status).to.equal(200)
      expect((await post('/hopper/empty', { confirm: true })).status).to.equal(400)              // no PIN: nothing comes out
      expect((await post('/hopper/empty', { pin: '4821' })).status).to.equal(400)                // PIN but no confirmation
    })
  })
})

describe('The last count of coins in the hopper comes back on the hopper screen', function () {
  this.timeout(20000)
  let app, tenant, admin, DayClose
  const auth = () => ({ Authorization: `Bearer ${signToken(admin)}` })
  before(async () => { await startTestDb(); app = await buildTestApp(); DayClose = (await import('../src/models/dayClose.js')).default })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); ;({ tenant, admin } = await seedTenantAndUsers()) })

  it('is the coins put in with the last float top-up (or the hopper count of a close), with the change given since', async () => {
    expect((await request(app).get('/api/admin/day-close/summary').set(auth())).body.lastHopperCount).to.equal(null)
    const add = await request(app).post('/api/admin/day-close/adjust-float').set(auth()).send({ denominations: [{ value: 0.1, count: 67 }, { value: 2, count: 13 }, { value: 10, count: 1 }] })
    expect(add.status).to.equal(200)
    const Sale = (await import('../src/models/sale.js')).default
    await Sale.create({ tenantId: tenant._id, amount: 4, method: 'cash', type: 'payment', change: 6, items: [{}] })
    const h = (await request(app).get('/api/admin/day-close/summary').set(auth())).body.lastHopperCount
    expect(h.source).to.equal('topup')
    expect(h.coins).to.deep.equal([{ value: 0.1, count: 67 }, { value: 2, count: 13 }]) // coins only: the note is not in the hopper
    expect(h.total).to.equal(32.7)
    expect(h.changeGivenSince).to.equal(6)
    // a close that counted the hopper takes over
    await request(app).post('/api/admin/day-close').set(auth()).send({ amountToBank: 0, floatLeft: 0, countedCash: 0, hopperActualBefore: [{ value: 1, count: 20 }] })
    const after = (await request(app).get('/api/admin/day-close/summary').set(auth())).body.lastHopperCount
    expect(after).to.include({ source: 'close', total: 20 })
  })

  it('"Repor" puts the same coins back into the hopper: the count shows, the money does not move', async () => {
    await request(app).post('/api/admin/day-close').set(auth()).send({ amountToBank: 0, floatLeft: 0, countedCash: 0, hopperActualBefore: [{ value: 1, count: 20 }] })
    const sum = async () => (await request(app).get('/api/admin/day-close/summary').set(auth())).body
    const before = await sum()
    const DayClose = (await import('../src/models/dayClose.js')).default
    const records = await DayClose.countDocuments()

    expect((await request(app).post('/api/admin/hopper/restore').set(auth()).send({ coins: [] })).status).to.equal(400)
    const r = await request(app).post('/api/admin/hopper/restore').set(auth()).send({ coins: [{ value: 2, count: 36 }, { value: 1, count: 21 }, { value: 0.5, count: 15 }, { value: 0.2, count: 53 }, { value: 0.1, count: 41 }] })
    expect(r.status).to.equal(200)
    expect(r.body.restored.total).to.equal(115.2)

    const after = await sum()
    expect(after.lastHopperCount).to.include({ source: 'restore', total: 115.2 })      // the screen opens with it, newer than the close's count
    expect(after.lastHopperCount.coins).to.have.length(5)
    expect(after.expectedCash).to.equal(before.expectedCash)                            // not a reinforcement: no money moved
    expect(after.floatAdded || 0).to.equal(before.floatAdded || 0)
    expect(await DayClose.countDocuments()).to.equal(records)                           // and no cash record was created
  })
})

describe('An annulled record is left out of every calculation', function () {
  this.timeout(20000)
  let app, tenant, admin, DayClose
  const auth = () => ({ Authorization: `Bearer ${signToken(admin)}` })
  before(async () => { await startTestDb(); app = await buildTestApp(); DayClose = (await import('../src/models/dayClose.js')).default })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); ;({ tenant, admin } = await seedTenantAndUsers()) })

  it('an annulled close is not the baseline, an annulled top-up is not expected in the count, and both stay in the history', async () => {
    const mk = (extra) => DayClose.create({ tenantId: tenant._id, periodFrom: new Date(), periodTo: new Date(), ...extra })
    const real = await mk({ source: 'dashboard', openingFloat: 0, expectedCash: 120, countedCash: 120, floatLeft: 120, createdAt: new Date(Date.now() - 3 * 3600e3), periodTo: new Date(Date.now() - 3 * 3600e3) })
    const test = await mk({ source: 'dashboard', openingFloat: 120, expectedCash: 500, countedCash: 6.7, floatLeft: 0, discrepancy: -493.3, createdAt: new Date(Date.now() - 2 * 3600e3), periodTo: new Date(Date.now() - 2 * 3600e3) })
    const topUp = await mk({ source: 'adjustment', metadata: { adjustmentAmount: 93.7 }, createdAt: new Date(Date.now() - 3600e3) })
    let s = (await request(app).get('/api/admin/day-close/summary').set(auth())).body
    expect(s).to.include({ openingFloat: 0, floatAdded: 93.7 }) // the test close is the baseline now
    await DayClose.updateMany({ _id: { $in: [test._id, topUp._id] } }, { $set: { voided: true, voidedReason: 'teste' } })
    s = (await request(app).get('/api/admin/day-close/summary').set(auth())).body
    expect(s).to.include({ openingFloat: 120, floatAdded: 0 }) // back to the real close
    const history = (await request(app).get('/api/admin/day-close').set(auth())).body
    expect(history.filter((d) => d.voided)).to.have.length(2) // still listed
    expect(real.voided).to.equal(false)
  })
})

describe('The coins of the bank deposit come out of the hopper like change', function () {
  this.timeout(20000)
  let app, tenant, admin, Sale, coinMachine, saved
  const auth = () => ({ Authorization: `Bearer ${signToken(admin)}` })
  before(async () => { await startTestDb(); app = await buildTestApp(); Sale = (await import('../src/models/sale.js')).default; coinMachine = (await import('../src/services/coinMachine.js')).default })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb(); ;({ tenant, admin } = await seedTenantAndUsers())
    saved = { running: coinMachine.running, tenantId: coinMachine.tenantId, pay: coinMachine.payOutCash, state: { ...coinMachine.client.client } }
    coinMachine.running = true; coinMachine.tenantId = tenant._id
    coinMachine.client.client.balance = 0; coinMachine.client.client.hasCard = false
    await Sale.create({ tenantId: tenant._id, amount: 68.5, method: 'cash', type: 'payment', items: [{}] })
  })
  afterEach(() => { coinMachine.running = saved.running; coinMachine.tenantId = saved.tenantId; coinMachine.payOutCash = saved.pay; Object.assign(coinMachine.client.client, saved.state) })
  const pay = (amount) => request(app).post('/api/admin/day-close/payout-coins').set(auth()).send({ amount })

  it('pays only what the customers put in, never while somebody uses the kiosk, and answers what the hopper really paid', async () => {
    const asked = []
    coinMachine.payOutCash = async (amt, opts) => { asked.push([amt, opts.reason]); return { success: false, dispensed: 6, remaining: amt - 6, error: 'moedas de 2 acabaram' } }
    const ok = await pay(8.5)
    expect(ok.status, JSON.stringify(ok.body)).to.equal(200)
    expect(ok.body).to.include({ dispensed: 6 })
    expect(asked).to.deep.equal([[8.5, 'bank']])
    expect((await pay(500)).status).to.equal(400) // more than a payout may be
    expect((await pay(0)).status).to.equal(400)
    expect((await pay(70)).status).to.equal(409) // more than the customers' cash (68.50)
    coinMachine.client.client.balance = 2 // a customer has credit
    expect((await pay(8.5)).body.code).to.equal('kiosk-in-use')
    expect(asked).to.have.length(1) // nothing was asked of the hopper in the refused cases
    coinMachine.client.client.balance = 0; coinMachine.client.client.hasCard = true // a card in the reader
    expect((await pay(8.5)).status).to.equal(409)
  })

  it('the close stores how the deposit was made up', async () => {
    const r = await request(app).post('/api/admin/day-close').set(auth()).send({
      amountToBank: 68.5, floatLeft: 93.7, countedCash: 162.2, bankBreakdown: { notes: [{ value: 20, count: 1 }, { value: 10, count: 4 }], coins: 8.5, coinsAsked: 8.5 },
    })
    expect(r.status, JSON.stringify(r.body)).to.equal(200)
    expect(r.body.metadata.bank).to.deep.include({ coins: 8.5, coinsAsked: 8.5 })
    expect(r.body.metadata.bank.notes.map((n) => [n.value, n.count])).to.deep.equal([[20, 1], [10, 4]])
  })
})

describe('Notes exchanged for coins', function () {
  this.timeout(20000)
  let app, tenant, admin, Setting, DayClose
  const auth = () => ({ Authorization: `Bearer ${signToken(admin)}` })
  before(async () => { await startTestDb(); app = await buildTestApp(); Setting = (await import('../src/models/setting.js')).default; DayClose = (await import('../src/models/dayClose.js')).default })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb(); ;({ tenant, admin } = await seedTenantAndUsers())
    await Setting.create({ tenantId: tenant._id, key: 'cashDrawerLedger', value: [{ value: 0.1, count: 40 }, { value: 2, count: 5 }, { value: 5, count: 4 }, { value: 10, count: 18 }, { value: 20, count: 3 }] })
  })
  const summary = async () => (await request(app).get('/api/admin/day-close/summary').set(auth())).body
  const count = (sum, v) => sum.acceptedDenominations.find((d) => Math.abs(d.value - v) < 0.001).count
  const exchange = (b) => request(app).post('/api/admin/day-close/exchange').set(auth()).send(b)

  it('the notes that left are no longer in the box and the coins that came in are; the money does not move', async () => {
    const before = await summary()
    const bad = await exchange({ notesOut: [{ value: 20, count: 2 }], coinsIn: [{ value: 2, count: 10 }] }) // 40 vs 20
    expect(bad.status).to.equal(400)
    expect((await exchange({ notesOut: [], coinsIn: [{ value: 2, count: 1 }] })).status).to.equal(400)
    const ok = await exchange({ notesOut: [{ value: 20, count: 2 }, { value: 10, count: 1 }], coinsIn: [{ value: 2, count: 25 }] }) // 50 = 50
    expect(ok.status, JSON.stringify(ok.body)).to.equal(200)

    const after = await summary()
    expect(count(after, 20)).to.equal(1); expect(count(after, 10)).to.equal(17); expect(count(after, 2)).to.equal(30)
    expect(after.acceptedTotal).to.equal(before.acceptedTotal)          // the box holds the same money, in other kinds
    expect(after.expectedCash).to.equal(before.expectedCash)            // and nothing was added or taken
    expect(after.floatAdded || 0).to.equal(before.floatAdded || 0)
    expect(after.floatWithdrawn || 0).to.equal(before.floatWithdrawn || 0)

    // annulled: as if it never happened, still listed
    await DayClose.updateMany({ 'metadata.exchange': { $exists: true } }, { $set: { voided: true } })
    const undone = await summary()
    expect(count(undone, 20)).to.equal(3); expect(count(undone, 2)).to.equal(5)
  })
})

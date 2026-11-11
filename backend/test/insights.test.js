import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { computeInsights, periodComparison, lisbon } from '../src/services/insights.js'

describe('Owner insights', function () {
  this.timeout(20000)
  let app, tenant, admin, Machine, Sale, Card, Price, wash, dry
  const NOW = new Date('2026-11-11T14:00:00Z') // a Wednesday, 14:00 in Lisbon (winter: UTC+0)
  const at = (iso) => new Date(iso)
  const sale = (extra) => Sale.create({ tenantId: tenant._id, amount: 3, method: 'cash', type: 'payment', items: [{ quantity: 1 }], ...extra })

  before(async () => {
    await startTestDb(); app = await buildTestApp()
    ;[Machine, Sale, Card, Price] = await Promise.all(['machine', 'sale', 'card', 'price'].map(async (m) => (await import(`../src/models/${m}.js`)).default))
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, admin } = await seedTenantAndUsers())
    await Price.create({ tenantId: tenant._id, type: 'wash', weight: 8, cashPrice: 5, cardPrice: 5, duration: 60 })
    ;[wash, dry] = await Machine.create([{ tenantId: tenant._id, name: 'Lavar 1', type: 'wash', weight: 8 }, { tenantId: tenant._id, name: 'Secar 7', type: 'dry', weight: 18, tImp: 15 }])
  })

  it('compares this week and this month with the same stretch of the previous one', () => {
    const byDay = new Map([['2026-11-09', 10], ['2026-11-10', 20], ['2026-11-11', 30], ['2026-11-02', 5], ['2026-11-03', 5], ['2026-11-04', 5], ['2026-11-05', 50], ['2026-10-01', 7], ['2026-10-31', 3]])
    const c = periodComparison(byDay, '2026-11-11')
    expect(c.week).to.include({ current: 60, previous: 15, previousFull: 65, deltaPct: 300 }) // Mon-Wed against last Mon-Wed
    expect(c.month).to.include({ current: 60 + 65, previous: 7 + 0, deltaPct: null === 0 ? 0 : Math.round(((125) / 7 - 1) * 100) })
    expect(c.weekStart).to.equal('2026-11-09')
    // a shop that started on 19 October has no complete October: no percentage for the month, but the week still compares
    const young = periodComparison(byDay, '2026-11-11', '2026-10-19')
    expect(young.month).to.include({ partial: true, deltaPct: null })
    expect(young.week).to.include({ partial: false, deltaPct: 300 })
  })

  it('knows the shop clock (summer time) and the ISO weekday', () => {
    expect(lisbon(at('2026-07-01T22:30:00Z'))).to.include({ day: '2026-07-01', hour: 23, dow: 3 })
    expect(lisbon(at('2026-07-01T23:30:00Z'))).to.include({ day: '2026-07-02', hour: 0, dow: 4 })
  })

  it('cards money, ticket, machines, wash/dry, customers and hours, from the sales', async () => {
    await Card.create([
      { tenantId: tenant._id, code: 'A', balance: 10, status: 'active', createdAt: at('2026-08-01T10:00:00Z') }, // holds money, idle for months
      { tenantId: tenant._id, code: 'B', balance: 6, status: 'active', createdAt: at('2026-10-01T10:00:00Z') },
      { tenantId: tenant._id, code: 'C', balance: 99, status: 'blocked' }, { tenantId: tenant._id, code: 'D', balance: 0, status: 'active' },
    ])
    // Wednesday 11/11: a 1-wash visit paid in cash 12:00 (one batch with a dryer paid by card B), one more at 13:00
    await sale({ machineId: wash._id, amount: 5, batchId: 'v1', createdAt: at('2026-11-11T12:00:00Z') })
    await sale({ machineId: dry._id, amount: 2, method: 'card', cardCode: 'B', batchId: 'v1', createdAt: at('2026-11-11T12:05:00Z'), items: [{ quantity: 2 }] }) // 2 blocks = 30 min
    await sale({ machineId: wash._id, amount: 6, method: 'mbway', batchId: 'v2', createdAt: at('2026-11-11T13:00:00Z') })
    await sale({ type: 'recharge', amount: 20, cardCode: 'B', createdAt: at('2026-11-11T09:00:00Z') }) // revenue (cash) but no cycle
    await sale({ machineId: wash._id, amount: 9, status: 'refunded', createdAt: at('2026-11-11T10:00:00Z') }) // never counted
    await sale({ type: 'card_purchase', amount: 10, createdAt: at('2026-11-05T10:00:00Z') })
    const r = await computeInsights(tenant._id, { now: NOW })
    expect(r.cardsLiability).to.deep.include({ total: 16, cards: 2 })
    expect(r.cardsLiability.idle).to.include({ cards: 1, amount: 10 }) // A: nothing for more than 60 days
    expect(r.revenue.week.current).to.equal(31) // 5 + 6 + 20 recharge; the card payment is not revenue
    expect(r.ticket).to.include({ cycles: 3, visits: 2, perVisit: 6.5, perCycle: 4.33 }) // 13 spent on machines over 2 visits
    const by = Object.fromEntries(r.machines.map((m) => [m.name, m]))
    expect(by['Lavar 1']).to.include({ cycles: 2, revenue: 11 })
    expect(by['Secar 7']).to.include({ cycles: 1, revenue: 2, daysSinceUse: 0 })
    expect(r.washDry.cyclesSharePct).to.deep.equal({ wash: 67, dry: 33 })
    expect(r.washDry.dry.cycles).to.equal(1)
    // hours: cycles at 12h (2) and 13h (1); the 12:00 wash runs 60 min, the dryer 30 min from 12:05 -> 12h is busy 60+30 minutes of 2 machines
    expect(r.hours.hourly[12].cycles).to.equal(2)
    expect(r.hours.hourly[13].cycles).to.equal(1)
    expect(r.hours.hourly[12].occupancyPct).to.be.greaterThan(r.hours.hourly[11].occupancyPct)
    expect(r.hours.typicalFirst).to.equal(12)
    expect(r.clients.segments.single.cards).to.equal(1) // B came on one day
    expect(r.clients.newCardsByMonth.at(-1)).to.deep.equal({ month: '2026-11', cards: 1 })
    expect(r.clients.paymentMix.mbway).to.include({ cycles: 1 })
    expect(r.clients.paymentMix.card).to.include({ cycles: 1 })
  })

  it('is served to staff only, and a bad "days" is clamped', async () => {
    const ok = await request(app).get('/api/admin/analytics/insights?days=1000').set({ Authorization: `Bearer ${signToken(admin)}` })
    expect(ok.status).to.equal(200)
    expect(ok.body.days).to.equal(90)
    expect((await request(app).get('/api/admin/analytics/insights')).status).to.equal(401)
  })
})

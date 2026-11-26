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

  it('a date range (the dashboard filter) limits the window, compares with the one before, and the API takes ?from/?to/?all', async () => {
    await sale({ machineId: wash._id, amount: 5, batchId: 'a', createdAt: at('2026-11-09T12:00:00Z') })
    await sale({ machineId: wash._id, amount: 6, batchId: 'b', createdAt: at('2026-11-10T12:00:00Z') })
    await sale({ machineId: dry._id, amount: 4, batchId: 'c', createdAt: at('2026-11-11T12:00:00Z') })
    await sale({ machineId: wash._id, amount: 2, batchId: 'old', createdAt: at('2026-11-08T12:00:00Z') }) // the day before the range
    const { shopRange } = await import('../src/services/shopRange.js')
    const r = await computeInsights(tenant._id, { now: NOW, range: shopRange({ from: '2026-11-10', to: '2026-11-11' }) })
    expect(r.period).to.include({ from: '2026-11-10', to: '2026-11-11', days: 2, cycles: 2 })
    expect(r.period.revenue).to.include({ current: 10, previous: 7 }) // 6 + 4, against the two days before it (8 and 9 Nov: 2 + 5)
    expect(r.ticket.cycles).to.equal(2) // the cycle of the 9th and the one of the 8th are outside
    const today = await computeInsights(tenant._id, { now: NOW, range: shopRange({ from: '2026-11-11', to: '2026-11-11' }) })
    expect(today.period).to.include({ days: 1, cycles: 1 })
    const all = await computeInsights(tenant._id, { now: NOW, range: shopRange({ all: '1' }) })
    expect(all.period.cycles).to.equal(4)
    expect(all.period.revenue.previous).to.equal(null) // nothing before "everything"
    // the routes: revenue by day for a range (and without a range it is still the last 30 days), rhythm and machines follow it
    const get = (path) => request(app).get(path).set('Authorization', `Bearer ${signToken(admin)}`)
    const rev = (await get('/api/admin/analytics/revenue?from=2026-11-09&to=2026-11-10')).body
    expect(rev.map((d) => d._id)).to.deep.equal(['2026-11-09', '2026-11-10'])
    const bad = (await get('/api/admin/analytics/revenue?from=nonsense&to=x&all=1')).body // nonsense days are ignored; all=1 = everything
    expect(bad.length).to.equal(4)
    const mach = (await get('/api/admin/analytics/machines?from=2026-11-09&to=2026-11-09')).body
    expect(mach.find((m) => m.machineInfo.name === 'Lavar 1').usageCount).to.equal(1)
    const rhythm = (await get('/api/admin/analytics/rhythm?from=2026-11-09&to=2026-11-09')).body
    expect(rhythm.parts.reduce((t, x) => t + x.cycles, 0)).to.equal(1)
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

describe('Owner insights: hardware warnings', function () {
  this.timeout(20000)
  let tenant
  before(async () => { await startTestDb(); await clearTestDb(); ;({ tenant } = await seedTenantAndUsers()) })
  after(async () => { await stopTestDb() })
  it('a coin acceptor reported silent shows until it is heard from again', async () => {
    const AuditLog = (await import('../src/models/auditLog.js')).default
    const NOW = new Date('2026-11-12T12:00:00Z')
    const log = (action, iso, details = {}) => AuditLog.create({ tenantId: tenant._id, actorUsername: 'system', action, targetType: 'CashSession', targetId: '', details, createdAt: new Date(iso) })
    await log('hardware.coin.silent', '2026-11-12T11:00:00Z', { lastCoinMinutesAgo: 210 })
    // `since` is the last coin (alert time minus 210 min = 07:30), and the age is counted to NOW, not to the alert
    const shown = (await computeInsights(tenant._id, { now: NOW })).alerts.coinSilent
    expect(shown.lastCoinMinutesAgo).to.equal(270)
    expect(shown.since.toISOString()).to.equal('2026-11-12T07:30:00.000Z')
    // a cash payment after the alert ends it even if the PC never wrote 'resumed' (it restarted in between: 2026-11-25)
    const Sale = (await import('../src/models/sale.js')).default
    const sale = await Sale.create({ tenantId: tenant._id, amount: 2, method: 'cash', type: 'payment', createdAt: new Date('2026-11-12T11:20:00Z') })
    expect((await computeInsights(tenant._id, { now: NOW })).alerts.coinSilent).to.equal(null)
    await Sale.deleteOne({ _id: sale._id })
    await log('hardware.coin.resumed', '2026-11-12T11:30:00Z')
    expect((await computeInsights(tenant._id, { now: NOW })).alerts.coinSilent).to.equal(null)
  })
})

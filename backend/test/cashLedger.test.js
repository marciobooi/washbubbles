import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { reconcileShopLedger, readLedgerPayload, applicableSettings, ensureResetMarker, RESET_KEY, SINCE_KEY } from '../src/services/cashDrawer.js'

// 2026-11-12: the counting screen of the day close opened with no coins and no notes: the shop's ledger of accepted coins and notes was
// overwritten with the central server's empty one every 30 s, and the central server (where the close is done) never had the real one.
describe('Coins and notes accepted since the last close', function () {
  this.timeout(20000)
  let app, tenant, admin, kiosk, Setting, Flow, DayClose
  const kioskAuth = () => ({ Authorization: `ApiKey ${kiosk.apiKey}` })
  const adminAuth = () => ({ Authorization: `Bearer ${signToken(admin)}` })
  const cashIn = (value, at) => ({ at: new Date(at), type: 'cash_in', text: 'x', ok: true, data: { value } })
  const flow = (id, at, steps) => Flow.create({ tenantId: tenant._id, flowId: id, startedAt: new Date(at), lastAt: new Date(at), steps })

  before(async () => {
    await startTestDb(); app = await buildTestApp()
    ;[Setting, Flow, DayClose] = await Promise.all(['setting', 'flow', 'dayClose'].map(async (m) => (await import(`../src/models/${m}.js`)).default))
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); ;({ tenant, admin, kiosk } = await seedTenantAndUsers()) })

  it('the shop never takes its own ledger from the central settings', () => {
    const kept = applicableSettings([{ key: 'cashDrawerLedger', value: [] }, { key: SINCE_KEY, value: 'x' }, { key: 'adminPin', value: 'y' }, { key: RESET_KEY, value: 'z' }])
    expect(kept.map((d) => d.key)).to.deep.equal(['adminPin', RESET_KEY]) // the close time still comes down, the counts do not
  })

  it('a ledger with no start is built from the flows since the last close, and a newer close zeroes it', async () => {
    await Setting.create({ tenantId: tenant._id, key: RESET_KEY, value: '2026-11-01T00:00:00.000Z' })
    await flow('old', '2026-10-30T10:00:00Z', [cashIn(10, '2026-10-30T10:00:00Z')]) // before the close: not counted
    await flow('a', '2026-11-05T10:00:00Z', [cashIn(10, '2026-11-05T10:00:00Z'), cashIn(0.5, '2026-11-05T10:00:05Z'), cashIn(10, '2026-11-05T10:01:00Z')])
    expect(await reconcileShopLedger(tenant._id, Flow)).to.equal('seeded')
    expect((await readLedgerPayload(tenant._id)).counts).to.deep.equal([{ value: 0.5, count: 1 }, { value: 10, count: 2 }])
    expect(await reconcileShopLedger(tenant._id, Flow)).to.equal('ok')
    await Setting.updateOne({ tenantId: tenant._id, key: RESET_KEY }, { $set: { value: '2026-11-10T00:00:00.000Z' } }) // a real close happened
    expect(await reconcileShopLedger(tenant._id, Flow)).to.equal('reseeded')
    expect((await readLedgerPayload(tenant._id)).counts).to.deep.equal([]) // nothing went in since that close
    await Setting.updateOne({ tenantId: tenant._id, key: RESET_KEY }, { $set: { value: '2026-11-01T00:00:00.000Z' } }) // the close is annulled: the start moves back
    expect(await reconcileShopLedger(tenant._id, Flow)).to.equal('reseeded')
    expect((await readLedgerPayload(tenant._id)).counts).to.deep.equal([{ value: 0.5, count: 1 }, { value: 10, count: 2 }])
  })

  it('the central server keeps the shop\'s count, ignores one that starts before the last close, and the day close shows it', async () => {
    await Setting.create({ tenantId: tenant._id, key: RESET_KEY, value: '2026-11-01T00:00:00.000Z' })
    const push = (b) => request(app).post('/api/sync/push/cash-ledger').set(kioskAuth()).send(b)
    expect((await push({ since: '2026-11-01T00:00:00.000Z', counts: [{ value: 10, count: 7 }, { value: 0.5, count: 12 }] })).body.success).to.equal(true)
    const sum = (await request(app).get('/api/admin/day-close/summary').set(adminAuth())).body
    expect(sum.acceptedTotal).to.equal(76) // 7 notes of 10 and 12 coins of 0.50
    expect(sum.acceptedDenominations.find((d) => d.value === 10).count).to.equal(7)
    const stale = await push({ since: '2026-10-01T00:00:00.000Z', counts: [{ value: 10, count: 99 }] })
    expect(stale.body.ignored).to.match(/older/)
    expect((await request(app).get('/api/admin/day-close/summary').set(adminAuth())).body.acceptedTotal).to.equal(76)
    expect((await push({ since: 'garbage', counts: [] })).status).to.equal(400)
  })

  it('a real close zeroes the count and marks the close as the new start', async () => {
    await Setting.create({ tenantId: tenant._id, key: 'cashDrawerLedger', value: [{ value: 10, count: 5 }] })
    const r = await request(app).post('/api/admin/day-close').set(adminAuth()).send({ amountToBank: 0, floatLeft: 0, countedCash: 0 })
    expect(r.status).to.equal(200)
    const sum = (await request(app).get('/api/admin/day-close/summary').set(adminAuth())).body
    expect(sum.acceptedTotal).to.equal(0)
    expect((await Setting.findOne({ tenantId: tenant._id, key: RESET_KEY })).value).to.be.a('string')
  })

  it('at start the last real close becomes the start marker, once', async () => {
    await DayClose.create({ tenantId: tenant._id, source: 'dashboard', periodFrom: new Date('2026-09-01'), periodTo: new Date('2026-09-21T13:49:02Z'), openingFloat: 0 })
    expect(await ensureResetMarker(DayClose)).to.equal(1)
    expect((await Setting.findOne({ tenantId: tenant._id, key: RESET_KEY })).value).to.equal('2026-09-21T13:49:02.000Z')
    expect(await ensureResetMarker(DayClose)).to.equal(0)
  })
})

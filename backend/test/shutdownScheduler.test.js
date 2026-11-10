import { expect } from 'chai'
import { startTestDb, stopTestDb, clearTestDb, seedTenantAndUsers } from './setup.test-helper.js'
import Setting from '../src/models/setting.js'
import AuditLog from '../src/models/auditLog.js'
import { tick, _reset, KEY } from '../src/services/shutdownScheduler.js'

describe('Scheduled shutdown of the shop PC', function () {
  this.timeout(20000)
  let tenant
  const at = (hh, mm, day = 24) => () => new Date(2026, 9, day, hh, mm, 0)
  const coin = (credit = 0) => ({ tenantId: null, client: { getState: () => ({ balance: credit }) } })
  const mk = (credit) => { const c = coin(credit); c.tenantId = tenant._id; return c }
  before(async () => { await startTestDb(); await clearTestDb(); ;({ tenant } = await seedTenantAndUsers()) })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { _reset(); await Setting.deleteMany({}); await AuditLog.deleteMany({}) })
  const set = (v) => Setting.create({ tenantId: tenant._id, key: KEY, value: v })

  it('does nothing when it is off or not set', async () => {
    expect(await tick(mk(), { now: at(23, 30) })).to.equal('off')
    await set({ enabled: false, time: '23:30' })
    expect(await tick(mk(), { now: at(23, 30) })).to.equal('off')
  })

  it('warns in the last 3 minutes, shuts down at the time (after flushing), and only once a day', async () => {
    await set({ enabled: true, time: '23:30' })
    expect(await tick(mk(), { now: at(23, 10) })).to.equal('waiting')
    expect(await tick(mk(), { now: at(23, 28) })).to.equal('warned')
    expect(await tick(mk(), { now: at(23, 29) })).to.equal('warned')
    const calls = []
    const deps = { now: at(23, 30), flush: async () => calls.push('flush'), exec: async () => calls.push('exec') }
    expect(await tick(mk(), deps)).to.equal('shutdown')
    expect(calls).to.deep.equal(['flush', 'exec'])
    expect(await tick(mk(), deps)).to.equal('done')
    expect(await AuditLog.countDocuments({ action: 'system.shutdown' })).to.equal(1)
  })

  it('credit still there when it switches off is held for the customer (written down, staff told), not left for the morning', async () => {
    await set({ enabled: true, time: '23:30' })
    const held = []
    const c = mk(4.5)
    c.holdCredit = async (d) => { held.push(d) }
    expect(await tick(c, { now: at(23, 41), flush: async () => {}, exec: async () => {} })).to.equal('shutdown')
    expect(held).to.have.length(1)
    expect(held[0]).to.include({ amount: 4.5, reason: 'shutdown' })
    // nothing to hold when the machine is empty
    _reset()
    const empty = mk(0)
    empty.holdCredit = async (d) => { held.push(d) }
    await tick(empty, { now: at(23, 30, 25), flush: async () => {}, exec: async () => {} })
    expect(held).to.have.length(1)
  })

  it('waits while a customer has credit, but not forever (10 minutes)', async () => {
    await set({ enabled: true, time: '23:30' })
    const calls = []
    const d = (m) => ({ now: at(23, 30 + m), flush: async () => {}, exec: async () => calls.push('exec') })
    expect(await tick(mk(5), d(0))).to.equal('waiting-for-customer')
    expect(await tick(mk(5), d(9))).to.equal('waiting-for-customer')
    expect(await tick(mk(5), d(10))).to.equal('shutdown')
    expect(calls).to.have.length(1)
  })

  it('each weekday has its own time or none; "always on" never shuts down', async () => {
    const days = Array.from({ length: 7 }, () => ({ enabled: false, time: '23:30' }))
    days[5] = { enabled: true, time: '23:30' } // Friday (2026-10-23)
    days[6] = { enabled: true, time: '00:15' } // Saturday (2026-10-24)
    await set({ enabled: true, days })
    const calls = []
    const run = (d, hh, mm) => tick(mk(), { now: () => new Date(2026, 9, d, hh, mm, 0), flush: async () => {}, exec: async () => calls.push(d) })
    expect(await run(25, 23, 30)).to.equal('off') // Sunday: no shutdown that day
    expect(await run(24, 23, 30)).to.equal('waiting') // Saturday's time is 00:15, long past
    expect(calls).to.deep.equal([])
    expect(await run(23, 23, 30)).to.equal('shutdown') // Friday at 23:30
    expect(calls).to.deep.equal([23])
    await Setting.updateOne({ key: KEY }, { $set: { 'value.enabled': false } })
    _reset()
    expect(await run(23, 23, 30)).to.equal('off') // master switch off = always on (24 hours)
    expect(calls).to.deep.equal([23])
  })

  it('"skip today" holds for that day only; a PC switched on long after the time is not shut down', async () => {
    await set({ enabled: true, time: '23:30', skipDate: '2026-10-24' })
    expect(await tick(mk(), { now: at(23, 30, 24) })).to.equal('skipped')
    _reset()
    expect(await tick(mk(), { now: at(23, 30, 25), flush: async () => {}, exec: async () => {} })).to.equal('shutdown')
    _reset()
    expect(await tick(mk(), { now: at(23, 50, 26), flush: async () => {}, exec: async () => { throw new Error('must not') } })).to.equal('waiting') // outside the 15-minute window
  })
})

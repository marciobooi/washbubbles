import { expect } from 'chai'
import { startTestDb, stopTestDb, clearTestDb } from './setup.test-helper.js'
import Tenant from '../src/models/tenant.js'
import { tick } from '../src/services/domainWatcher.js'

describe('Domain watcher: a new shop\'s site address on its way online', function () {
  this.timeout(30000)
  before(async () => { await startTestDb(); await clearTestDb(); await Tenant.init() })
  after(async () => { await stopTestDb() })

  it('a failed attempt is retried after 30 minutes, not before, and not once the 5 attempts are used', async () => {
    const old = new Date(Date.now() - 31 * 60_000)
    const a = await Tenant.create({ name: 'A', slug: 'a-w', domains: ['a-w.test.pt'], domainState: { state: 'failed', attempts: 1, checkedAt: old } })
    const b = await Tenant.create({ name: 'B', slug: 'b-w', domains: ['b-w.test.pt'], domainState: { state: 'failed', attempts: 1, checkedAt: new Date() } })
    const c = await Tenant.create({ name: 'C', slug: 'c-w', domains: ['c-w.test.pt'], domainState: { state: 'failed', attempts: 5, checkedAt: old } })
    await tick()
    expect((await Tenant.findById(a._id)).domainState.state).to.equal('pending_dns')
    expect((await Tenant.findById(b._id)).domainState.state).to.equal('failed')
    expect((await Tenant.findById(c._id)).domainState.state).to.equal('failed')
  })

  it('tells the customer once when the site is live', async () => {
    const t = await Tenant.create({ name: 'Live', slug: 'live-w', domains: ['live-w.test.pt', 'www.live-w.test.pt'], customerEmail: 'c@x.pt', domainState: { state: 'active' } })
    await tick()
    const sent = (await Tenant.findById(t._id)).domainState.activationEmailSentAt
    expect(sent).to.be.instanceOf(Date)
    await tick()
    expect((await Tenant.findById(t._id)).domainState.activationEmailSentAt.getTime()).to.equal(sent.getTime()) // not again
  })
})

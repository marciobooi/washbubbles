import { expect } from 'chai'
import { startTestDb, stopTestDb, clearTestDb } from './setup.test-helper.js'
import PlatformSetting from '../src/models/platformSetting.js'
import { acquire, runAsLeader } from '../src/services/leader.js'
import { hasRole } from '../src/services/roles.js'

describe('Roles and the single-leader lease for background jobs', function () {
  this.timeout(20000)
  before(async () => { await startTestDb(); await clearTestDb(); await PlatformSetting.init() })
  after(async () => { delete process.env.APP_ROLES; await stopTestDb() })

  it('every role is on by default; APP_ROLES narrows it', () => {
    delete process.env.APP_ROLES
    expect(hasRole('web') && hasRole('sync') && hasRole('worker')).to.equal(true)
    process.env.APP_ROLES = 'sync, worker'
    expect(hasRole('web')).to.equal(false)
    expect(hasRole('worker')).to.equal(true)
    delete process.env.APP_ROLES
  })

  it('this process keeps the lease it took, and runs the job', async () => {
    expect(await acquire('job-a', 5000)).to.equal(true)
    expect(await acquire('job-a', 5000)).to.equal(true)
    let ran = 0
    expect(await runAsLeader('job-a', 5000, async () => { ran++ })).to.equal(true)
    expect(ran).to.equal(1)
  })

  it('another process cannot take a live lease, but takes an expired one', async () => {
    await PlatformSetting.create({ key: 'lease:job-b', value: { holder: 'someone-else', until: Date.now() + 60_000 } })
    expect(await acquire('job-b', 5000)).to.equal(false)
    await PlatformSetting.updateOne({ key: 'lease:job-b' }, { $set: { 'value.until': Date.now() - 1 } })
    expect(await acquire('job-b', 5000)).to.equal(true)
  })
})

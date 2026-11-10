import { expect } from 'chai'
import { startTestDb, stopTestDb, clearTestDb, seedTenantAndUsers } from './setup.test-helper.js'
import Setting from '../src/models/setting.js'
import { getLegalStatus, resumeInterrupted as resumeLegal, STATUS_KEY } from '../src/services/legalTranslate.js'
import { getStatus as getLandingStatus, STATUS_KEY as LANDING_STATUS_KEY } from '../src/services/landingTranslate.js'

// 2026-11-10: the server restarted in the middle of a translation, the status stayed "running" and the admin button said
// "A traduzir..." for ever. A "running" nobody is running is shown as interrupted, and started again after the restart.
describe('A translation cut off by a restart does not stay "running" for ever', function () {
  this.timeout(20000)
  let tenant
  before(async () => { await startTestDb(); await clearTestDb(); ;({ tenant } = await seedTenantAndUsers()) })
  after(async () => { await stopTestDb() })
  beforeEach(() => Setting.deleteMany({ key: { $in: [STATUS_KEY, LANDING_STATUS_KEY] } }))
  const running = (key, ageMs) => Setting.create({ tenantId: tenant._id, key, value: { state: 'running', startedAt: new Date(Date.now() - ageMs) } })

  it('legal: shown as interrupted once nothing is running it; a run that just started is left alone', async () => {
    await running(STATUS_KEY, 5 * 60_000)
    const s = (await getLegalStatus(tenant._id)).status
    expect(s).to.include({ state: 'error', interrupted: true })
    expect(s.error).to.match(/interrompida/)
    await Setting.deleteMany({ key: STATUS_KEY })
    await running(STATUS_KEY, 2_000)
    expect((await getLegalStatus(tenant._id)).status.state).to.equal('running')
  })

  it('landing page: the same', async () => {
    await running(LANDING_STATUS_KEY, 5 * 60_000)
    expect(await getLandingStatus(tenant._id)).to.include({ state: 'error', interrupted: true })
  })

  it('after a restart the interrupted ones are counted (and started again when the translator is on)', async () => {
    await running(STATUS_KEY, 5 * 60_000)
    expect(await resumeLegal()).to.equal(1)
    await Setting.deleteMany({ key: STATUS_KEY })
    expect(await resumeLegal()).to.equal(0)
  })
})

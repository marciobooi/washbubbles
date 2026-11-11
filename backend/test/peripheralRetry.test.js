import { expect } from 'chai'
import { EventEmitter } from 'events'
import { startTestDb, stopTestDb, clearTestDb, seedTenantAndUsers } from './setup.test-helper.js'
import AuditLog from '../src/models/auditLog.js'
import { CoinMachine } from '../src/services/coinMachine.js'
import { Middleware } from '../src/services/middleware.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 2026-11: the bill acceptor answered the controller's configuration with error "-1" three times in three days and then took no
// notes until the automatic round three hours later, with nobody told.
describe('A peripheral that does not answer its configuration', function () {
  this.timeout(20000)
  let tenant
  before(async () => { await startTestDb(); await clearTestDb(); ;({ tenant } = await seedTenantAndUsers()); process.env.PERIPHERAL_RETRY_MS = '5' })
  after(async () => { delete process.env.PERIPHERAL_RETRY_MS; await stopTestDb() })
  beforeEach(() => AuditLog.deleteMany({}))

  it('the middleware tells apart an answer with an error from a clean one', () => {
    const mw = new Middleware()
    const seen = []
    mw.on('peripheral-config-error', (d) => seen.push(['error', d]))
    mw.on('peripheral-config-ok', (d) => seen.push(['ok', d]))
    mw.handlePackage({ op: 'config_per', per: [{ addr: '40', type: 'bill-acceptor', error: '-1' }, { addr: '3', perProps: { type: 'hopper' } }] })
    mw.handlePackage({ op: 'config_per', per: [{ addr: '40', type: 'bill-acceptor', error: '0' }, { addr: '3', perProps: { type: 'hopper' } }] })
    mw.handlePackage({ op: 'config_per', code: '200', msg: 'Rq_C_P' }) // the plain acknowledgement: nothing to say
    expect(seen.map((s) => s[0])).to.deep.equal(['error', 'ok'])
    expect(seen[0][1].errors).to.deep.equal([{ type: 'bill-acceptor', addr: '40', error: '-1' }])
  })

  it('asks again soon (3 times, only while idle), tells the staff once, and notes when it answers again', async () => {
    const cm = new CoinMachine({ tenantId: tenant._id, middleware: Object.assign(new EventEmitter(), { subscribe: () => ({ unsubscribe() {} }) }) })
    let calls = 0
    let idle = false
    cm.hardwareIdle = () => idle
    cm.reinitHardware = async () => { calls++ }
    const err = { errors: [{ type: 'bill-acceptor', addr: '40', error: '-1' }] }
    await cm.handlePeripheralConfigError(err)
    await wait(60)
    expect(calls).to.equal(0) // somebody is using the kiosk: not now
    idle = true
    await wait(40)
    expect(calls).to.equal(1)
    // each retry is answered with the same error: 3 retries in all, then the staff is told, once, and it stops trying
    await cm.handlePeripheralConfigError(err); await wait(30)
    await cm.handlePeripheralConfigError(err); await wait(30)
    expect(calls).to.equal(3)
    await cm.handlePeripheralConfigError(err)
    await cm.handlePeripheralConfigError(err)
    await wait(30)
    expect(calls).to.equal(3)
    expect(cm.periphEpisode.mailed).to.equal(true)
    expect(await AuditLog.countDocuments({ action: 'hardware.peripheral.error' })).to.equal(5)
    await cm.handlePeripheralConfigOk()
    expect(cm.periphEpisode).to.equal(null)
    const rec = await AuditLog.findOne({ action: 'hardware.peripheral.recovered' })
    expect(rec.details.attempts).to.equal(3)
    await cm.handlePeripheralConfigOk() // an ordinary clean answer afterwards: nothing more
    expect(await AuditLog.countDocuments({ action: 'hardware.peripheral.recovered' })).to.equal(1)
  })
})

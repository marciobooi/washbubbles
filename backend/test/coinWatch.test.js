import { expect } from 'chai'
import { startTestDb, stopTestDb, clearTestDb, seedTenantAndUsers } from './setup.test-helper.js'
import AuditLog from '../src/models/auditLog.js'
import { CoinMachine } from '../src/services/coinMachine.js'

// 2026-11-12: the coin acceptor swallowed coins without telling the controller and only a customer's complaint showed it.
describe('The coin acceptor is watched', function () {
  this.timeout(20000)
  let tenant, cm
  const H = 3600e3
  const at = (hh) => new Date(`2026-11-12T${hh}:00Z`).getTime() // winter: Lisbon = UTC
  before(async () => { await startTestDb(); await clearTestDb(); ;({ tenant } = await seedTenantAndUsers()) })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await AuditLog.deleteMany({})
    cm = new CoinMachine({ tenantId: tenant._id, middleware: { subscribe: () => ({ unsubscribe() {} }) } })
    cm.running = true
  })

  it('a coin it does not know is written down and e-mailed at once, but not more than once in 30 minutes', async () => {
    await cm.alertCoinRejected({ reason: 'unmapped code 0', code: 0 })
    const first = cm.lastCoinRejectAlert
    await cm.alertCoinRejected({ reason: 'unmapped code 0', code: 0 })
    expect(cm.lastCoinRejectAlert).to.equal(first) // the second did not send another e-mail
    expect(await AuditLog.countDocuments({ action: 'hardware.coin.rejected' })).to.equal(2) // both are in the audit trail
  })

  it('reports a coin acceptor that is silent for hours while the shop is busy, once, and notes when it speaks again', async () => {
    cm.lastCoinAt = at('08:00')
    const pays = (n) => async () => n
    expect(await cm.checkCoinAcceptor({ now: at('09:30'), countPayments: pays(10) })).to.equal('recent') // only 90 minutes
    expect(await cm.checkCoinAcceptor({ now: at('11:30'), countPayments: pays(2) })).to.equal('quiet-shop') // few customers: nothing to read into
    expect(await cm.checkCoinAcceptor({ now: at('03:30') + 24 * H, countPayments: pays(50) })).to.equal('closed') // the shop is shut
    expect(await cm.checkCoinAcceptor({ now: at('11:30'), countPayments: pays(12) })).to.equal('silent')
    expect(await cm.checkCoinAcceptor({ now: at('12:30'), countPayments: pays(15) })).to.equal('already') // once per silence
    const silent = await AuditLog.findOne({ action: 'hardware.coin.silent' })
    expect(silent.details).to.include({ lastCoinMinutesAgo: 210, paymentsSince: 12 })
    cm.noteCoinSeen()
    await new Promise((r) => setTimeout(r, 50))
    expect(await AuditLog.countDocuments({ action: 'hardware.coin.resumed' })).to.equal(1)
    expect(cm.coinSilent).to.equal(false)
  })
})

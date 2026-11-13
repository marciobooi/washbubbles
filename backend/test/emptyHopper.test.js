import { expect } from 'chai'
import { startTestDb, stopTestDb, clearTestDb, seedTenantAndUsers } from './setup.test-helper.js'
import AuditLog from '../src/models/auditLog.js'
import Peripheral from '../src/models/peripheral.js'
import { CoinMachine } from '../src/services/coinMachine.js'

// 2026-11-12: "Esvaziar hopper" asked the controller for 9999 EUR in one go and read nonsense back (79.60 reported with 115.20 on the table,
// 9919.40 shown as emptied). It now empties with ordinary requests and adds up what each one PAID.
describe('Emptying the hopper counts exactly what came out', function () {
  this.timeout(20000)
  let tenant, cm, hopper, asked
  // a hopper that pays biggest coins first from what it holds and answers, like the controller, with what it could NOT pay
  const makeHopper = (stock) => {
    const coins = { ...stock }
    return {
      coins,
      dispenseChange: async (_id, amount) => {
        asked.push(amount)
        let left = Math.round(amount * 100)
        for (const v of Object.keys(coins).map(Number).sort((a, b) => b - a)) {
          const c = Math.round(v * 100)
          const n = Math.min(coins[v], Math.floor(left / c))
          coins[v] -= n; left -= n * c
        }
        const remaining = left / 100
        return { success: remaining === 0, dispensed: Math.round(amount * 100 - left) / 100, remaining, error: remaining ? 'Controller could not pay out the full amount' : undefined }
      },
    }
  }
  before(async () => { await startTestDb() })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb(); ;({ tenant } = await seedTenantAndUsers())
    await AuditLog.deleteMany({})
    hopper = await Peripheral.create({ tenantId: tenant._id, name: 'Hopper', type: 'hopper', enabled: true, hopperConfig: { currentCount: 166 } })
    asked = []
  })
  const machineWith = (stock) => {
    const h = makeHopper(stock)
    cm = new CoinMachine({ tenantId: tenant._id, middleware: { subscribe: () => ({ unsubscribe() {} }), dispenseChange: h.dispenseChange } })
    cm.running = true
    return h
  }

  it('adds up what every request paid: 115.20 on the table is 115.20 reported, with no "customer owed" alert', async () => {
    const h = machineWith({ 2: 36, 1: 21, 0.5: 15, 0.2: 53, 0.1: 41 })
    const r = await cm.emptyHopper()
    expect(r.dispensed).to.equal(115.2)
    expect(r.error).to.equal(undefined)
    expect(Object.values(h.coins).reduce((s, n) => s + n, 0)).to.equal(0) // nothing left in the hopper
    expect(Math.max(...asked)).to.equal(50) // never the huge request
    const audit = await AuditLog.findOne({ action: 'hopper.empty' }).lean()
    expect(audit.details.dispensed).to.equal(115.2)
    expect(await AuditLog.countDocuments({ action: 'change.shortfall' })).to.equal(0)
    const p = await Peripheral.findById(hopper._id).lean()
    expect(p.hopperConfig.currentCount).to.equal(0)
  })

  it('an empty hopper pays 0 and says so; a hopper with only small coins still empties down to the last 10 cents', async () => {
    machineWith({})
    expect((await cm.emptyHopper()).dispensed).to.equal(0)
    const h = machineWith({ 0.2: 3, 0.1: 4 })
    expect((await cm.emptyHopper()).dispensed).to.equal(1)
    expect(h.coins[0.1]).to.equal(0)
  })

  it('a request nobody can confirm stops the emptying and is reported, not guessed', async () => {
    cm = new CoinMachine({ tenantId: tenant._id, middleware: { subscribe: () => ({ unsubscribe() {} }), dispenseChange: async () => ({ success: false, dispensed: 0, remaining: 50, unconfirmed: true, error: 'no answer' }) } })
    cm.running = true
    const r = await cm.emptyHopper()
    expect(r).to.include({ dispensed: 0, unconfirmed: true })
  })

  it('a customer with credit blocks it', async () => {
    machineWith({ 2: 5 })
    cm.client.client.balance = 3
    const r = await cm.emptyHopper()
    expect(r.dispensed).to.equal(0)
    expect(r.error).to.contain('crédito')
  })
})

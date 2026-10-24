import { expect } from 'chai'
import { startTestDb, stopTestDb, clearTestDb, seedTenantAndUsers } from './setup.test-helper.js'
import { CoinMachine } from '../src/services/coinMachine.js'
import AuditLog from '../src/models/auditLog.js'
import Setting from '../src/models/setting.js'

describe('Change that could not be paid: the shop is told', function () {
  this.timeout(20000)
  let tenant
  before(async () => { await startTestDb(); await clearTestDb(); ;({ tenant } = await seedTenantAndUsers()) })
  after(async () => { await stopTestDb() })

  it('writes the audit trail, e-mails the shop (support address) and rate-limits to once a minute', async () => {
    await Setting.create({ tenantId: tenant._id, key: 'support.email', value: 'geral@loja.pt' })
    const cm = new CoinMachine({ tenantId: tenant._id, middleware: { dispenseChange: async () => ({ success: false, dispensed: 0, remaining: 3, error: 'Hopper fault' }) } })
    const printed = []
    const orig = console.log; console.log = (...x) => printed.push(x.join(' '))
    try {
      await cm.dispenseChange('h1', 3)
      await new Promise((r) => setTimeout(r, 300))
      await cm.dispenseChange('h1', 3) // within a minute: no second alert
      await new Promise((r) => setTimeout(r, 300))
    } finally { console.log = orig }
    const rows = await AuditLog.find({ tenantId: tenant._id, action: 'change.shortfall' }).lean()
    expect(rows).to.have.length(1)
    expect(rows[0].details.remaining).to.equal(3)
    expect(printed.join('\n')).to.include('geral@loja.pt') // the (unconfigured) mailer prints its recipient
    expect(printed.join('\n')).to.include('ficaram por pagar 3.00')
  })

  it('emptying the hopper on purpose (a huge request) is not reported as a failure', async () => {
    const cm = new CoinMachine({ tenantId: tenant._id, middleware: { dispenseChange: async () => ({ success: false, dispensed: 12, remaining: 9987 }) } })
    await cm.dispenseChange('h1', 9999)
    await new Promise((r) => setTimeout(r, 200))
    expect(await AuditLog.countDocuments({ tenantId: tenant._id, action: 'change.shortfall' })).to.equal(1) // still only the first
  })
})

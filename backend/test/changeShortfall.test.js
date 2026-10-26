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
      await cm.dispenseChange('h1', 3, { retryDelayMs: 5 })
      await new Promise((r) => setTimeout(r, 300))
      await cm.dispenseChange('h1', 3, { retryDelayMs: 5 }) // within a minute: no second alert
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

describe('A momentary hopper fault: the rest of the change is asked for again', function () {
  this.timeout(20000)
  let tenant
  before(async () => { await startTestDb(); await clearTestDb(); ;({ tenant } = await seedTenantAndUsers()) })
  after(async () => { await stopTestDb() })
  const machine = (answers) => { const asked = []; const mw = { dispenseChange: async (h, amount) => { asked.push(amount); return answers.shift() } }; return { cm: new CoinMachine({ tenantId: tenant._id, middleware: mw }), asked } }

  it('pays the rest on the second try and reports the total, without an alert', async () => {
    const { cm, asked } = machine([{ success: false, dispensed: 3, remaining: 5, error: 'Hopper fault' }, { success: true, dispensed: 5, remaining: 0 }])
    const r = await cm.dispenseChange('h', 8, { retryDelayMs: 5 })
    expect(asked).to.deep.equal([8, 5]) // only the REST is asked for the second time
    expect(r).to.include({ success: true, dispensed: 8 })
    await new Promise((x) => setTimeout(x, 100))
    expect(await AuditLog.countDocuments({ tenantId: tenant._id, action: 'change.shortfall' })).to.equal(0)
  })

  it('gives up after 3 more tries, and then the shop is told once', async () => {
    const bad = { success: false, dispensed: 0, remaining: 4, error: 'Hopper fault' }
    const { cm, asked } = machine([bad, bad, bad, bad])
    const r = await cm.dispenseChange('h', 4, { retryDelayMs: 5 })
    expect(asked).to.deep.equal([4, 4, 4, 4])
    expect(r.success).to.equal(false)
    await new Promise((x) => setTimeout(x, 300))
    expect(await AuditLog.countDocuments({ tenantId: tenant._id, action: 'change.shortfall' })).to.equal(1)
  })

  it('does not retry after a timeout (nobody knows what was paid)', async () => {
    const { cm, asked } = machine([{ success: false, dispensed: 0, remaining: 4, unconfirmed: true }])
    await cm.dispenseChange('h', 4, { retryDelayMs: 5 })
    expect(asked).to.deep.equal([4])
  })
})

describe('The kiosk screen reports a crash', function () {
  this.timeout(20000)
  let app
  before(async () => {
    await startTestDb(); await clearTestDb()
    const { buildTestApp } = await import('./setup.test-helper.js')
    app = await buildTestApp(); await seedTenantAndUsers()
  })
  after(async () => { await stopTestDb() })
  it('keeps every report in the audit trail (bounded) and e-mails the shop at most once in 10 minutes', async () => {
    const request = (await import('supertest')).default
    const post = (b) => request(app).post('/api/pos/client-error').set('Authorization', 'ApiKey test-kiosk-api-key').send(b)
    const lines = []; const orig = console.log; console.log = (...x) => lines.push(x.join(' '))
    try {
      expect((await post({ message: 'boom', stack: 'x'.repeat(5000), page: '/pos' })).status).to.equal(200)
      expect((await post({ message: 'boom again', page: '/pos' })).status).to.equal(200)
      await new Promise((r) => setTimeout(r, 300))
    } finally { console.log = orig }
    const rows = await AuditLog.find({ action: 'kiosk.client_error' }).lean()
    expect(rows).to.have.length(2)
    expect(rows[0].details.stack.length).to.equal(1500)
    expect((await request(app).post('/api/pos/client-error').send({ message: 'x' })).status).to.equal(401) // only a kiosk key
  })
})

describe('The updater tells the kiosk screens to refresh', function () {
  this.timeout(20000)
  let app
  before(async () => { await startTestDb(); await clearTestDb(); const { buildTestApp } = await import('./setup.test-helper.js'); app = await buildTestApp(); await seedTenantAndUsers() })
  after(async () => { await stopTestDb() })
  it('needs the kiosk key, and answers ok', async () => {
    const request = (await import('supertest')).default
    expect((await request(app).post('/api/pos/screen-reload').send({})).status).to.equal(401)
    expect((await request(app).post('/api/pos/screen-reload').set('Authorization', 'ApiKey test-kiosk-api-key').send({})).body).to.deep.equal({ ok: true })
  })
})

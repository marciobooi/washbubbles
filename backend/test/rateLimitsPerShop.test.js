import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers } from './setup.test-helper.js'
import { resetSoleTenantCache } from '../src/middleware/tenant.js'
import { resetDomainCache } from '../src/services/tenantDomains.js'
import { _resetLimitKeys } from '../src/middleware/limitKey.js'

describe('Rate limits count per shop, not per address', function () {
  this.timeout(60000)
  let app, Tenant
  before(async () => {
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    const { tenant } = await seedTenantAndUsers()
    Tenant = (await import('../src/models/tenant.js')).default
    await Tenant.init()
    await Tenant.updateOne({ _id: tenant._id }, { $set: { domains: ['a.test.pt'] } })
    await Tenant.create({ name: 'Shop B', slug: 'shop-b', domains: ['b.test.pt'] })
    resetSoleTenantCache(); resetDomainCache(); _resetLimitKeys()
    process.env.LOGIN_LIMIT_OFF = 'false'
  })
  after(async () => { process.env.LOGIN_LIMIT_OFF = 'true'; await stopTestDb() })

  const login = (host, username = 'nobody') => request(app).post('/api/auth/login').set('Host', host).send({ username, password: 'wrong' })

  it("one shop's failed logins lock that shop's address, never another shop's", async () => {
    let last
    for (let i = 0; i < 6; i++) last = await login('a.test.pt', 'u' + i)
    expect(last.status).to.equal(401)
    expect((await login('a.test.pt', 'u7')).status).to.equal(429)
    expect((await login('b.test.pt', 'u8')).status).to.equal(401) // same network address, other shop: still free
  })

  it('one account is limited whatever the address (guesses spread over many shops hosts do not help)', async () => {
    _resetLimitKeys()
    let last
    for (let i = 0; i < 12; i++) last = await request(app).post('/api/auth/login').set('Host', 'b.test.pt').set('X-Forwarded-For', `10.0.0.${i}`).send({ username: 'victim', password: 'x' + i })
    // either the per-address (6) or the per-account (12) limit has stopped it by now
    expect(last.status).to.equal(429)
    expect((await login('a.test.pt', 'victim')).status).to.equal(401) // same name in another shop is not affected
  })
})

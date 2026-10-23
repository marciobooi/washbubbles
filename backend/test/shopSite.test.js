import { expect } from 'chai'
import request from 'supertest'
import express from 'express'
import publicRoutes, { _resetContentCacheForTests } from '../src/routes/public.js'
import { resolveTenant } from '../src/middleware/tenant.js'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { resetSoleTenantCache } from '../src/middleware/tenant.js'
import { resetDomainCache } from '../src/services/tenantDomains.js'

describe('Each shop has its own public site, filled in from its own admin', function () {
  this.timeout(60000)
  let app, pubApp, Setting, Tenant, tA, tB, adminB, tokenB
  before(async () => {
    process.env.PRIMARY_DOMAIN = 'a.site.pt'
    await startTestDb(); await clearTestDb()
    app = await buildTestApp()
    pubApp = express(); pubApp.use(express.json()); pubApp.use(resolveTenant); pubApp.use('/', publicRoutes)
    _resetContentCacheForTests()
    ;({ tenant: tA } = await seedTenantAndUsers())
    Setting = (await import('../src/models/setting.js')).default
    Tenant = (await import('../src/models/tenant.js')).default
    const User = (await import('../src/models/user.js')).default
    await Tenant.init()
    await Tenant.updateOne({ _id: tA._id }, { $set: { domains: ['a.site.pt', 'www.a.site.pt'] } })
    tB = await Tenant.create({ name: 'Lavandaria do Márcio', slug: 'marcio', domains: ['www.marcioslvinc.ro', 'marcioslvinc.ro'] })
    adminB = await User.create({ tenantId: tB._id, username: 'admin-b', password: 'x', role: 'ADMIN' })
    tokenB = signToken(adminB)
    resetSoleTenantCache(); resetDomainCache()
  })
  after(async () => { delete process.env.PRIMARY_DOMAIN; await stopTestDb() })
  const page = (host, path = '/') => request(pubApp).get(path).set('Host', host)

  it('the original shop keeps the FreshBubbles page', async () => {
    const r = await page('a.site.pt')
    expect(r.status).to.equal(200)
    expect(r.text).to.include('Loures')
    expect(r.text).to.include('https://a.site.pt/')
  })

  it("a new shop starts from a neutral page: its name, none of FreshBubbles' facts", async () => {
    const r = await page('www.marcioslvinc.ro')
    expect(r.status).to.equal(200)
    expect(r.text).to.include('Lavandaria do Márcio')
    for (const bad of ['Loures', 'Fresh Bubbles', 'FreshBubbles', '912 715 258', 'freshbubbles.pt', 'Daniel Vinhas', 'instagram.com']) expect(r.text, bad).to.not.include(bad)
    expect(r.text).to.include('https://www.marcioslvinc.ro/') // canonical/alternate use ITS address
    expect(r.text).to.not.include('rating-chip"')
    expect((await page('www.marcioslvinc.ro', '/robots.txt')).text).to.include('https://www.marcioslvinc.ro/sitemap.xml')
    expect((await page('www.marcioslvinc.ro', '/sitemap.xml')).text).to.include('https://www.marcioslvinc.ro/')
    const legal = await page('www.marcioslvinc.ro', '/legal/privacy')
    expect(legal.status).to.equal(200)
    expect(legal.text).to.not.include('freshbubbles.pt')
  })

  it("what the shop writes in its admin shows on ITS site only", async () => {
    const put = await request(app).post('/api/admin/settings').set('Authorization', `Bearer ${tokenB}`).send({ key: 'landingPage.content', value: { brand: { name: 'Marcio Inc', phone: '+40 700 000 000', email: 'ola@marcioslvinc.ro', address: { street: 'Strada Mare 1', postal: '010101', city: 'Bucuresti', country: 'Romania' }, rating: { value: 4.8, count: 20 } } } })
    expect(put.status).to.equal(200)
    const bumpV = (await import('../src/services/landingCache.js')).bumpLandingVersion; bumpV()
    const b = await page('marcioslvinc.ro')
    expect(b.text).to.include('Marcio Inc').and.to.include('+40 700 000 000').and.to.include('Bucuresti')
    expect(b.text).to.include('rating-chip')
    const a = await page('a.site.pt')
    expect(a.text).to.not.include('Marcio Inc')
    expect(a.text).to.not.include('Bucuresti')
  })

  it("the admin editor starts from the shop's own defaults", async () => {
    const r = await request(app).get('/api/admin/landing/defaults').set('Authorization', `Bearer ${tokenB}`)
    expect(r.status).to.equal(200)
    expect(r.body.neutral).to.equal(true)
    expect(r.body.content.brand.address.city).to.equal('')
    expect(JSON.stringify(r.body.content)).to.not.include('Loures')
  })
})

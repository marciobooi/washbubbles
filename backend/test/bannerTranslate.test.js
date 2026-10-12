import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers } from './setup.test-helper.js'
import { translateBanners } from '../src/services/bannerTranslate.js'
import { resetSoleTenantCache } from '../src/middleware/tenant.js'

const fake = async (strings, { target }) => strings.map((s) => (s.trim() ? `[${target}] ${s}` : s))

describe('Home banner slides are translated for the other kiosk languages', function () {
  this.timeout(20000)
  let app, tenant, Setting
  before(async () => { await startTestDb(); app = await buildTestApp(); Setting = (await import('../src/models/setting.js')).default })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); ;({ tenant } = await seedTenantAndUsers()); resetSoleTenantCache() })

  it('translates title and text of every slide into en/fr/de/es and remembers the Portuguese', async () => {
    await Setting.create({ tenantId: tenant._id, key: 'banners', value: [{ id: 'b1', title: 'Campanha de verão', text: 'Entre em contacto x@y.pt', image: 'a.png' }] })
    await translateBanners(tenant._id, { translate: fake })
    const row = await Setting.findOne({ tenantId: tenant._id, key: 'bannersTranslations' }).lean()
    const s = row.value.slides.b1
    expect(s.pt).to.deep.equal({ title: 'Campanha de verão', text: 'Entre em contacto x@y.pt' })
    for (const l of ['en', 'fr', 'de', 'es']) expect(s[l].title).to.equal(`[${l}] Campanha de verão`)
  })

  it('the kiosk can read the translations without logging in', async () => {
    await Setting.create({ tenantId: tenant._id, key: 'bannersTranslations', value: { slides: { b1: { pt: { title: 'a', text: 'b' }, en: { title: 'A', text: 'B' } } } } })
    const res = await request(app).get('/api/pos/settings/bannersTranslations')
    expect(res.status).to.equal(200)
    expect(res.body.value.slides.b1.en.title).to.equal('A')
  })
})

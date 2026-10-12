import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { translateText, translateLegal, getLegalStatus } from '../src/services/legalTranslate.js'
import { resetSoleTenantCache } from '../src/middleware/tenant.js'

// a "translator" that tags each text, so we can see exactly what was sent and what came back
const fake = async (strings, { target }) => strings.map((s) => (s.trim() ? `[${target}] ${s}` : s))

describe('Legal texts: Portuguese in, automatic translations stored for the kiosk', function () {
  this.timeout(20000)
  let app, tenant, admin, adminToken, Setting
  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Setting = (await import('../src/models/setting.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, admin } = await seedTenantAndUsers())
    adminToken = signToken(admin)
    resetSoleTenantCache()
  })

  it('keeps section markers and bullets, translating only the words', async () => {
    const out = await translateText('## 1. Âmbito\n- ponto um\n\nTexto', 'en', fake)
    expect(out.split('\n')).to.deep.equal(['## [en] 1. Âmbito', '- [en] ponto um', '', '[en] Texto'])
  })

  it('translates privacy and terms into en/fr/de and remembers the Portuguese they came from', async () => {
    await Setting.create({ tenantId: tenant._id, key: 'legal.info', value: { privacy: { pt: '## A\ntexto' }, terms: { pt: '## B\n- regra' } } })
    await translateLegal(tenant._id, { translate: fake })
    const st = await getLegalStatus(tenant._id)
    expect(st.status.state).to.equal('done')
    expect(st.translations.privacy.pt).to.equal('## A\ntexto')
    expect(st.translations.privacy.fr).to.equal('## [fr] A\n[fr] texto')
    expect(st.translations.terms.de).to.equal('## [de] B\n- [de] regra')
  })

  it('a language that fails keeps its earlier translation of the same Portuguese', async () => {
    await Setting.create({ tenantId: tenant._id, key: 'legal.info', value: { privacy: { pt: 'olá' } } })
    await translateLegal(tenant._id, { translate: fake })
    const flaky = async (strings, { target }) => { if (target === 'fr') throw new Error('down'); return fake(strings, { target }) }
    await translateLegal(tenant._id, { translate: flaky })
    const st = await getLegalStatus(tenant._id)
    expect(st.status.state).to.equal('partial')
    expect(st.translations.privacy.fr).to.equal('[fr] olá') // kept
  })

  it('the kiosk reads both settings without logging in; the admin status needs the admin', async () => {
    await Setting.create({ tenantId: tenant._id, key: 'legal.translations', value: { privacy: { pt: 'x', en: 'y' } } })
    const pub = await request(app).get('/api/pos/settings/legal.translations')
    expect(pub.status).to.equal(200)
    expect(pub.body.value.privacy.en).to.equal('y')
    const noAuth = await request(app).get('/api/admin/legal/status')
    expect(noAuth.status).to.be.oneOf([401, 403])
    const ok = await request(app).get('/api/admin/legal/status').set('Authorization', `Bearer ${adminToken}`)
    expect(ok.status).to.equal(200)
    expect(ok.body.translations.privacy.en).to.equal('y')
  })
})

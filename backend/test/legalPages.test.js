import { expect } from 'chai'
import request from 'supertest'
import express from 'express'
import { startTestDb, stopTestDb, clearTestDb, seedTenantAndUsers } from './setup.test-helper.js'
import { resetSoleTenantCache, resolveTenant } from '../src/middleware/tenant.js'
import publicRoutes, { _resetContentCacheForTests } from '../src/routes/public.js'
import * as be from '../src/services/legalDefaults.js'
import * as fe from '../../src/lib/defaultLegal.js'

describe('Website legal pages (privacy, terms, cookies) and footer links', function () {
  this.timeout(20000)
  let app, tenant, Setting
  before(async () => {
    await startTestDb()
    app = express()
    app.use(express.json())
    app.use(resolveTenant)
    app.use('/', publicRoutes)
    Setting = (await import('../src/models/setting.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); ;({ tenant } = await seedTenantAndUsers()); resetSoleTenantCache(); _resetContentCacheForTests() })

  it('the backend copy of the default texts is identical to the one the kiosk/admin use', () => {
    expect(be.DEFAULT_PRIVACY.pt).to.equal(fe.DEFAULT_PRIVACY_PT)
    expect(be.DEFAULT_PRIVACY.en).to.equal(fe.DEFAULT_PRIVACY_EN)
    expect(be.DEFAULT_TERMS.pt).to.equal(fe.DEFAULT_TERMS_PT)
    expect(be.DEFAULT_TERMS.en).to.equal(fe.DEFAULT_TERMS_EN)
  })

  it('serves the privacy policy with sections, the entity block and links, even before the admin saved anything', async () => {
    const res = await request(app).get('/legal/privacy')
    expect(res.status).to.equal(200)
    expect(res.text).to.contain('<h2>1. Quem é o responsável</h2>')
    expect(res.text).to.contain('desta página') // "janela" becomes "página" on the website
    expect(res.text).to.contain('/legal/cookies')
  })

  it('shows the admin entity details and the saved translation in the other language', async () => {
    await Setting.create({ tenantId: tenant._id, key: 'legal.info', value: { company: 'Fresh Bubbles Lda', nif: '500000000', email: 'dpo@freshbubbles.pt', privacy: { pt: '## Um\ntexto' } } })
    await Setting.create({ tenantId: tenant._id, key: 'legal.translations', value: { privacy: { pt: '## Um\ntexto', de: '## Eins\nText' } } })
    const pt = await request(app).get('/legal/privacy')
    expect(pt.text).to.contain('Fresh Bubbles Lda')
    expect(pt.text).to.contain('NIF 500000000')
    const de = await request(app).get('/de/legal/privacy')
    expect(de.status).to.equal(200)
    expect(de.text).to.contain('<h2>Eins</h2>')
  })

  it('the cookie page says what the site really does, in every language', async () => {
    for (const [path, needle] of [['/legal/cookies', 'não define cookies próprios'], ['/en/legal/cookies', 'does not set its own cookies'], ['/fr/legal/cookies', 'ne dépose pas de cookies propres'], ['/de/legal/cookies', 'setzt keine eigenen Cookies'], ['/es/legal/cookies', 'no establece cookies propias']]) {
      const r = await request(app).get(path)
      expect(r.status, path).to.equal(200)
      expect(r.text, path).to.contain(needle)
    }
  })

  it('the front page footer links to the three pages and the complaints book, and the map waits for a click', async () => {
    const res = await request(app).get('/')
    expect(res.status).to.equal(200)
    expect(res.text).to.contain('href="/legal/privacy"')
    expect(res.text).to.contain('href="/legal/terms"')
    expect(res.text).to.contain('href="/legal/cookies"')
    expect(res.text).to.contain('livroreclamacoes.pt')
    expect(res.text).to.not.match(/<iframe[^>]*google\.com\/maps/) // no Google request before the visitor asks
    expect(res.text).to.contain('id="map-show"')
  })
})

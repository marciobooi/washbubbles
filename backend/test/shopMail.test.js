import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import Setting from '../src/models/setting.js'
import { getShopMail, resetShopMailCache } from '../src/services/shopMail.js'
import { decrypt } from '../src/services/platformSettings.js'

describe("A shop's own e-mail identity: support address and its own mailbox", function () {
  this.timeout(30000)
  let app, tenant, tok, kioskKey
  before(async () => {
    await startTestDb(); await clearTestDb(); app = await buildTestApp()
    const s = await seedTenantAndUsers(); tenant = s.tenant; tok = signToken(s.admin); kioskKey = 'test-kiosk-api-key'
    resetShopMailCache()
  })
  after(async () => { await stopTestDb() })
  const h = () => ({ Authorization: `Bearer ${tok}` })

  it('saves the support address and the mailbox; the password is encrypted and never returned or listed', async () => {
    const r = await request(app).put('/api/admin/shop-mail').set(h()).send({ supportEmail: 'geral@marcioinc.pt', account: { host: 'smtp.amen.pt', port: '465', user: 'geral@marcioinc.pt', pass: 'segredo-xyz', from: 'geral@marcioinc.pt' } })
    expect(r.status).to.equal(200)
    expect(JSON.stringify(r.body)).to.not.include('segredo-xyz')
    expect(r.body.account.hasPassword).to.equal(true)
    const raw = (await Setting.findOne({ tenantId: tenant._id, key: 'shopmail.account' }).lean()).value
    expect(raw.pass).to.not.include('segredo-xyz')
    expect(decrypt(raw.pass)).to.equal('segredo-xyz')
    const list = await request(app).get('/api/admin/settings').set(h())
    expect(JSON.stringify(list.body)).to.not.include(raw.pass)
    expect((await request(app).get('/api/admin/settings/shopmail.account').set(h())).body.value).to.equal(null)
    expect((await request(app).post('/api/admin/settings').set(h()).send({ key: 'shopmail.account', value: { pass: 'x' } })).status).to.equal(400)
    expect((await getShopMail(tenant._id)).account.pass).to.equal('segredo-xyz')
  })

  it('never travels to a shop PC through the settings sync', async () => {
    const r = await request(app).get('/api/sync/pull/settings').set('Authorization', `ApiKey ${kioskKey}`)
    expect(r.status).to.equal(200)
    expect(r.body.map((s) => s.key)).to.not.include('shopmail.account')
    expect(r.body.map((s) => s.key)).to.include('support.email')
  })

  it('an empty password keeps the old one; a bad address or port is refused', async () => {
    await request(app).put('/api/admin/shop-mail').set(h()).send({ account: { host: 'smtp.novo.pt', pass: '' } })
    resetShopMailCache()
    const a = (await getShopMail(tenant._id)).account
    expect(a.host).to.equal('smtp.novo.pt'); expect(a.pass).to.equal('segredo-xyz')
    expect((await request(app).put('/api/admin/shop-mail').set(h()).send({ supportEmail: 'nope' })).status).to.equal(400)
    expect((await request(app).put('/api/admin/shop-mail').set(h()).send({ account: { port: 'abc' } })).status).to.equal(400)
  })

  it('removing the own mailbox falls back to the platform\'s; alerts go to the support address when there is no separate alerts address', async () => {
    await request(app).put('/api/admin/shop-mail').set(h()).send({ account: { clear: true } })
    resetShopMailCache()
    expect((await getShopMail(tenant._id)).account).to.equal(null)
    // alerts: no alerts.email -> the support address
    const sent = []
    const { sendAlertForTenant } = await import('../src/services/alerts.js')
    const orig = console.log; console.log = (...x) => { sent.push(x.join(' ')) }
    try { await sendAlertForTenant(tenant._id, 'Teste', 'msg') } finally { console.log = orig }
    expect(sent.join('\n')).to.include('geral@marcioinc.pt') // the (unconfigured-transport) mailer prints the recipient
  })
})

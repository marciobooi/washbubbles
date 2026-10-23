import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken } from './setup.test-helper.js'
import { getPlatform, resetPlatformCache, encrypt, decrypt } from '../src/services/platformSettings.js'
import PlatformSetting from '../src/models/platformSetting.js'

describe('Platform settings (support e-mail, mail account) in the database', function () {
  this.timeout(30000)
  let app, tok
  before(async () => { await startTestDb(); await clearTestDb(); app = await buildTestApp(); const { admin } = await seedTenantAndUsers(); tok = signToken(admin); resetPlatformCache() })
  after(async () => { resetPlatformCache(); await stopTestDb() })
  const auth = () => ({ Authorization: `Bearer ${tok}` })

  it('support e-mail defaults to the FreshBubbles mailbox, then follows what the superadmin saves', async () => {
    expect((await getPlatform()).supportEmail).to.equal('marcacoes@freshbubbles.pt')
    const r = await request(app).put('/api/admin/stores/platform').set(auth()).send({ supportEmail: 'apoio@outra.pt' })
    expect(r.status).to.equal(200)
    expect(r.body.supportEmail).to.equal('apoio@outra.pt')
    expect((await request(app).put('/api/admin/stores/platform').set(auth()).send({ supportEmail: 'lixo' })).status).to.equal(400)
  })

  it('the mail password is stored encrypted and never sent back; an empty password keeps the old one', async () => {
    const put = await request(app).put('/api/admin/stores/platform').set(auth()).send({ mail: { host: 'smtp.x.pt', port: '587', user: 'u@x.pt', pass: 'segredo-123', from: 'u@x.pt' } })
    expect(put.status).to.equal(200)
    expect(JSON.stringify(put.body)).to.not.include('segredo-123')
    expect(put.body.mail.hasPassword).to.equal(true)
    const raw = (await PlatformSetting.findOne({ key: 'mail' }).lean()).value
    expect(raw.pass).to.not.include('segredo-123')
    expect(decrypt(raw.pass)).to.equal('segredo-123')
    await request(app).put('/api/admin/stores/platform').set(auth()).send({ mail: { host: 'smtp.y.pt', pass: '' } })
    const p = await getPlatform()
    expect(p.mail.host).to.equal('smtp.y.pt')
    expect(p.mail.pass).to.equal('segredo-123')
    expect(decrypt(encrypt('x'))).to.equal('x')
  })

  it('only a superadmin', async () => {
    const User = (await import('../src/models/user.js')).default
    const t = (await import('../src/models/tenant.js')).default
    const ten = await t.findOne()
    const plain = await User.create({ tenantId: ten._id, username: 'pl', password: 'x', role: 'ADMIN' })
    expect((await request(app).get('/api/admin/stores/platform').set({ Authorization: `Bearer ${signToken(plain)}` })).status).to.equal(403)
  })
})

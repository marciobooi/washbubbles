import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers } from './setup.test-helper.js'

describe('MB WAY by QR: one code = one session (central side)', function () {
  this.timeout(20000)
  let app, kiosk, MbwayLink
  const auth = () => ({ Authorization: `ApiKey ${kiosk.apiKey}` })
  before(async () => { await startTestDb(); app = await buildTestApp(); MbwayLink = (await import('../src/models/mbwayLink.js')).default })
  after(async () => { await stopTestDb() })
  beforeEach(async () => { await clearTestDb(); ;({ kiosk } = await seedTenantAndUsers()) })

  const make = async (amount = 10.5) => (await request(app).post('/api/mbway-link/create').set(auth()).send({ amount, machines: ['Lavar 1'] })).body

  it('every code is new, hard to guess, and expires with the payment window', async () => {
    const a = await make(); const b = await make()
    expect(a.token).to.not.equal(b.token)
    expect(a.token.length).to.be.greaterThan(20)
    expect(a.url).to.contain(`/pagar/${a.token}`)
    const doc = await MbwayLink.findOne({ token: a.token })
    expect(doc.expiresAt.getTime() - Date.now()).to.be.within(4 * 60 * 1000, 5 * 60 * 1000 + 2000)
  })

  it('the phone page shows the amount; the number is accepted ONCE; the shop takes it ONCE and it is wiped', async () => {
    const { token } = await make()
    const page = await request(app).get(`/pagar/${token}`).set('Accept-Language', 'pt-PT')
    expect(page.status).to.equal(200)
    expect(page.text).to.contain('10,50')
    const en = await request(app).get(`/pagar/${token}`).set('Accept-Language', 'en-GB')
    expect(en.text).to.contain('10.50')
    expect(page.headers['x-robots-tag']).to.contain('noindex')

    expect((await request(app).post(`/api/public/mbway-link/${token}`).send({ phone: '12345' })).status).to.equal(400)
    expect((await request(app).post(`/api/public/mbway-link/${token}`).send({ phone: '912 345 678' })).status).to.equal(200)
    expect((await request(app).post(`/api/public/mbway-link/${token}`).send({ phone: '913 000 000' })).status).to.equal(410) // second try: refused
    expect((await request(app).get(`/pagar/${token}`)).status).to.equal(410)                                                 // the page is dead now

    const got = await request(app).get(`/api/mbway-link/${token}/phone`).set(auth())
    expect(got.body).to.deep.equal({ status: 'phone_received', phone: '912345678' })
    const again = await request(app).get(`/api/mbway-link/${token}/phone`).set(auth())
    expect(again.body.status).to.equal('consumed')
    expect(again.body.phone).to.equal(undefined)
    expect((await MbwayLink.findOne({ token })).phone).to.equal('')
  })

  it('giving the code up (back, cancel, error, retry) kills it for good, even with a number already typed', async () => {
    const a = await make()
    expect((await request(app).post(`/api/mbway-link/${a.token}/cancel`).set(auth()).send({})).status).to.equal(200)
    expect((await request(app).get(`/pagar/${a.token}`)).status).to.equal(410)
    expect((await request(app).post(`/api/public/mbway-link/${a.token}`).send({ phone: '912345678' })).status).to.equal(410)

    const b = await make()
    await request(app).post(`/api/public/mbway-link/${b.token}`).send({ phone: '912345678' })
    await request(app).post(`/api/mbway-link/${b.token}/cancel`).set(auth()).send({})
    const got = await request(app).get(`/api/mbway-link/${b.token}/phone`).set(auth())
    expect(got.body.status).to.equal('cancelled')
    expect((await MbwayLink.findOne({ token: b.token })).phone).to.equal('')
  })

  it('an expired code is dead, and a code of another shop is not found', async () => {
    const { token } = await make()
    await MbwayLink.updateOne({ token }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await request(app).get(`/pagar/${token}`)).status).to.equal(410)
    expect((await request(app).post(`/api/public/mbway-link/${token}`).send({ phone: '912345678' })).status).to.equal(410)
    expect((await request(app).get(`/api/mbway-link/${token}/phone`).set(auth())).body.status).to.equal('expired')
    expect((await request(app).get('/api/mbway-link/does-not-exist/phone').set(auth())).status).to.equal(404)
  })

  it('the page escapes what it prints', async () => {
    const { token } = await make()
    await MbwayLink.updateOne({ token }, { $set: { machines: ['<script>alert(1)</script>'] } })
    const page = await request(app).get(`/pagar/${token}`)
    expect(page.text).to.not.contain('<script>alert(1)</script>')
  })
})

describe('MB WAY by QR (shop side, central simulated)', function () {
  this.timeout(30000)
  let app, tenant, kiosk, Machine, Price, Sale, Setting, coinMachine, mb, link, started
  let central, createCalls
  const saved = {}
  const auth = () => ({ Authorization: `ApiKey ${kiosk.apiKey}` })
  before(async () => {
    await startTestDb(); app = await buildTestApp()
    Machine = (await import('../src/models/machine.js')).default
    Price = (await import('../src/models/price.js')).default
    Sale = (await import('../src/models/sale.js')).default
    Setting = (await import('../src/models/setting.js')).default
    coinMachine = (await import('../src/services/coinMachine.js')).default
    mb = await import('../src/services/mbway.js')
    link = await import('../src/services/mbwayLinkClient.js')
  })
  after(async () => { mb._setFetch(null); link._setFetch(null); await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb(); ;({ tenant, kiosk } = await seedTenantAndUsers())
    saved.env = { u: process.env.SYNC_SERVER_URL, k: process.env.SYNC_API_KEY }
    process.env.SYNC_SERVER_URL = 'https://central.test/api'; process.env.SYNC_API_KEY = 'k'
    saved.tenantId = coinMachine.tenantId; saved.running = coinMachine.running; saved.startPaid = coinMachine.startPaidMachine
    coinMachine.tenantId = tenant._id; coinMachine.running = true
    started = []; coinMachine.startPaidMachine = async (id) => { started.push(String(id)) }
    central = { n: 0, phone: null, cancelled: [], status: 'waiting' }; createCalls = 0
    link._setFetch(async (url, init) => {
      const j = (status, body) => ({ ok: status < 400, status, json: async () => body })
      if (url.endsWith('/mbway-link/create')) { central.n += 1; return j(201, { token: `tok-${central.n}`, url: `https://x/pagar/tok-${central.n}`, expiresAt: new Date(Date.now() + 300000).toISOString() }) }
      if (url.endsWith('/cancel')) { central.cancelled.push(url.split('/').slice(-2)[0]); return j(200, { ok: true }) }
      if (url.endsWith('/phone')) return central.phone ? j(200, { status: 'phone_received', phone: central.phone }) : j(200, { status: central.status })
      return j(404, {})
    })
    mb._setFetch(async (url) => {
      if (String(url).endsWith('/mbway/create')) { createCalls += 1; return { status: 201, json: async () => ({ transactionStatus: 'Success', transactionID: `t${createCalls}`, reference: String(500 + createCalls) }) } }
      return { status: 200, json: async () => ({ sucesso: true, estado_referencia: 'pendente' }) }
    })
    for (const [key, value] of Object.entries({ 'payments.mbway.enabled': true, 'payments.mbway.apiKey': 'demo' })) await Setting.findOneAndUpdate({ tenantId: tenant._id, key }, { $set: { value } }, { upsert: true })
    await Price.create({ tenantId: tenant._id, type: 'wash', weight: 10, cashPrice: 10.5, cardPrice: 10 })
    await Machine.create({ tenantId: tenant._id, name: 'Lavar 1', type: 'wash', weight: 10, status: 'free' })
  })
  afterEach(() => {
    coinMachine.running = saved.running; coinMachine.tenantId = saved.tenantId; coinMachine.startPaidMachine = saved.startPaid
    process.env.SYNC_SERVER_URL = saved.env.u; process.env.SYNC_API_KEY = saved.env.k
  })
  const items = async () => [{ _id: String((await Machine.findOne({ name: 'Lavar 1' }))._id) }]
  const mkLink = async () => request(app).post('/api/gateways/mbway/link').set(auth()).send({ items: await items(), batchId: 'b-qr' })

  it('a QR is made for the server-priced cart, nothing is asked of Eupago until the number arrives, then ONE request starts', async () => {
    const l = await mkLink()
    expect(l.status).to.equal(201)
    expect(l.body.amount).to.equal(10.5)
    expect(l.body.url).to.contain('/pagar/')
    const w = await request(app).get(`/api/gateways/mbway/link/${l.body.token}`).set(auth())
    expect(w.body.status).to.equal('waiting')
    expect(createCalls).to.equal(0)
    central.phone = '912345678'
    const s = await request(app).get(`/api/gateways/mbway/link/${l.body.token}`).set(auth())
    expect(s.body.status).to.equal('started')
    expect(s.body.payment.amount).to.equal(10.5)
    expect(createCalls).to.equal(1)
    central.phone = null
    const again = await request(app).get(`/api/gateways/mbway/link/${l.body.token}`).set(auth())
    expect(again.body.status).to.equal('started')
    expect(createCalls).to.equal(1) // asked again: no second payment
  })

  it('every QR is new (a retry never reuses the old one) and giving one up cancels it at the central', async () => {
    const a = await mkLink(); const b = await mkLink()
    expect(a.body.token).to.not.equal(b.body.token)
    await request(app).post(`/api/gateways/mbway/link/${a.body.token}/cancel`).set(auth()).send({})
    expect(central.cancelled).to.include(a.body.token)
    const after = await request(app).get(`/api/gateways/mbway/link/${a.body.token}`).set(auth())
    expect(after.status).to.equal(404) // gone from the shop too
  })

  it('a recharge in the cart, or MB WAY switched off, never gets a QR', async () => {
    const r = await request(app).post('/api/gateways/mbway/link').set(auth()).send({ items: [{ id: 'recharge-1', type: 'Recarga de Cartão', amount: 10 }], batchId: 'x' })
    expect(r.status).to.equal(400)
    await Setting.updateOne({ tenantId: tenant._id, key: 'payments.mbway.enabled' }, { $set: { value: false } })
    const off = await mkLink()
    expect(off.status).to.equal(409)
    expect(central.n).to.equal(0) // the central was not even asked
  })

  it('a number the shop cannot use ends the session and the code is cancelled', async () => {
    const l = await mkLink()
    central.phone = '912345678'
    await Machine.updateOne({ name: 'Lavar 1' }, { $set: { status: 'working' } }) // taken meanwhile
    const r = await request(app).get(`/api/gateways/mbway/link/${l.body.token}`).set(auth())
    expect(r.body.status).to.equal('error')
    expect(central.cancelled).to.include(l.body.token)
    expect(createCalls).to.equal(0)
  })
})

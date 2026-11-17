import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers } from './setup.test-helper.js'
import { normalizePhone, maskPhone, normalizeState } from '../src/services/eupago.js'

describe('Eupago helpers', () => {
  it('accepts a Portuguese mobile number in the usual spellings, and nothing else', () => {
    for (const ok of ['912345678', '+351 912 345 678', '00351912345678', '351912345678']) expect(normalizePhone(ok)).to.equal('912345678')
    for (const bad of ['', '12345', '812345678', '9123456789', 'abc', '212345678']) expect(normalizePhone(bad)).to.equal('')
    expect(maskPhone('912345678')).to.equal('9•• ••• 678')
  })
  it('only "paid" words mean paid; anything unknown is pending, never paid', () => {
    expect(normalizeState('paga')).to.equal('paid')
    expect(normalizeState('transferida')).to.equal('paid')
    expect(normalizeState('pendente')).to.equal('pending')
    expect(normalizeState('qualquer coisa')).to.equal('pending')
    expect(normalizeState(undefined)).to.equal('pending')
    expect(normalizeState('expirada')).to.equal('failed')
  })
})

describe('MB WAY payment (Eupago, simulated)', function () {
  this.timeout(30000)
  let app, tenant, kiosk, Machine, Price, Sale, Setting, MbwayPayment, coinMachine, mb
  let calls, state, createReply, started
  const saved = {}
  const auth = () => ({ Authorization: `ApiKey ${kiosk.apiKey}` })

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Machine = (await import('../src/models/machine.js')).default
    Price = (await import('../src/models/price.js')).default
    Sale = (await import('../src/models/sale.js')).default
    Setting = (await import('../src/models/setting.js')).default
    MbwayPayment = (await import('../src/models/mbwayPayment.js')).default
    coinMachine = (await import('../src/services/coinMachine.js')).default
    mb = await import('../src/services/mbway.js')
  })
  after(async () => { mb._setFetch(null); await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, kiosk } = await seedTenantAndUsers())
    saved.tenantId = coinMachine.tenantId; saved.running = coinMachine.running; saved.startPaid = coinMachine.startPaidMachine
    coinMachine.tenantId = tenant._id
    coinMachine.running = true
    started = []
    coinMachine.startPaidMachine = async (id) => { if (coinMachine.__busy) throw new Error('machine busy'); started.push(String(id)) }
    coinMachine.__busy = false
    calls = []; state = 'pendente'; createReply = { status: 201, body: { transactionStatus: 'Success', transactionID: 'tx-1', reference: '408125' } }
    mb._setFetch(async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization })
      if (String(url).endsWith('/mbway/create')) return { status: createReply.status, json: async () => createReply.body }
      return { status: 200, json: async () => ({ sucesso: true, referencia: '408125', estado_referencia: state }) }
    })
    await Price.create({ tenantId: tenant._id, type: 'wash', weight: 10, cashPrice: 10.5, cardPrice: 10 })
    await Machine.create({ tenantId: tenant._id, name: 'Lavar 1', type: 'wash', weight: 10, status: 'free' })
  })
  afterEach(() => {
    coinMachine.running = saved.running; coinMachine.tenantId = saved.tenantId; coinMachine.startPaidMachine = saved.startPaid
    delete coinMachine.__busy
  })

  const turnOn = async (extra = {}) => {
    const rows = { 'payments.mbway.enabled': true, 'payments.mbway.apiKey': 'demo-key', 'payments.mbway.env': 'sandbox', ...extra }
    for (const [key, value] of Object.entries(rows)) await Setting.findOneAndUpdate({ tenantId: tenant._id, key }, { $set: { value } }, { upsert: true })
  }
  const machineId = async () => String((await Machine.findOne({ name: 'Lavar 1' }))._id)
  const start = async (body = {}) => request(app).post('/api/gateways/mbway/start').set(auth()).send({ phone: '912345678', batchId: 'b-1', items: [{ _id: await machineId() }], ...body })

  it('is OFF by default: no setting, no MB WAY', async () => {
    const cfg = await request(app).get('/api/gateways/mbway/config').set(auth())
    expect(cfg.body.enabled).to.equal(false)
    const r = await start()
    expect(r.status).to.equal(409)
    expect(r.body.code).to.equal('mbway-off')
    expect(calls).to.have.length(0) // Eupago was never called
  })

  it('on from the admin: the price comes from the server, Eupago is asked, nothing starts until it says paid, then ONE start and ONE sale', async () => {
    await turnOn()
    expect((await request(app).get('/api/gateways/mbway/config').set(auth())).body.enabled).to.equal(true)
    const s = await start({ items: [{ _id: await machineId(), price: 0.01 }] }) // the screen's price is ignored
    expect(s.status).to.equal(201)
    expect(s.body.amount).to.equal(10.5)
    expect(s.body.status).to.equal('pending')
    const create = calls.find((c) => c.url.endsWith('/mbway/create'))
    expect(create.url.startsWith('https://sandbox.eupago.pt')).to.equal(true)
    expect(create.auth).to.equal('ApiKey demo-key')
    expect(create.body.payment.amount.value).to.equal(10.5)
    expect(create.body.payment.customerPhone).to.equal('912345678')

    const p1 = await request(app).get(`/api/gateways/mbway/${s.body.id}`).set(auth())
    expect(p1.body.status).to.equal('pending')
    expect(started).to.have.length(0)
    expect(await Sale.countDocuments({})).to.equal(0)

    state = 'paga'
    await MbwayPayment.updateOne({ _id: s.body.id }, { $set: { lastPolledAt: new Date(0) } })
    const p2 = await request(app).get(`/api/gateways/mbway/${s.body.id}`).set(auth())
    expect(p2.body.status).to.equal('started')
    expect(started).to.have.length(1)
    const sales = await Sale.find({})
    expect(sales).to.have.length(1)
    expect(sales[0].method).to.equal('mbway')
    expect(sales[0].amount).to.equal(10.5)
    expect((await Machine.findOne({ name: 'Lavar 1' })).status).to.equal('working')
    // the flow shows what was paid ONCE (10.5, not 21: the paid step and the sale step both used to add it)
    const flows = await import('../src/services/flows.js')
    expect(flows._peek(tenant._id)?.amount).to.equal(10.5)

    // asking again never starts or books a second time
    await MbwayPayment.updateOne({ _id: s.body.id }, { $set: { lastPolledAt: new Date(0) } })
    await request(app).get(`/api/gateways/mbway/${s.body.id}`).set(auth())
    expect(started).to.have.length(1)
    expect(await Sale.countDocuments({})).to.equal(1)
  })

  it('pays machines only: a recharge in the cart, a bad phone, an amount below 1 EUR are refused before Eupago is asked', async () => {
    await turnOn()
    const r1 = await start({ items: [{ id: 'recharge-1', type: 'Recarga de Cartão', amount: 10, price: 10 }] })
    expect(r1.status).to.equal(400); expect(r1.body.code).to.equal('mbway-machines-only')
    const r2 = await start({ phone: '12345' })
    expect(r2.status).to.equal(400); expect(r2.body.code).to.equal('bad-phone')
    await Price.updateOne({ tenantId: tenant._id, type: 'wash' }, { $set: { cashPrice: 0.5 } })
    const r3 = await start()
    expect(r3.status).to.equal(400); expect(r3.body.code).to.equal('below-minimum')
    expect(calls).to.have.length(0)
  })

  it('Eupago refusing the request leaves a failed row and an error for the customer', async () => {
    await turnOn()
    createReply = { status: 400, body: { transactionStatus: 'Rejected', code: 'AMOUNT_INVALID', text: 'Amount value is invalid' } }
    const r = await start()
    expect(r.status).to.equal(502)
    expect((await MbwayPayment.findOne({})).status).to.equal('failed')
  })

  it('paid but the machine cannot start: the row says so (money to give back), nothing is booked', async () => {
    await turnOn()
    const s = await start()
    coinMachine.__busy = true
    state = 'paga'
    await MbwayPayment.updateOne({ _id: s.body.id }, { $set: { lastPolledAt: new Date(0) } })
    const p = await request(app).get(`/api/gateways/mbway/${s.body.id}`).set(auth())
    expect(p.body.status).to.equal('start_failed')
    expect(p.body.error).to.contain('10.50')
    expect(await Sale.countDocuments({})).to.equal(0)
  })

  it('the customer cancels, then pays anyway: found by the sweeper and reported, never silently kept', async () => {
    await turnOn()
    const s = await start()
    const c = await request(app).post(`/api/gateways/mbway/${s.body.id}/cancel`).set(auth())
    expect(c.body.status).to.equal('cancelled')
    state = 'paga'
    await MbwayPayment.updateOne({ _id: s.body.id }, { $set: { lastPolledAt: new Date(0) } })
    await mb.sweep()
    expect((await MbwayPayment.findById(s.body.id)).status).to.equal('paid_unclaimed')
    expect(started).to.have.length(0)
  })

  it('an unpaid request is left alone while the window is open, and expires after it', async () => {
    await turnOn()
    const s = await start()
    await MbwayPayment.updateOne({ _id: s.body.id }, { $set: { expiresAt: new Date(Date.now() - 2 * 60 * 1000), lastPolledAt: new Date(0) } })
    const p = await request(app).get(`/api/gateways/mbway/${s.body.id}`).set(auth())
    expect(p.body.status).to.equal('expired')
  })

  it('the machine only starts when Eupago says paid: pending, refused, expired and cancelled all leave it FREE and untouched', async () => {
    await turnOn()
    for (const outcome of ['pendente', 'expirada', 'cancelada']) {
      await MbwayPayment.deleteMany({})
      state = outcome
      const s = await start()
      expect(s.status, outcome).to.equal(201)
      await MbwayPayment.updateOne({ _id: s.body.id }, { $set: { lastPolledAt: new Date(0) } })
      await request(app).get(`/api/gateways/mbway/${s.body.id}`).set(auth())
      expect(started, outcome).to.have.length(0)
      expect((await Machine.findOne({ name: 'Lavar 1' })).status, outcome).to.equal('free')
    }
    // cancelled at the kiosk
    await MbwayPayment.deleteMany({})
    state = 'pendente'
    const s = await start()
    await request(app).post(`/api/gateways/mbway/${s.body.id}/cancel`).set(auth())
    expect(started).to.have.length(0)
    expect((await Machine.findOne({ name: 'Lavar 1' })).status).to.equal('free')
    expect(await Sale.countDocuments({})).to.equal(0)
  })

  it('a machine with an MB WAY request waiting cannot be sold to anyone else (cash, a second MB WAY); once it is over it is free again', async () => {
    await turnOn()
    const s = await start()
    expect(s.status).to.equal(201)
    const second = await start({ batchId: 'b-2' })
    expect(second.status).to.equal(409)
    coinMachine.client.client.balance = 20 // cash really inserted, so the refusal below is the reservation and nothing else
    const cash = await request(app).post('/api/gateways/cash/pay').set(auth()).send({ items: [{ _id: await machineId() }], inserted: 10.5, batchId: 'b-cash' })
    expect(cash.status).to.equal(409)
    expect(cash.body.code).to.equal('mbway-in-progress')
    coinMachine.client.client.balance = 0
    await request(app).post(`/api/gateways/mbway/${s.body.id}/cancel`).set(auth())
    const again = await start({ batchId: 'b-3' }) // typed the number wrong: cancel and try again is allowed
    expect(again.status).to.equal(201)
  })

  it('what the customer saw is what is charged: another total is refused and Eupago is never asked', async () => {
    await turnOn()
    const r = await start({ expectedAmount: 9.5 })
    expect(r.status).to.equal(409)
    expect(r.body.code).to.equal('price-changed')
    expect(calls).to.have.length(0)
    const ok = await start({ expectedAmount: 10.5 })
    expect(ok.status).to.equal(201)
  })

  it('no extra credit, no change, no card touched: cash already in the machine stays as it was, nothing is dispensed, the amount is exactly the price', async () => {
    await turnOn()
    const Card = (await import('../src/models/card.js')).default
    await Card.create({ tenantId: tenant._id, code: 'C-1', balance: 7, status: 'active' })
    coinMachine.client.client.balance = 5
    coinMachine.client.updateCredits()
    let dispensed = 0
    const savedMw = coinMachine.middleware
    coinMachine.middleware = { ...(savedMw || {}), dispenseChange: async () => { dispensed += 1; return { success: true } } }
    const s = await start()
    state = 'paga'
    await MbwayPayment.updateOne({ _id: s.body.id }, { $set: { lastPolledAt: new Date(0) } })
    const p = await request(app).get(`/api/gateways/mbway/${s.body.id}`).set(auth())
    coinMachine.middleware = savedMw
    expect(p.body.status).to.equal('started')
    expect(dispensed).to.equal(0)
    expect(coinMachine.client.getState().balance).to.equal(5)          // the cash inserted by someone else is untouched
    expect((await Card.findOne({ code: 'C-1' })).balance).to.equal(7) // no card credit, no card debit
    const sale = await Sale.findOne({})
    expect(sale.amount).to.equal(10.5)
    expect(sale.inserted).to.equal(0)
    expect(sale.change).to.equal(0)
    expect(sale.type).to.equal('payment')
    expect(await Sale.countDocuments({ type: 'recharge' })).to.equal(0)
    coinMachine.client.client.balance = 0
  })
})

describe('Eupago state words', () => {
  it('knows the words it has seen or expects, and flags any other', async () => {
    const { isKnownState } = await import('../src/services/eupago.js')
    for (const w of ['pendente', 'paga', 'expirada', 'Paid']) expect(isKnownState(w), w).to.equal(true)
    for (const w of ['liquidada', '', undefined, 'xyz']) expect(isKnownState(w), String(w)).to.equal(false)
  })
})

describe('Eupago does not answer', function () {
  this.timeout(30000)
  it('a broken call is reported as uncertain, never as a clean refusal', async () => {
    const { createMbway } = await import('../src/services/eupago.js')
    const r = await createMbway({ env: 'sandbox', apiKey: 'k', amount: 5, phone: '912345678', identifier: 'x', fetchImpl: async () => { throw new Error('socket hang up') } })
    expect(r.ok).to.equal(false)
    expect(r.uncertain).to.equal(true)
    const refused = await createMbway({ env: 'sandbox', apiKey: 'k', amount: 5, phone: '912345678', identifier: 'x', fetchImpl: async () => ({ status: 400, json: async () => ({ code: 'AMOUNT_INVALID', text: 'bad' }) }) })
    expect(refused.uncertain).to.equal(undefined)
    expect(refused.code).to.equal('AMOUNT_INVALID')
  })
})

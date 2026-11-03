import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers } from './setup.test-helper.js'

describe('MB WAY for a new card and for a card recharge', function () {
  this.timeout(30000)
  let app, tenant, kiosk, Setting, Sale, Card, CardPurchase, Peripheral, MbwayPayment, coinMachine, mb
  let calls, state, dispensed, dispenseFails
  const saved = {}
  const auth = () => ({ Authorization: `ApiKey ${kiosk.apiKey}` })

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Setting = (await import('../src/models/setting.js')).default
    Sale = (await import('../src/models/sale.js')).default
    Card = (await import('../src/models/card.js')).default
    CardPurchase = (await import('../src/models/cardPurchase.js')).default
    Peripheral = (await import('../src/models/peripheral.js')).default
    MbwayPayment = (await import('../src/models/mbwayPayment.js')).default
    coinMachine = (await import('../src/services/coinMachine.js')).default
    mb = await import('../src/services/mbway.js')
  })
  after(async () => { mb._setFetch(null); await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, kiosk } = await seedTenantAndUsers())
    saved.tenantId = coinMachine.tenantId; saved.running = coinMachine.running; saved.dispense = coinMachine.dispenseNewCard
    saved.cardNumber = coinMachine.client.client.cardNumber
    coinMachine.tenantId = tenant._id
    coinMachine.running = true
    dispensed = 0; dispenseFails = false
    coinMachine.dispenseNewCard = async () => { if (dispenseFails) throw new Error('no card in the dispenser'); dispensed++ }
    calls = []; state = 'pendente'
    mb._setFetch(async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null })
      if (String(url).endsWith('/mbway/create')) return { status: 201, json: async () => ({ transactionStatus: 'Success', transactionID: 'tx-9', reference: '555001' }) }
      return { status: 200, json: async () => ({ sucesso: true, referencia: '555001', estado_referencia: state }) }
    })
    for (const [key, value] of Object.entries({ 'payments.mbway.enabled': true, 'payments.mbway.apiKey': 'demo-key', 'payments.mbway.env': 'sandbox', 'loyaltyCard.cost': 5, 'loyaltyCard.credit': 5 })) {
      await Setting.create({ tenantId: tenant._id, key, value })
    }
    await Peripheral.create({ tenantId: tenant._id, name: 'Disp. de Cartoes', type: 'card_dispenser', enabled: true })
  })
  afterEach(() => { coinMachine.running = saved.running; coinMachine.tenantId = saved.tenantId; coinMachine.dispenseNewCard = saved.dispense; coinMachine.client.client.cardNumber = saved.cardNumber })

  const start = (body) => request(app).post('/api/gateways/mbway/start').set(auth()).send({ phone: '912345678', batchId: 'b-card', ...body })
  const poll = async (id) => { await MbwayPayment.updateOne({ _id: id }, { $set: { lastPolledAt: new Date(0) } }); return request(app).get(`/api/gateways/mbway/${id}`).set(auth()) }
  const customer = { name: 'Ana Silva', email: 'ana@example.com', phone: '912000000', contribuinte: '123456789', privacyConsent: true, marketingOptIn: false }

  describe('a new card', () => {
    it('is priced from the shop settings; nothing is sold until Eupago says paid; then ONE card, ONE sale, and the details are wiped', async () => {
      const s = await start({ kind: 'card_purchase', customer, amount: 0.01 }) // the screen's amount is ignored
      expect(s.status).to.equal(201)
      expect(s.body.amount).to.equal(5)
      expect(calls.find((c) => c.url.endsWith('/mbway/create')).body.payment.amount.value).to.equal(5)
      expect((await poll(s.body.id)).body.status).to.equal('pending')
      expect(dispensed).to.equal(0)
      expect(await Card.countDocuments({})).to.equal(0)

      state = 'paga'
      const paid = await poll(s.body.id)
      expect(paid.body.status).to.equal('started')
      expect(paid.body.card.code).to.match(/^\d{10}$/)
      expect(paid.body.card.status).to.equal('pending_write')
      expect(dispensed).to.equal(1)
      const card = await Card.findOne({})
      expect(card).to.include({ name: 'Ana Silva', email: 'ana@example.com', status: 'pending_write', balance: 5 })
      const sale = await Sale.findOne({})
      expect(sale).to.include({ type: 'card_purchase', method: 'mbway', amount: 5 })
      expect((await CardPurchase.findOne({})).paymentMethod).to.equal('mbway')
      const row = await MbwayPayment.findById(s.body.id).lean()
      expect(row.payload.customer).to.deep.equal({}) // the personal details are not kept

      await poll(s.body.id) // asking again never sells a second card
      expect(dispensed).to.equal(1)
      expect(await Card.countDocuments({})).to.equal(1)
    })

    it('is refused BEFORE Eupago is asked when there is no dispenser or no price', async () => {
      await Peripheral.deleteMany({})
      const r1 = await start({ kind: 'card_purchase', customer })
      expect(r1.status).to.equal(409); expect(r1.body.code).to.equal('no-dispenser')
      await Peripheral.create({ tenantId: tenant._id, name: 'D', type: 'card_dispenser', enabled: true })
      await Setting.deleteOne({ tenantId: tenant._id, key: 'loyaltyCard.cost' })
      const r2 = await start({ kind: 'card_purchase', customer })
      expect(r2.status).to.equal(409); expect(r2.body.code).to.equal('card-price-missing')
      expect(calls).to.have.length(0)
    })

    it('paid but the dispenser gives no card: the row says so (refund by hand), no card or sale is booked, the details are wiped', async () => {
      const s = await start({ kind: 'card_purchase', customer })
      dispenseFails = true; state = 'paga'
      const r = await poll(s.body.id)
      expect(r.body.status).to.equal('start_failed')
      expect(r.body.error).to.match(/Pago, mas o cartão não saiu/)
      expect(await Card.countDocuments({})).to.equal(0)
      expect(await Sale.countDocuments({})).to.equal(0)
      expect((await MbwayPayment.findById(s.body.id).lean()).payload.customer).to.deep.equal({})
    })
  })

  describe('a recharge', () => {
    beforeEach(async () => {
      await Card.create({ tenantId: tenant._id, code: 'CARD-A', balance: 3, status: 'active' })
      await Card.create({ tenantId: tenant._id, code: 'CARD-B', balance: 9, status: 'active' })
      coinMachine.client.client.cardNumber = 'CARD-A'
    })

    it('adds exactly the paid amount to the card in the reader once Eupago says paid, and books ONE recharge sale', async () => {
      const s = await start({ kind: 'recharge', amount: 10, cardCode: 'CARD-B' }) // the screen names another card: the one in the reader wins/refuses
      expect(s.status).to.equal(409); expect(s.body.code).to.equal('no-card')
      const ok = await start({ kind: 'recharge', amount: 10, cardCode: 'CARD-A' })
      expect(ok.status).to.equal(201); expect(ok.body.amount).to.equal(10)
      expect((await Card.findOne({ code: 'CARD-A' })).balance).to.equal(3)
      state = 'paga'
      const paid = await poll(ok.body.id)
      expect(paid.body.status, paid.body.error).to.equal('started')
      expect(paid.body.card.balance).to.equal(13)
      expect((await Card.findOne({ code: 'CARD-A' })).balance).to.equal(13)
      expect((await Card.findOne({ code: 'CARD-B' })).balance).to.equal(9) // nobody else's card is touched
      const sale = await Sale.findOne({})
      expect(sale).to.include({ type: 'recharge', method: 'mbway', amount: 10, cardCode: 'CARD-A' })
      await poll(ok.body.id)
      expect((await Card.findOne({ code: 'CARD-A' })).balance).to.equal(13) // never twice
      expect(await Sale.countDocuments({})).to.equal(1)
    })

    it('needs a card in the reader, a sensible amount, and is not mixed with machines', async () => {
      coinMachine.client.client.cardNumber = null
      const a = await start({ kind: 'recharge', amount: 10 })
      expect(a.status).to.equal(409); expect(a.body.code).to.equal('no-card')
      coinMachine.client.client.cardNumber = 'CARD-A'
      expect((await start({ kind: 'recharge', amount: 0.5 })).body.code).to.equal('below-minimum')
      expect((await start({ kind: 'recharge', amount: 500 })).body.code).to.equal('above-maximum')
      expect((await start({ kind: 'recharge', amount: 'abc' })).body.code).to.equal('below-minimum')
      const mixed = await start({ items: [{ id: 'recharge-1', type: 'Recarga de Cartão', amount: 10 }] })
      expect(mixed.status).to.equal(400); expect(mixed.body.code).to.equal('mbway-machines-only')
      expect(calls).to.have.length(0)
    })
  })

  it('is still OFF by default for the new kinds (no setting, no MB WAY)', async () => {
    await Setting.deleteOne({ tenantId: tenant._id, key: 'payments.mbway.enabled' })
    const r = await start({ kind: 'card_purchase', customer })
    expect(r.status).to.equal(409); expect(r.body.code).to.equal('mbway-off')
  })
})

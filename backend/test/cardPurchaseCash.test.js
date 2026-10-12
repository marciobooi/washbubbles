import { expect } from 'chai'
import request from 'supertest'
import {
  startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers, signToken,
} from './setup.test-helper.js'

describe('Card purchase on the shop PC charges the cash really inserted', function () {
  this.timeout(20000)
  let app, tenant, kiosk, kioskToken, coinMachine, Setting, Peripheral, Sale
  const saved = {}

  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    coinMachine = (await import('../src/services/coinMachine.js')).default
    Setting = (await import('../src/models/setting.js')).default
    Peripheral = (await import('../src/models/peripheral.js')).default
    Sale = (await import('../src/models/sale.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, kiosk } = await seedTenantAndUsers())
    kioskToken = signToken(kiosk)
    await Setting.create({ tenantId: tenant._id, key: 'loyaltyCard.cost', value: 5 })
    await Setting.create({ tenantId: tenant._id, key: 'loyaltyCard.credit', value: 5 })
    saved.running = coinMachine.running
    saved.dispense = coinMachine.dispenseNewCard
    saved.tenantId = coinMachine.tenantId
    coinMachine.running = true
    coinMachine.tenantId = tenant._id
    coinMachine.client.client.balance = 0
    coinMachine.dispenseNewCard = async () => ({ success: true })
  })
  afterEach(() => {
    coinMachine.running = saved.running
    coinMachine.dispenseNewCard = saved.dispense
    coinMachine.tenantId = saved.tenantId
    coinMachine.client.client.balance = 0
  })

  it('refuses when the cash is not in, even if the screen says it is (a pressed "20" button)', async () => {
    await Peripheral.create({ tenantId: tenant._id, name: 'Dispenser', type: 'card_dispenser', enabled: true, status: 'ok' })
    const res = await request(app).post('/api/pos/card/purchase').set('Authorization', `Bearer ${kioskToken}`).send({ inserted: 20 })
    expect(res.status).to.equal(409)
    expect(res.body.error).to.match(/Insufficient cash inserted/)
    expect(await Sale.countDocuments({ type: 'card_purchase' })).to.equal(0)
  })

  it('records when the holder authorised the processing of their details, on the card and on the sale', async () => {
    await Peripheral.create({ tenantId: tenant._id, name: 'Dispenser', type: 'card_dispenser', enabled: true, status: 'ok' })
    const Card = (await import('../src/models/card.js')).default
    coinMachine.client.client.balance = 5
    const before = Date.now()
    const res = await request(app).post('/api/pos/card/purchase').set('Authorization', `Bearer ${kioskToken}`)
      .send({ inserted: 5, customerName: 'Maria', customerEmail: 'maria@example.com', customerPrivacyConsent: true })
    expect(res.status).to.equal(200)
    const card = await Card.findOne({ email: 'maria@example.com' })
    expect(card.privacyConsentAt).to.be.instanceOf(Date)
    expect(card.privacyConsentAt.getTime()).to.be.at.least(before - 1000)
    const sale = await Sale.findOne({ type: 'card_purchase' })
    expect(new Date(sale.metadata.privacyConsentAt).getTime()).to.equal(card.privacyConsentAt.getTime())
  })

  it('stores no consent date when nothing was authorised', async () => {
    await Peripheral.create({ tenantId: tenant._id, name: 'Dispenser', type: 'card_dispenser', enabled: true, status: 'ok' })
    const Card = (await import('../src/models/card.js')).default
    coinMachine.client.client.balance = 5
    const res = await request(app).post('/api/pos/card/purchase').set('Authorization', `Bearer ${kioskToken}`).send({ inserted: 5 })
    expect(res.status).to.equal(200)
    const card = await Card.findOne({})
    expect(card.privacyConsentAt).to.equal(null)
  })

  it('charges the cash in the session, takes it out of the session, and the change is what is above the price', async () => {
    await Peripheral.create({ tenantId: tenant._id, name: 'Dispenser', type: 'card_dispenser', enabled: true, status: 'ok' })
    coinMachine.client.client.balance = 10
    const res = await request(app).post('/api/pos/card/purchase').set('Authorization', `Bearer ${kioskToken}`).send({ inserted: 50 })
    expect(res.status).to.equal(200)
    const sale = await Sale.findOne({ type: 'card_purchase' })
    expect(sale.amount).to.equal(5)
    expect(sale.inserted).to.equal(10) // not the 50 the screen claimed
    expect(sale.change).to.equal(5)
    expect(coinMachine.client.getState().balance).to.equal(0)
  })
})

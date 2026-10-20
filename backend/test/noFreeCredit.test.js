import { expect } from 'chai'
import request from 'supertest'
import { startTestDb, stopTestDb, clearTestDb, buildTestApp, seedTenantAndUsers } from './setup.test-helper.js'

// 2026-10-20: two recharges of 10 EUR were credited to cards with nothing paid (a recharge in the cart, paid "with the card").
describe('no card credit without cash really inserted', function () {
  this.timeout(20000)
  let app, tenant, kiosk, Card, Machine, coinMachine, saved
  const auth = () => ({ Authorization: `ApiKey ${kiosk.apiKey}` })
  before(async () => {
    await startTestDb()
    app = await buildTestApp()
    Card = (await import('../src/models/card.js')).default
    Machine = (await import('../src/models/machine.js')).default
    coinMachine = (await import('../src/services/coinMachine.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant, kiosk } = await seedTenantAndUsers())
    saved = { running: coinMachine.running, tenantId: coinMachine.tenantId, balance: coinMachine.client.client.balance }
    coinMachine.tenantId = tenant._id
    coinMachine.running = true
    coinMachine.client.client.balance = 0 // nothing inserted
    await Card.create({ tenantId: tenant._id, code: 'C-FREE', balance: 2, status: 'active' })
  })
  afterEach(() => {
    coinMachine.running = saved.running
    coinMachine.tenantId = saved.tenantId
    coinMachine.client.client.balance = saved.balance
  })

  it('a card payment carrying a recharge is refused and the balance does not move', async () => {
    const r = await request(app).post('/api/gateways/card/pay').set(auth())
      .send({ cardCode: 'C-FREE', batchId: 'b1', items: [{ id: 'recharge-1', type: 'Recarga de Cartão', amount: 10, price: 10 }] })
    expect(r.status).to.equal(400)
    expect(r.body.code).to.equal('recharge-needs-cash')
    expect((await Card.findOne({ code: 'C-FREE' })).balance).to.equal(2)
  })

  it('a top-up with no cash in the machine is refused; with the cash it is paid out of the session', async () => {
    const no = await request(app).post('/api/gateways/cards/C-FREE/topup').set(auth()).send({ amount: 10, batchId: 'b2' })
    expect(no.status).to.equal(409)
    expect((await Card.findOne({ code: 'C-FREE' })).balance).to.equal(2)
    coinMachine.client.client.balance = 10
    coinMachine.client.updateCredits()
    const yes = await request(app).post('/api/gateways/cards/C-FREE/topup').set(auth()).send({ amount: 10, batchId: 'b3' })
    expect(yes.status).to.equal(200)
    expect((await Card.findOne({ code: 'C-FREE' })).balance).to.equal(12)
    expect(coinMachine.client.getState().balance).to.equal(0) // the cash is spent: it cannot pay a second top-up
    const again = await request(app).post('/api/gateways/cards/C-FREE/topup').set(auth()).send({ amount: 10, batchId: 'b4' })
    expect(again.status).to.equal(409)
  })

  it('a cash payment cannot claim more cash than the machine really holds', async () => {
    const m = await Machine.create({ tenantId: tenant._id, name: 'Lavar 9', type: 'wash', number: 9, status: 'free' })
    const r = await request(app).post('/api/gateways/cash/pay').set(auth())
      .send({ items: [{ id: 'recharge-2', type: 'Recarga de Cartão', amount: 10, price: 10 }], cardCode: 'C-FREE', inserted: 10, batchId: 'b5' })
    expect(r.status).to.equal(409)
    expect(r.body.code).to.equal('cash-not-inserted')
    expect((await Card.findOne({ code: 'C-FREE' })).balance).to.equal(2)
    expect(m).to.exist
  })
})

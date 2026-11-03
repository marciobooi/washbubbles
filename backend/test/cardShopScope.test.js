import { expect } from 'chai'
import { startTestDb, stopTestDb, clearTestDb, seedTenantAndUsers } from './setup.test-helper.js'
import Client from '../src/services/client.js'
import Card from '../src/models/card.js'
import Tenant from '../src/models/tenant.js'

describe('A kiosk only ever reads and writes its own shop\'s cards, even when two shops use the same card number', function () {
  this.timeout(20000)
  let tA, tB
  before(async () => { await startTestDb(); await clearTestDb(); ;({ tenant: tA } = await seedTenantAndUsers()); tB = await Tenant.create({ name: 'B', slug: 'b-shop' }) })
  after(async () => { await stopTestDb() })

  it('loads and saves shop A\'s card without touching shop B\'s card with the same number', async () => {
    await Card.collection.insertMany([
      { tenantId: tA._id, code: 'SAME-1', balance: 10, bonus: 0, status: 'active', createdAt: new Date() },
      { tenantId: tB._id, code: 'SAME-1', balance: 50, bonus: 0, status: 'active', createdAt: new Date() },
    ])
    const c = new Client(() => tB._id)
    expect(await c.setClientInfoByCard('SAME-1')).to.equal(true)
    c.deductCredits(5)
    await c.saveCardBalance()
    expect((await Card.collection.findOne({ tenantId: tB._id, code: 'SAME-1' })).balance).to.equal(45)
    expect((await Card.collection.findOne({ tenantId: tA._id, code: 'SAME-1' })).balance).to.equal(10)
  })

  it('with no shop resolved it touches no card at all', async () => {
    const c = new Client()
    expect(await c.setClientInfoByCard('SAME-1')).to.equal(false)
  })
})

describe('Cash left over when the card is taken out', function () {
  this.timeout(20000)
  let t
  before(async () => { await startTestDb(); await clearTestDb(); ;({ tenant: t } = await seedTenantAndUsers()) })
  after(async () => { await stopTestDb() })

  it('stays as credit (not loaded on the card) when autoCharge is off, and is loaded when it is on', async () => {
    await Card.collection.insertOne({ tenantId: t._id, code: 'AC-1', balance: 5, bonus: 0, status: 'active', createdAt: new Date() })
    for (const [on, expected, credit] of [[false, 5, 15], [true, 20, 0]]) {
      await Card.collection.updateOne({ code: 'AC-1' }, { $set: { balance: 5 } })
      const c = new Client(() => t._id, () => on)
      await c.setClientInfoByCard('AC-1')
      c.addToBalance(15) // cash put in while the card is in the reader
      await c.resetCardInfo() // the card is taken out
      expect((await Card.collection.findOne({ code: 'AC-1' })).balance, `autoCharge=${on}`).to.equal(expected)
      expect(c.client.balance, `credit autoCharge=${on}`).to.equal(credit)
    }
  })
})

describe('The receipt pre-fill only ever shows the e-mail of the card the sale was paid with', function () {
  this.timeout(20000)
  let tA, tB, app
  before(async () => {
    await startTestDb(); await clearTestDb()
    const { buildTestApp } = await import('./setup.test-helper.js')
    app = await buildTestApp(); ;({ tenant: tA } = await seedTenantAndUsers()); tB = await Tenant.create({ name: 'Other', slug: 'other-hint' })
    const Sale = (await import('../src/models/sale.js')).default
    await Card.collection.insertMany([
      { tenantId: tA._id, code: 'HER', balance: 5, bonus: 0, email: 'her@example.com', status: 'active', createdAt: new Date() },
      { tenantId: tA._id, code: 'PREV', balance: 5, bonus: 0, email: 'previous@example.com', status: 'active', createdAt: new Date() },
      { tenantId: tA._id, code: 'NOMAIL', balance: 5, bonus: 0, status: 'active', createdAt: new Date() },
    ])
    await Sale.collection.insertMany([
      { tenantId: tA._id, amount: 2, type: 'payment', method: 'card', cardCode: 'HER', batchId: 'b-her', createdAt: new Date() },
      { tenantId: tA._id, amount: 2, type: 'payment', method: 'cash', batchId: 'b-cash', createdAt: new Date() },
      { tenantId: tA._id, amount: 2, type: 'payment', method: 'card', cardCode: 'NOMAIL', batchId: 'b-nomail', createdAt: new Date() },
      { tenantId: tB._id, amount: 2, type: 'payment', method: 'card', cardCode: 'HER', batchId: 'b-other-shop', createdAt: new Date() },
    ])
  })
  after(async () => { await stopTestDb() })
  const hint = async (b) => (await (await import('supertest')).default(app).get(`/api/pos/receipt-hint/${b}`).set('Authorization', 'ApiKey test-kiosk-api-key')).body.email

  it('is the paying card\'s e-mail; nothing for cash, for a card without e-mail, for an unknown sale or another shop\'s sale', async () => {
    expect(await hint('b-her')).to.equal('her@example.com') // never the previous customer's card
    expect(await hint('b-cash')).to.equal('')
    expect(await hint('b-nomail')).to.equal('')
    expect(await hint('does-not-exist')).to.equal('')
    expect(await hint('b-other-shop')).to.equal('')
  })
})

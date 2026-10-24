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

import { expect } from 'chai'
import mongoose from 'mongoose'
import { startTestDb, stopTestDb, clearTestDb, seedTenantAndUsers } from './setup.test-helper.js'
import Client from '../src/services/client.js'
import Card from '../src/models/card.js'

describe('Card balance save: only what the session changed', function () {
  this.timeout(20000)
  let tenant
  before(async () => { await startTestDb() })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant } = await seedTenantAndUsers())
  })

  it('a recharge made through the API while the card is loaded is not erased when the card is removed', async () => {
    await Card.collection.insertOne({ tenantId: tenant._id, code: 'C-DELTA', balance: 4.7, bonus: 0, status: 'active', createdAt: new Date() })
    const c = new Client()
    expect(await c.setClientInfoByCard('C-DELTA')).to.equal(true)

    // The kiosk recharges EUR 10 through the HTTP route: the database moves, the session does not.
    await Card.collection.updateOne({ code: 'C-DELTA' }, { $inc: { balance: 10 } })

    await c.resetCardInfo() // the reader reports the card removed
    const after = await Card.collection.findOne({ code: 'C-DELTA' })
    expect(after.balance).to.equal(14.7)
  })

  it('still saves what the session spent from the card', async () => {
    await Card.collection.insertOne({ tenantId: tenant._id, code: 'C-SPEND', balance: 10, bonus: 0, status: 'active', createdAt: new Date() })
    const c = new Client()
    await c.setClientInfoByCard('C-SPEND')
    c.deductCredits(4)
    await c.saveCardBalance()
    expect((await Card.collection.findOne({ code: 'C-SPEND' })).balance).to.equal(6)
  })

  it('an external recharge AND a spend in the same session both survive', async () => {
    await Card.collection.insertOne({ tenantId: tenant._id, code: 'C-BOTH', balance: 5, bonus: 0, status: 'active', createdAt: new Date() })
    const c = new Client()
    await c.setClientInfoByCard('C-BOTH')
    await Card.collection.updateOne({ code: 'C-BOTH' }, { $inc: { balance: 10 } })
    c.deductCredits(2)
    await c.saveCardBalance()
    expect((await Card.collection.findOne({ code: 'C-BOTH' })).balance).to.equal(13)
  })
})

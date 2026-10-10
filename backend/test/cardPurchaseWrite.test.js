import { expect } from 'chai'
import { startTestDb, stopTestDb, clearTestDb, seedTenantAndUsers } from './setup.test-helper.js'

describe('Card purchase: the blank card is written as soon as it is read', function () {
  this.timeout(20000)
  let tenant, Card, Peripheral, CardPurchase, coinMachine
  const saved = {}
  let written

  before(async () => {
    await startTestDb()
    Card = (await import('../src/models/card.js')).default
    Peripheral = (await import('../src/models/peripheral.js')).default
    CardPurchase = (await import('../src/models/cardPurchase.js')).default
    coinMachine = (await import('../src/services/coinMachine.js')).default
  })
  after(async () => { await stopTestDb() })
  beforeEach(async () => {
    await clearTestDb()
    ;({ tenant } = await seedTenantAndUsers())
    written = []
    saved.tenantId = coinMachine.tenantId
    saved.middleware = coinMachine.middleware
    saved.cardSync = coinMachine.cardSync
    coinMachine.tenantId = tenant._id
    coinMachine.cardSync = null
    coinMachine.middleware = { writeCardData: async (id, data) => { written.push(data) } }
  })
  afterEach(() => {
    coinMachine.tenantId = saved.tenantId
    coinMachine.middleware = saved.middleware
    coinMachine.cardSync = saved.cardSync
  })

  async function purchase(code = '2588185743', credit = 5) {
    await Peripheral.create({ tenantId: tenant._id, name: 'RFID', type: 'rfid_reader', enabled: true, status: 'ok' })
    const card = await Card.create({ tenantId: tenant._id, code, balance: credit, status: 'pending_write', name: 'teste' })
    await CardPurchase.create({ tenantId: tenant._id, cardId: card._id, cardCode: code, purchasePrice: credit, initialCredit: credit, paymentMethod: 'cash', amountInserted: credit, batchId: 'B1', cardWritten: false })
    return card
  }

  it('a blank card (new: "true") gets the pending purchase written and activated', async () => {
    await purchase()
    await coinMachine.handleCardRead({ cardNumber: '-637069136', card: { cardId: '-637069136', new: 'true', name: ' ', nif: ' ', balance: ' ', admin: 'false' } })
    expect(written).to.have.length(1)
    // the card takes the id its chip already carries (the controller ignores a generated one)
    expect(written[0].code).to.equal('-637069136')
    expect(written[0].balance).to.equal(5)
    const card = await Card.findOne({ code: '-637069136' })
    expect(card.status).to.equal('active')
    expect(card.balance).to.equal(5)
    expect(card.metadata.previousCode).to.equal('2588185743')
    expect(await Card.findOne({ code: '2588185743' })).to.equal(null) // one card, not two
    expect(await Card.countDocuments({ tenantId: tenant._id })).to.equal(1)
    const bought = await CardPurchase.findOne({ cardCode: '-637069136' })
    expect(bought.cardWritten).to.equal(true)
  })

  it('a blank card with no purchase waiting writes nothing', async () => {
    await Peripheral.create({ tenantId: tenant._id, name: 'RFID', type: 'rfid_reader', enabled: true, status: 'ok' })
    await coinMachine.handleCardRead({ cardNumber: '-1', card: { cardId: '-1', new: 'true', admin: 'false' } })
    expect(written).to.have.length(0)
  })

  it('a failed write leaves the card pending so the customer can retry', async () => {
    await purchase()
    coinMachine.middleware = { writeCardData: async () => { throw new Error('write not verified') } }
    await coinMachine.handleCardRead({ cardNumber: '-5', card: { cardId: '-5', new: 'true', admin: 'false' } })
    const stuck = await Card.findOne({ tenantId: tenant._id })
    expect(stuck.status).to.equal('pending_write')
    expect(stuck.balance).to.equal(5)
  })
})

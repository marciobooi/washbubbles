import { expect } from 'chai'
import { startTestDb, stopTestDb } from './setup.test-helper.js'
import Tenant from '../src/models/tenant.js'
import Peripheral from '../src/models/peripheral.js'
import AuditLog from '../src/models/auditLog.js'
import { CoinMachine } from '../src/services/coinMachine.js'

describe('Unspent cash is paid back after the kiosk is left alone', function () {
  let tenant, cm, calls, next
  const hopperRow = () => Peripheral.create({ tenantId: tenant._id, name: 'Hopper', type: 'hopper', enabled: true })

  before(async () => {
    await startTestDb()
    tenant = await Tenant.create({ name: 'Refund Test', slug: `refund-${Date.now()}` })
  })
  after(async () => {
    await Promise.all([Peripheral, AuditLog].map((M) => M.deleteMany({ tenantId: tenant._id })))
    await Tenant.deleteOne({ _id: tenant._id })
    await stopTestDb()
  })
  beforeEach(async () => {
    await Promise.all([Peripheral, AuditLog].map((M) => M.deleteMany({ tenantId: tenant._id })))
    calls = []
    next = async (id, amount) => ({ success: true, dispensed: amount })
    cm = new CoinMachine({
      tenantId: tenant._id,
      middleware: {
        subscribe: () => ({ unsubscribe() {} }),
        dispenseChange: async (id, amount) => { calls.push(amount); return next(id, amount) },
      },
    })
    cm.settings = { creditRefundSeconds: 120 }
  })

  it('pays everything back from the hopper and clears the credit', async () => {
    await hopperRow()
    cm.client.addToBalance(3)
    const r = await cm.refundCredit({ reason: 'idle' })
    expect(r).to.include({ success: true, refunded: 3, remaining: 0 })
    expect(calls).to.deep.equal([3])
    expect(cm.client.getState().balance).to.equal(0)
    expect(await AuditLog.countDocuments({ tenantId: tenant._id, action: 'cash.refund' })).to.equal(1)
  })

  it('keeps what the hopper could not pay as credit, and tells the operator the exact amount', async () => {
    await hopperRow()
    next = async () => ({ success: false, dispensed: 1, remaining: 2, error: 'Hopper empty' })
    cm.client.addToBalance(3)
    const r = await cm.refundCredit({ reason: 'idle' })
    expect(r.success).to.equal(false)
    expect(r.refunded).to.equal(1)
    expect(r.remaining).to.equal(2)
    expect(cm.client.getState().balance).to.equal(2) // not forgotten
    const a = await AuditLog.findOne({ tenantId: tenant._id, action: 'cash.refund.short' })
    expect(a.details).to.include({ amount: 3, refunded: 1, remaining: 2 })
  })

  it('a hopper that throws, or no hopper at all, loses no money', async () => {
    cm.client.addToBalance(2)
    expect((await cm.refundCredit()).error).to.match(/No hopper/)
    expect(cm.client.getState().balance).to.equal(2)
    await hopperRow()
    next = async () => { throw new Error('jam') }
    const r = await cm.refundCredit()
    expect(r.success).to.equal(false)
    expect(cm.client.getState().balance).to.equal(2)
  })

  it('leaves a customer with a card to the card flow', async () => {
    await hopperRow()
    cm.client.addToBalance(2)
    cm.client.client.hasCard = true
    const r = await cm.refundCredit({ reason: 'idle' })
    expect(r.skipped).to.equal('card-loaded')
    expect(calls).to.have.length(0)
    expect(cm.creditRefundCountdown()).to.equal(null)
  })

  it('does nothing for an empty balance, and never pays twice for two simultaneous requests', async () => {
    await hopperRow()
    expect((await cm.refundCredit()).refunded).to.equal(0)
    expect(calls).to.have.length(0)
    cm.client.addToBalance(1)
    await Promise.all([cm.refundCredit(), cm.refundCredit()])
    expect(calls).to.deep.equal([1])
  })

  it('waits for the idle time, restarts it on every touch, and can be switched off', async () => {
    await hopperRow()
    cm.client.addToBalance(2)
    cm.touchCredit()
    expect(cm.creditRefundCountdown()).to.be.within(119, 120)
    expect(await cm.checkCreditRefund()).to.equal(null) // not yet
    expect(calls).to.have.length(0)

    cm.lastCreditActivity = Date.now() - 100_000
    expect(cm.creditRefundCountdown()).to.be.within(19, 21)
    cm.touchCredit() // customer touched the screen: back to the full wait
    expect(cm.creditRefundCountdown()).to.be.within(119, 120)

    cm.lastCreditActivity = Date.now() - 121_000
    const r = await cm.checkCreditRefund()
    expect(r.refunded).to.equal(2)
    expect(cm.client.getState().balance).to.equal(0)

    cm.client.addToBalance(1)
    cm.settings.creditRefundSeconds = 0
    cm.lastCreditActivity = Date.now() - 999_000
    expect(cm.creditRefundCountdown()).to.equal(null)
    expect(await cm.checkCreditRefund()).to.equal(null)
  })

  it('dispenseChange now reports the controller\'s real answer (it used to say success whatever happened)', async () => {
    next = async () => ({ success: false, dispensed: 0, remaining: 5, error: 'short' })
    const r = await cm.dispenseChange('h1', 5)
    expect(r.success).to.equal(false)
    expect(r.remaining).to.equal(5)
  })
})

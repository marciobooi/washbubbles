import { expect } from 'chai'
import Client from '../src/services/client.js'

/**
 * Combined credit rules. The operator's requirement is that a customer can pay
 * with card balance AND coins together on one purchase.
 */
describe('Combined card + cash credits', () => {
  let c
  beforeEach(() => {
    c = new Client()
    c.client.hasCard = true
    c.client.cardNumber = 'TEST'
  })

  it('lets card balance and coins combine on one purchase', () => {
    c.client.balanceCard = 3
    c.addToBalance(2)
    expect(c.client.credits).to.equal(5)

    const split = c.deductCredits(5)
    expect(split.fromCash).to.equal(2)
    expect(split.fromCard).to.equal(3)
    expect(c.client.credits).to.equal(0)
  })

  it('spends session cash before touching the card', () => {
    c.client.balanceCard = 10
    c.addToBalance(4)

    const split = c.deductCredits(3)
    // Fewer card writes: the coins cover it, so the card is untouched.
    expect(split.fromCash).to.equal(3)
    expect(split.fromCard).to.equal(0)
    expect(c.client.balanceCard).to.equal(10)
    expect(c.client.balance).to.equal(1)
  })

  it('falls through to the card once the coins run out', () => {
    c.client.balanceCard = 10
    c.addToBalance(1)

    const split = c.deductCredits(6)
    expect(split.fromCash).to.equal(1)
    expect(split.fromCard).to.equal(5)
    expect(c.client.balance).to.equal(0)
    expect(c.client.balanceCard).to.equal(5)
  })

  it('works with no card at all (cash only)', () => {
    const cash = new Client()
    cash.addToBalance(5)
    const split = cash.deductCredits(5)
    expect(split.fromCash).to.equal(5)
    expect(split.fromCard).to.equal(0)
  })

  it('refuses a purchase beyond the combined total', () => {
    c.client.balanceCard = 2
    c.addToBalance(2)
    expect(() => c.deductCredits(5)).to.throw(/Insufficient credits/)
    // and nothing moved
    expect(c.client.balanceCard).to.equal(2)
    expect(c.client.balance).to.equal(2)
  })

  it('allows an exact payment that lands on a float boundary', () => {
    c.client.balanceCard = 0.1
    c.addToBalance(0.2)
    expect(() => c.deductCredits(0.3)).to.not.throw()
    expect(c.client.credits).to.equal(0)
  })

  it('snapshots and restores balances for a rolled-back payment', () => {
    c.client.balanceCard = 10
    c.addToBalance(5)
    const snap = c.snapshotBalances()

    c.deductCredits(12)
    expect(c.client.credits).to.equal(3)

    c.restoreBalances(snap)
    expect(c.client.balance).to.equal(5)
    expect(c.client.balanceCard).to.equal(10)
    expect(c.client.credits).to.equal(15)
  })
})

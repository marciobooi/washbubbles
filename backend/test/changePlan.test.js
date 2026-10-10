import { expect } from 'chai'
import { planCoinPayout, planPayout, Middleware } from '../src/services/middleware.js'

const COINS = [0.1, 0.2, 0.5, 1, 2] // the shop's coins, smallest first (the order of the bins does not matter)
const inf = (values = COINS) => values.map((value) => ({ value, stock: Infinity }))
const asMap = (plan, values = COINS) => Object.fromEntries(values.map((v, i) => [v, plan.counts[i]]).filter(([, n]) => n > 0))
const total = (plan, values = COINS) => Math.round(plan.counts.reduce((s, n, i) => s + n * values[i], 0) * 100) / 100

describe('Change is paid in the biggest coins first (middleware.planCoinPayout)', () => {
  it('€3.80 is 2 + 1 + 0.50 + 0.20 + 0.10, never a pile of small coins', () => {
    const p = planCoinPayout(3.8, inf())
    expect(asMap(p)).to.deep.equal({ 0.1: 1, 0.2: 1, 0.5: 1, 1: 1, 2: 1 })
    expect(p.unpayable).to.equal(0)
  })

  it('uses the fewest coins for typical change amounts', () => {
    const cases = { 0.3: 2, 5: 3, 9.9: 8, 1.7: 3, 0.1: 1, 15: 8 } // amount → coin count
    for (const [amount, coins] of Object.entries(cases)) {
      const p = planCoinPayout(Number(amount), inf())
      expect(p.counts.reduce((s, n) => s + n, 0), `€${amount}`).to.equal(coins)
      expect(total(p), `€${amount}`).to.equal(Number(amount))
    }
    expect(asMap(planCoinPayout(5, inf()))).to.deep.equal({ 1: 1, 2: 2 }) // 2+2+1
  })

  it('when a big coin has run out, the smaller ones make up for it', () => {
    const noTwos = COINS.map((value) => ({ value, stock: value === 2 ? 0 : Infinity }))
    expect(asMap(planCoinPayout(3, noTwos))).to.deep.equal({ 1: 3 })
    const fewOnes = COINS.map((value) => ({ value, stock: value === 2 ? 1 : value === 1 ? 0 : Infinity }))
    expect(asMap(planCoinPayout(3, fewOnes))).to.deep.equal({ 0.5: 2, 2: 1 })
  })

  it('finds the exact amount even where "biggest first" alone would get stuck', () => {
    // 0.60 with a single 0.50 and no 0.10: taking the 0.50 leaves 0.10 that cannot be paid; three 0.20 coins can
    const bins = [{ value: 0.5, stock: 1 }, { value: 0.2, stock: 3 }, { value: 0.1, stock: 0 }]
    const p = planCoinPayout(0.6, bins)
    expect(p.counts).to.deep.equal([0, 3, 0])
    expect(p.unpayable).to.equal(0)
  })

  it('says exactly what it cannot pay instead of paying too little in silence', () => {
    const p = planCoinPayout(0.3, [{ value: 0.5, stock: 5 }, { value: 0.2, stock: 5 }])
    expect(p.payable).to.equal(0.2)
    expect(p.unpayable).to.equal(0.1)
    const none = planCoinPayout(1, [{ value: 1, stock: 0 }])
    expect(none.counts).to.deep.equal([0])
    expect(none.unpayable).to.equal(1)
  })

  it('nothing to pay, nothing to do; and no change is ever asked in bills', () => {
    expect(planCoinPayout(0, inf()).counts.every((n) => n === 0)).to.equal(true)
    // The planner only knows coins: there is no way to put a bill into a payout.
    expect(planCoinPayout(20, inf()).counts.length).to.equal(COINS.length)
  })

  it('stays fast and bounded for large amounts', () => {
    const t = Date.now()
    const p = planCoinPayout(250, inf()) // above the €200 safety cap
    expect(Date.now() - t).to.be.lessThan(500)
    expect(p.payable).to.equal(200)
    expect(p.unpayable).to.equal(50)
  })
})

describe('planPayout across several hoppers', () => {
  const hopper = (name, coinValue, currentCount) => ({ connection: { peripheral: { name, hopperConfig: { coinValue, currentCount } } }, coinValue })

  it('pays from the hopper with the biggest coin first, and lists the steps in that order', () => {
    const plan = planPayout(3.5, [hopper('h05', 0.5, 50), hopper('h2', 2, 50), hopper('h1', 1, 50)])
    expect(plan.steps.map((s) => [s.connection.peripheral.name, s.count])).to.deep.equal([['h2', 1], ['h1', 1], ['h05', 1]])
    expect(plan.unpayable).to.equal(0)
  })

  it('counts a hopper whose stock is 0 as "stock not tracked", as before, and respects a real stock', () => {
    const untracked = planPayout(6, [hopper('h2', 2, 0), hopper('h1', 1, 50)])
    expect(untracked.steps.map((s) => [s.coinValue, s.count])).to.deep.equal([[2, 3]])
    const limited = planPayout(6, [hopper('h2', 2, 1), hopper('h1', 1, 50)])
    expect(limited.steps.map((s) => [s.coinValue, s.count])).to.deep.equal([[2, 1], [1, 4]])
  })

  it('reports the part no hopper can make', () => {
    const plan = planPayout(0.3, [hopper('h05', 0.5, 5), hopper('h02', 0.2, 5)])
    expect(plan.steps.map((s) => [s.coinValue, s.count])).to.deep.equal([[0.2, 1]])
    expect(plan.unpayable).to.equal(0.1)
  })
})

describe('Change through the controller: what the log says a biggest-first payout is', () => {
  it('describes it in the shop\'s own coins, for comparing with what really falls at the machine', () => {
    const mw = new Middleware()
    mw.coinEqTable = { 4: 0.1, 5: 0.2, 6: 0.5, 7: 1, 8: 2 }
    expect(mw.describeBigFirst(3.8)).to.equal('1 x EUR 2.00 + 1 x EUR 1.00 + 1 x EUR 0.50 + 1 x EUR 0.20 + 1 x EUR 0.10')
    expect(mw.describeBigFirst(5)).to.equal('2 x EUR 2.00 + 1 x EUR 1.00')
    expect(mw.describeBigFirst(0.05)).to.include('cannot be made')
    mw.coinEqTable = null
    expect(mw.describeBigFirst(1)).to.equal('(coin values unknown)')
  })
})

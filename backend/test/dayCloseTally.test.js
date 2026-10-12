import { expect } from 'chai'
import { tallySales } from '../src/services/dayClose.js'

describe('Day close: what counts as cash, as a sale, and as a top-up', () => {
  const sales = [
    { method: 'cash', type: 'payment', amount: 2, change: 3 },        // dryer, paid with 5 -> 3 change
    { method: 'cash', type: 'card_purchase', amount: 5, change: 0 },  // card sold for cash
    { method: 'cash', type: 'recharge', amount: 10, change: 0 },      // top-up in cash
    { method: 'card', type: 'payment', amount: 4.5, change: 0 },      // spent from a card balance
    { method: 'cash', type: 'refund', amount: -2, change: 0 },        // the dryer sale refunded in cash
  ]
  it('the till holds every cash movement (top-ups included, refunds taken out)', () => {
    expect(tallySales(sales).totalCash).to.equal(15) // 2 + 5 + 10 - 2
  })
  it('revenue leaves the top-ups out, so a top-up and the spending of it are not counted twice', () => {
    const t = tallySales(sales)
    expect(t.totalRecharges).to.equal(10)
    expect(t.totalSales).to.equal(9.5) // 15 cash + 4.5 card - 10 recharged
    expect(t.cashSales).to.equal(5)    // machine + card sales in cash: 2 + 5 - 2
  })
  it('a new card sold for 10 with 5 of starting credit: 5 is the card, 5 is prepaid and counted when spent', () => {
    const t = tallySales([
      { method: 'cash', type: 'card_purchase', amount: 10, change: 0, metadata: { initialCredit: 5 } },
      { method: 'card', type: 'payment', amount: 5, change: 0 }, // another day: the customer spends the 5 of credit
    ])
    expect(t.totalCash).to.equal(10)     // in the till once
    expect(t.totalRecharges).to.equal(5) // prepaid on the card
    expect(t.totalSales).to.equal(10)    // 10 revenue in total: 5 for the card itself + 5 spent later (not 15)
    expect(t.cashSales).to.equal(5)
  })

  it('adds change dispensed from the sales', () => {
    expect(tallySales(sales).totalChangeDispensed).to.equal(3)
  })
})

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
  it('the books follow the cash; card consumption is information only and is never added on top', () => {
    const t = tallySales(sales)
    expect(t.totalSales).to.equal(15)  // = cash that entered the till (2 + 5 + 10 - 2)
    expect(t.totalCard).to.equal(4.5)  // shown to the admin, not accounted
    expect(t.totalRecharges).to.equal(10)
    expect(t.cashSales).to.equal(5)    // machine + card sales in cash, without the top-up
  })
  it('a new card sold for 10 with 5 of starting credit: counted once, when the cash entered', () => {
    const t = tallySales([
      { method: 'cash', type: 'card_purchase', amount: 10, change: 0, metadata: { initialCredit: 5 } },
      { method: 'card', type: 'payment', amount: 5, change: 0 }, // another day: the customer spends the 5 of credit
    ])
    expect(t.totalCash).to.equal(10)
    expect(t.totalSales).to.equal(10)   // not 15: spending the credit is not accounted again
    expect(t.totalCard).to.equal(5)     // visible to the admin
    expect(t.totalRecharges).to.equal(5)
    expect(t.cashSales).to.equal(5)
  })

  it('adds change dispensed from the sales', () => {
    expect(tallySales(sales).totalChangeDispensed).to.equal(3)
  })
})

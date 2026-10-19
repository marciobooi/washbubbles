import Card from '../models/card.js'
import CardPurchase from '../models/cardPurchase.js'
import Sale from '../models/sale.js'

/**
 * Forget a card completely: the card, its purchase record and its history. The SALES stay (the money really came in and the
 * day close counts it), but they no longer point at the card, so a card that later shows up with the same id starts with an
 * empty history. The old id is kept inside the sale (`metadata.formerCardCode`) for the books.
 */
export async function forgetCard(tenantId, code) {
  const c = String(code)
  const cards = await Card.deleteMany({ tenantId, code: c })
  const purchases = await CardPurchase.deleteMany({ tenantId, cardCode: c })
  const sales = await Sale.updateMany(
    { tenantId, cardCode: c },
    { $set: { 'metadata.formerCardCode': c }, $unset: { cardCode: '', cardId: '' } },
  )
  return { cards: cards.deletedCount, purchases: purchases.deletedCount, sales: sales.modifiedCount }
}

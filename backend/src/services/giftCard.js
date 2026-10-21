/**
 * Gift card: a card handed to a customer for free. Same physical path as a bought card (the dispenser ejects a
 * blank card, it is presented at the reader, the shop writes it and activates it), but nothing is charged and
 * the starting credit is whatever staff choose — ZERO by default.
 *
 * This is the ONLY way (besides cash) a card gets balance, so it is deliberately narrow:
 *  - only staff can start it: the kiosk staff PIN, or an admin (central admin -> remote command to the shop);
 *  - the credit is capped (GIFT_CARD_MAX_CREDIT, default 100 EUR);
 *  - every card is recorded as a sale of 0 EUR with method 'gift' and the credit given in `metadata.giftCredit`
 *    (NOT `initialCredit`: that one means "paid money now on the card" and feeds the day-close prepaid total),
 *    plus an audit entry, so free credit is always traceable.
 */
import crypto from 'crypto'
import Card from '../models/card.js'
import CardPurchase from '../models/cardPurchase.js'
import Peripheral from '../models/peripheral.js'
import Sale from '../models/sale.js'
import { withTenant } from './tenant.js'
import { roundMoney } from '../utils/money.js'
import { logAction } from './auditLog.js'

export const maxGiftCredit = () => Number(process.env.GIFT_CARD_MAX_CREDIT) > 0 ? Number(process.env.GIFT_CARD_MAX_CREDIT) : 100

const bad = (status, message) => Object.assign(new Error(message), { status })

/**
 * @param req   anything carrying `tenantId` (an express request, or `{ tenantId }` for a remote command)
 * @param coin  the CoinMachine (hardware), injected so tests can fake the dispenser
 * @param opts  { credit = 0, customerName, customerEmail, customerPhone, customerContribuinte, by }
 */
export async function issueGiftCard(req, coin, opts = {}) {
  const raw = Number(opts.credit ?? 0)
  if (!Number.isFinite(raw) || raw < 0) throw bad(400, 'Invalid credit')
  const credit = roundMoney(raw)
  if (credit > maxGiftCredit()) throw bad(400, `Credit cannot be more than €${maxGiftCredit().toFixed(2)}`)
  if (!coin?.running) throw bad(409, 'This server has no card dispenser (run it on the shop PC)')

  const CardT = withTenant(Card, req)
  const PeripheralT = withTenant(Peripheral, req)
  const dispenser = await PeripheralT.findOne({ type: 'card_dispenser', enabled: true })
  if (!dispenser) throw bad(503, 'No card dispenser configured')

  let code = ''
  for (let i = 0; i < 10; i++) {
    const candidate = String(crypto.randomInt(1000000000, 10000000000))
    if (!(await CardT.findOne({ code: candidate }))) { code = candidate; break }
  }
  if (!code) throw bad(500, 'Could not allocate a card code')

  // No card out, nothing recorded.
  try { await coin.dispenseNewCard(dispenser._id, credit) } catch (err) {
    throw bad(503, `The card dispenser did not release a card: ${err.message}`)
  }

  const card = await CardT.create({
    code,
    balance: credit,
    status: 'pending_write', // not spendable until it has been written at the reader
    name: opts.customerName || '',
    email: opts.customerEmail || '',
    phone: opts.customerPhone || '',
    contribuinte: opts.customerContribuinte || '',
    metadata: { gift: true, giftCredit: credit },
  })
  const sale = await withTenant(Sale, req).create({
    amount: 0,
    items: [{ type: 'gift_card', name: credit > 0 ? `Cartão de oferta (crédito ${credit.toFixed(2)} €)` : 'Cartão de oferta', amount: 0, credit, cardCode: code, by: opts.by || '' }],
    method: 'gift',
    type: 'gift_card',
    cardId: card._id,
    cardCode: code,
    metadata: { gift: true, giftCredit: credit, initialCredit: 0, issuedBy: opts.by || '' },
  })
  await withTenant(CardPurchase, req).create({
    cardId: card._id, cardCode: code, purchasePrice: 0, initialCredit: credit,
    paymentMethod: 'gift', amountInserted: 0, changeGiven: 0,
    customerName: opts.customerName || '', customerEmail: opts.customerEmail || '', customerPhone: opts.customerPhone || '',
    customerContribuinte: opts.customerContribuinte || '', saleId: sale._id, dispenserUsed: true, cardWritten: false,
  })
  try { await logAction(req, 'card.gift_issued', 'Card', card._id, { credit, by: opts.by || '' }) } catch { /* the trail must not undo a card that is already out */ }
  console.log(`[Card] gift card issued (credit €${credit.toFixed(2)}, by ${opts.by || 'staff'}); present it at the reader to activate it`)
  return { success: true, cardCode: code, credit }
}

/**
 * What happens when an MB WAY payment for a CARD is paid (Eupago said "paga"): the card purchase and the card recharge. Both mirror
 * what the cash routes do (routes/pos.js /card/purchase and /recharge), minus the cash: no inserted money, no change.
 * Called once, by services/mbway.js, by the one process that flipped the payment pending -> paid.
 */
import crypto from 'crypto'
import Card from '../models/card.js'
import CardPurchase from '../models/cardPurchase.js'
import Peripheral from '../models/peripheral.js'
import Sale from '../models/sale.js'
import { withTenant } from './tenant.js'
import { creditCard } from './cardBalance.js'
import { roundMoney } from '../utils/money.js'

const refs = (p) => ({ mbway: true, eupago: { reference: p.reference, transactionId: p.transactionId, identifier: p.identifier } })

/** Paid card purchase: release a blank card, register it (pending_write: the kiosk then asks the customer to put it in the reader). */
export async function fulfilCardPurchase(p, { coinMachine }) {
  const T = { tenantId: p.tenantId }
  const CardT = withTenant(Card, T)
  const { price, credit, customer = {} } = p.payload || {}
  const dispenser = await withTenant(Peripheral, T).findOne({ type: 'card_dispenser', enabled: true })
  if (!dispenser) throw new Error('Nenhum dispensador de cartões configurado')
  await coinMachine.dispenseNewCard(dispenser._id, credit) // throws when no card comes out: nothing is booked, the caller reports it
  let code = ''
  for (let i = 0; i < 10 && !code; i++) {
    const candidate = String(crypto.randomInt(1000000000, 10000000000))
    if (!(await CardT.findOne({ code: candidate }))) code = candidate
  }
  if (!code) throw new Error('Não foi possível atribuir um código ao cartão')
  const consentAt = customer.privacyConsent ? new Date() : null
  const card = await CardT.create({
    code, balance: credit, status: 'pending_write',
    name: customer.name || '', email: customer.email || '', phone: customer.phone || '', contribuinte: customer.contribuinte || '',
    marketingOptIn: Boolean(customer.marketingOptIn), privacyConsentAt: consentAt,
  })
  const sale = await withTenant(Sale, T).create({
    amount: price, items: [{ type: 'card_purchase', amount: price, cardCode: code }], method: 'mbway', batchId: p.batchId,
    inserted: 0, change: 0, type: 'card_purchase', cardId: card._id, cardCode: code,
    metadata: { initialCredit: credit, ...(consentAt ? { privacyConsentAt: consentAt } : {}), ...refs(p) },
  })
  await withTenant(CardPurchase, T).create({
    cardId: card._id, cardCode: code, purchasePrice: price, initialCredit: credit, paymentMethod: 'mbway', amountInserted: 0, changeGiven: 0,
    customerName: customer.name || '', customerEmail: customer.email || '', customerPhone: customer.phone || '', customerContribuinte: customer.contribuinte || '',
    saleId: sale._id, batchId: p.batchId, dispenserUsed: true, cardWritten: false,
  })
  return { saleIds: [sale._id], result: { card: { code, balance: credit, status: 'pending_write' } } }
}

/** Paid recharge: the amount is added to the card (atomically); a card in the reader is brought up to date by the card change listener. */
export async function fulfilRecharge(p) {
  const T = { tenantId: p.tenantId }
  const { amount, cardCode } = p.payload || {}
  const card = await creditCard(withTenant(Card, T), { code: cardCode }, amount)
  if (!card) throw new Error(`O cartão ${cardCode} já não existe`)
  const sale = await withTenant(Sale, T).create({
    amount: roundMoney(amount), items: [{ id: `recharge-${p.identifier}`, name: 'Recarga de Cartão', type: 'Recarga de Cartão', price: roundMoney(amount), quantity: 1 }],
    method: 'mbway', batchId: p.batchId, inserted: 0, change: 0, type: 'recharge', cardId: card._id, cardCode,
    metadata: refs(p),
  })
  return { saleIds: [sale._id], result: { card: { code: card.code, balance: card.balance } } }
}

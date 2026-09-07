/**
 * Atomic card-balance operations.
 *
 * Every balance change used to be a read-modify-write:
 *
 *     const card = await CardT.findOne({ code })
 *     card.balance = card.balance - price
 *     await card.save()
 *
 * Two kiosks in the same tenant touching one card at the same time both read the
 * old balance and the second `save()` overwrites the first — a lost update. With
 * a €20 card and two concurrent €5 washes, the customer is charged once and gets
 * two washes. The same shape on the credit side loses a recharge outright.
 *
 * These helpers push the arithmetic into a single MongoDB update so the read and
 * the write cannot be separated by another request.
 */
import { roundMoney } from '../utils/money.js'

/**
 * Floats can land a hair under a whole-cent target (a €5 balance held as
 * 4.999999999999999), which would fail a strict `$gte: 5` guard on a payment the
 * customer can plainly afford. Half a cent is far below anything representable
 * in euros, so it is a safe slack for the comparison only — never for the amount.
 */
const EPSILON = 0.005

/**
 * Add to a card's balance atomically.
 * @returns the updated card, or null if it no longer exists.
 */
export async function creditCard(Model, filter, amount) {
  const delta = roundMoney(amount)
  if (!(delta > 0)) throw new Error('creditCard requires a positive amount')
  return Model.findOneAndUpdate(filter, { $inc: { balance: delta }, $set: { updatedAt: new Date() } }, { new: true })
}

/**
 * Subtract from a card's balance atomically, but only if the funds are there.
 *
 * The `balance: {$gte: …}` clause makes the sufficiency check part of the same
 * update, so it cannot be overtaken between checking and debiting.
 *
 * @returns the updated card, or null when the card is missing OR underfunded —
 *          the caller must distinguish those two cases itself if it needs to.
 */
export async function debitCard(Model, filter, amount) {
  const delta = roundMoney(amount)
  if (!(delta > 0)) throw new Error('debitCard requires a positive amount')
  return Model.findOneAndUpdate(
    { ...filter, balance: { $gte: delta - EPSILON } },
    { $inc: { balance: -delta }, $set: { updatedAt: new Date() } },
    { new: true }
  )
}

/**
 * Apply a signed delta atomically, refusing to go negative.
 * Used by the sync push path, where the kiosk sends either sign.
 */
export async function applyCardDelta(Model, filter, delta) {
  const d = roundMoney(delta)
  if (d === 0) return Model.findOneAndUpdate(filter, { $set: { updatedAt: new Date() } }, { new: true })
  if (d > 0) return creditCard(Model, filter, d)
  return debitCard(Model, filter, -d)
}

export default { creditCard, debitCard, applyCardDelta }

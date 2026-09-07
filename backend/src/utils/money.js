/**
 * Money helpers — euros only.
 *
 * Every amount in this system is a euro value with at most 2 decimals held in a
 * JS float. Raw float arithmetic drifts (5 × 1.00 + 10% bonus → 5.500000000000001,
 * and a €5 target lands on 4.999999999 which then fails an "insufficient credits"
 * check on an exact payment), so every sum, difference and bonus must go through
 * `roundMoney`.
 */

/** Round a euro amount to cents. Returns 0 for anything non-finite. */
export function roundMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

/**
 * Validate a client-supplied money amount.
 *
 * Rejects NaN, Infinity, negatives and zero. Negatives are the important case:
 * `card.balance - Number(-50)` *credits* the card, so an unchecked amount on any
 * money route is unlimited free credit.
 *
 * @returns {{ok: true, value: number} | {ok: false, error: string}}
 */
export function parseAmount(value, { allowZero = false, max = 10000 } = {}) {
  const n = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) {
    return { ok: false, error: 'Amount must be a number' }
  }
  if (n < 0) return { ok: false, error: 'Amount must not be negative' }
  if (!allowZero && n === 0) return { ok: false, error: 'Amount must be greater than zero' }
  if (n > max) return { ok: false, error: `Amount exceeds the maximum of ${max}` }
  return { ok: true, value: roundMoney(n) }
}

export default { roundMoney, parseAmount }

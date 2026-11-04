/**
 * Coupon validation + atomic redemption. Called from the same spot
 * gateways.js already re-prices every line from the tenant's own Price
 * table (never trusting a client-supplied price) — a coupon is just another
 * step in that server-side pricing, never something the kiosk computes
 * itself for a network-settled sale.
 */
import Coupon from '../models/coupon.js'
import { roundMoney } from '../utils/money.js'
import modelEvents from './modelEvents.js'

/**
 * Looks up a coupon and returns it if it's currently usable, or null.
 * Read-only — does not consume a redemption. Use `redeemCoupon` for that,
 * atomically, once the sale is actually going through.
 */
export async function findUsableCoupon(tenantId, code, machineType) {
  if (!code) return null
  const coupon = await Coupon.findOne({ tenantId, code: String(code).toUpperCase().trim() })
  if (!coupon) return null
  if (!coupon.active) return null
  if (coupon.expiresAt && coupon.expiresAt < new Date()) return null
  if (coupon.maxRedemptions != null && coupon.redemptionCount >= coupon.maxRedemptions) return null
  if (coupon.appliesTo !== 'both' && machineType && coupon.appliesTo !== machineType) return null
  return coupon
}

export function applyCouponDiscount(price, coupon) {
  if (!coupon) return price
  const discounted = coupon.discountType === 'percent'
    ? price * (1 - coupon.discountValue / 100)
    : price - coupon.discountValue
  return Math.max(0, roundMoney(discounted))
}

/**
 * Atomically increments redemptionCount, refusing if the cap was hit since
 * `findUsableCoupon` looked it up — same guarded-$inc shape as
 * cardBalance.js's debitCard. Call this once, when the sale is committed,
 * not during price preview.
 */
export async function redeemCoupon(tenantId, code) {
  const done = await redeemCouponRow(tenantId, code)
  // the shop counts its own uses; the central server learns the number (offline: when the link is back)
  if (done) modelEvents.emit('coupon:redeemed', { tenantId: done.tenantId, code: done.code, redemptionCount: done.redemptionCount })
  return done
}

function redeemCouponRow(tenantId, code) {
  return Coupon.findOneAndUpdate(
    {
      tenantId,
      code: String(code).toUpperCase().trim(),
      active: true,
      $or: [{ maxRedemptions: null }, { $expr: { $lt: ['$redemptionCount', '$maxRedemptions'] } }]
    },
    { $inc: { redemptionCount: 1 } },
    { new: true }
  )
}

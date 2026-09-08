/**
 * Cash-session reconciliation ("Fecho de Caixa").
 *
 * Shared by both entry points that may perform a close: the admin dashboard
 * (`routes/admin.js`, requireAdmin) and the kiosk itself (`routes/pos.js`,
 * requireKioskOrAdmin, gated client-side by the staff PIN). Kept in one place
 * so the two never drift into disagreeing about the opening-float chain,
 * the period boundary, or the concurrency guard.
 */
import Sale from '../models/sale.js'
import DayClose from '../models/dayClose.js'
import { withTenant } from './tenant.js'
import { acquireLock, releaseLock } from '../models/lock.js'

/**
 * Find the most recent *dashboard* cash-reconciliation close, ignoring any
 * kiosk-pushed Z-report rows that share this collection.
 *
 * `/sync/push/day-close` writes an informational backup record from the
 * kiosk's own local sales — it never has a real floatLeft/amountToBank (both
 * default to 0) and its periodTo is whenever the kiosk happened to run its
 * local close, uncoordinated with when staff actually count the drawer. If one
 * of those were ever picked up as "the last close" here, the float chain would
 * silently reset to zero and the reconciliation window would shift to the
 * wrong moment. A real cash count — whether submitted from the dashboard or
 * from this same wizard running on the kiosk — is always tagged `dashboard`;
 * kiosk auto-pushes are a record, not a reconciliation.
 */
export async function findLastDashboardClose(DayCloseT) {
  const arr = await DayCloseT.find({ source: { $ne: 'kiosk' } }).sort({ createdAt: -1 }).limit(1).lean()
  return arr[0] || null
}

/** Live sales totals + reconciliation context for the currently open session. */
export async function getDayCloseSummary(req) {
  const DayCloseT = withTenant(DayClose, req)
  const SaleT = withTenant(Sale, req)

  const lastClose = await findLastDashboardClose(DayCloseT)
  // periodTo (not createdAt) is the correct chain boundary: createdAt is set
  // when the document is finally written, which is measurably later than the
  // periodTo captured at the start of the SAME request that created it. A sale
  // landing in that gap used to belong to neither period and vanished from
  // every future report.
  const periodFrom = lastClose ? (lastClose.periodTo || lastClose.createdAt) : new Date(0)
  const openingFloat = lastClose ? Number(lastClose.floatLeft || 0) : 0

  const sales = await SaleT.find({ createdAt: { $gt: periodFrom } }).lean()
  let totalCash = 0
  let totalCard = 0
  let totalChangeDispensed = 0
  for (const s of sales) {
    const amt = Number(s.amount || 0)
    if (s.method === 'cash') totalCash += amt
    else totalCard += amt
    totalChangeDispensed += Number(s.change || 0)
  }
  const tc = Number(totalCash.toFixed(2))
  const expectedCash = Number((openingFloat + tc).toFixed(2))

  return {
    periodFrom,
    periodTo: new Date(),
    openingFloat,
    totalCash: tc,
    totalCard: Number(totalCard.toFixed(2)),
    totalSales: Number((tc + totalCard).toFixed(2)),
    expectedCash,
    salesCount: sales.length,
    totalChangeDispensed: Number(totalChangeDispensed.toFixed(2)),
    openingMechanismCoins: lastClose?.coinMechanismInventory || [],
    openingMechanismTotal: lastClose?.coinMechanismTotal || 0,
    openingHopperCoins: lastClose?.hopperCoins || [],
    openingHopperTotal: lastClose?.hopperTotal || 0
  }
}

/** Sanitise a denomination array (recompute totals server-side, never trust the client's). */
function cleanDenoms(arr) {
  return (arr || [])
    .filter(d => d && Number(d.value) > 0 && Number(d.count) >= 0)
    .map(d => ({
      value: Number(d.value),
      count: Number(d.count),
      total: Number((Number(d.value) * Number(d.count)).toFixed(2))
    }))
}

/**
 * Close the current cash session.
 *
 * Returns `{status, body}` — the caller (an Express route) just forwards it,
 * whether it came from the admin dashboard or the kiosk's own staff-mode
 * wizard.
 */
export async function createDayClose(req, {
  amountToBank, floatLeft, countedCash,
  countedDenominations = [], coinMechanismInventory = [], hopperActualBefore = [], hopperCoins = [],
  notes
}) {
  if (amountToBank == null || floatLeft == null) {
    return { status: 400, body: { error: 'amountToBank and floatLeft are required' } }
  }

  const amountToBankNum = Number(amountToBank)
  const floatLeftNum = Number(floatLeft)
  if (!Number.isFinite(amountToBankNum) || !Number.isFinite(floatLeftNum) || amountToBankNum < 0 || floatLeftNum < 0) {
    return { status: 400, body: { error: 'amountToBank and floatLeft must be non-negative numbers' } }
  }

  // Reading "the last close", aggregating sales since it, and writing the new
  // close is a read-then-write sequence, not a single atomic operation — two
  // people closing at the same moment (an admin on the dashboard and staff on
  // the kiosk, say) could otherwise both read the same opening state and both
  // succeed, silently double-booking the same cash and sales window under two
  // separate records. A per-tenant lock serialises the whole sequence; the
  // lock itself IS atomic (a single-document update against a unique index),
  // so this holds even without a replica set / multi-document transactions.
  const gotLock = await acquireLock(req.tenantId, 'day-close')
  if (!gotLock) {
    return { status: 409, body: { error: 'A cash session close is already in progress for this site. Please try again in a few seconds.' } }
  }

  try {
    const countedDenomsClean       = cleanDenoms(countedDenominations)
    const coinMechClean             = cleanDenoms(coinMechanismInventory)
    const hopperActualClean         = cleanDenoms(hopperActualBefore)
    const hopperCoinsClean          = cleanDenoms(hopperCoins)
    const coinMechanismTotal        = Number(coinMechClean.reduce((s, d) => s + d.total, 0).toFixed(2))
    const hopperActualBeforeTotal   = Number(hopperActualClean.reduce((s, d) => s + d.total, 0).toFixed(2))
    const hopperTotal               = Number(hopperCoinsClean.reduce((s, d) => s + d.total, 0).toFixed(2))

    const DayCloseT = withTenant(DayClose, req)
    const SaleT = withTenant(Sale, req)

    const lastClose = await findLastDashboardClose(DayCloseT)
    const periodFrom = lastClose ? (lastClose.periodTo || lastClose.createdAt) : new Date(0)
    const openingFloat = lastClose ? Number(lastClose.floatLeft || 0) : 0
    const periodTo = new Date()

    const sales = await SaleT.find({ createdAt: { $gt: periodFrom, $lte: periodTo } }).lean()
    let totalCash = 0; let totalCard = 0; let totalChangeDisp = 0
    for (const s of sales) {
      const amt = Number(s.amount || 0)
      if (s.method === 'cash') totalCash += amt
      else totalCard += amt
      totalChangeDisp += Number(s.change || 0)
    }
    const tc = Number(totalCash.toFixed(2))
    const tk = Number(totalCard.toFixed(2))
    const expectedCash = Number((openingFloat + tc).toFixed(2))
    const totalChangeDispensed = Number(totalChangeDisp.toFixed(2))

    // If countedCash wasn't provided, derive it from denomination sum
    const actualCountedCash = countedCash != null
      ? Number(Number(countedCash).toFixed(2))
      : Number(countedDenomsClean.reduce((s, d) => s + d.total, 0).toFixed(2))

    // The dashboard wizard already checks amountToBank + floatLeft === countedCash
    // client-side before submitting, but a financial record shouldn't rely on
    // whichever client produced the numbers to also be the only thing policing
    // them — a stale tab, a direct API call, or a client bug could otherwise
    // write a close where the cash split doesn't add up to what was counted.
    if (Math.abs(amountToBankNum + floatLeftNum - actualCountedCash) > 0.005) {
      return {
        status: 400,
        body: { error: `amountToBank + floatLeft (${(amountToBankNum + floatLeftNum).toFixed(2)}) must equal countedCash (${actualCountedCash.toFixed(2)})` }
      }
    }

    const discrepancy = Number((actualCountedCash - expectedCash).toFixed(2))

    // No re-check needed here for a racing close: the lock acquired above
    // already guarantees only one request executes this whole
    // read-compute-write sequence at a time, regardless of which surface
    // (dashboard or kiosk) it came from.
    const dc = await DayCloseT.create({
      source: 'dashboard',
      openingFloat,
      expectedCash,
      countedCash: actualCountedCash,
      discrepancy,
      countedDenominations: countedDenomsClean,
      amountToBank: Number(amountToBankNum.toFixed(2)),
      floatLeft: Number(floatLeftNum.toFixed(2)),
      coinMechanismInventory: coinMechClean,
      coinMechanismTotal,
      openingMechanismCoins: lastClose?.coinMechanismInventory || [],
      openingHopperCoins: lastClose?.hopperCoins || [],
      totalChangeDispensed,
      hopperActualBefore: hopperActualClean,
      hopperActualBeforeTotal,
      hopperCoins: hopperCoinsClean,
      hopperTotal,
      notes: String(notes || '').slice(0, 500),
      totalCash: tc,
      totalCard: tk,
      totalSales: Number((tc + tk).toFixed(2)),
      salesCount: sales.length,
      closedBy: req.userModel?._id,
      closedByUsername: req.userModel?.username || '',
      periodFrom,
      periodTo
    })

    // Tag every sale this close actually covered so the association survives
    // independent of the timestamp-range logic used to compute it — an auditor
    // (or a future bug hunt) can trust `Sale.dayCloseId` even if this query
    // changes later.
    if (sales.length) {
      await SaleT.updateMany({ _id: { $in: sales.map(s => s._id) } }, { $set: { dayCloseId: dc._id } })
    }

    return { status: 200, body: dc }
  } finally {
    await releaseLock(req.tenantId, 'day-close')
  }
}

export default { findLastDashboardClose, getDayCloseSummary, createDayClose }

/**
 * Cash-session reconciliation ("Fecho de Caixa").
 *
 * Shared by both entry points that may perform a close: the admin dashboard
 * (`routes/admin.js`, requireAdmin) and the kiosk itself (`routes/pos.js`,
 * requireKioskOrAdmin, gated client-side by the staff PIN). Kept in one place
 * so the two never drift into disagreeing about the opening-float chain,
 * the period boundary, or the concurrency guard.
 */
import { getEmailBrand } from './emailBrand.js'
import Sale from '../models/sale.js'
import DayClose from '../models/dayClose.js'
import { withTenant } from './tenant.js'
import { acquireLock, releaseLock } from '../models/lock.js'
import { sendMail } from './mailer.js'
import { renderEmailHtml, escapeHtml } from './emailTemplate.js'
import { getCashDrawerLedger, resetCashDrawerLedger } from './cashDrawer.js'

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
/**
 * The last REAL close (counted by a person). A float top-up ('adjustment') is not one: it used to be taken as the baseline, which
 * swept every sale since the real close into one "balanced" record that nobody had counted, and made all that cash the new "float"
 * (2026-11-08: 48 days, 534 sales, 2005.90 EUR became a starting float of 2182.40 EUR). Top-ups are added on top of the last real
 * close instead (see floatAddedSince).
 */
export async function findLastDashboardClose(DayCloseT) {
  const arr = await DayCloseT.find({ source: 'dashboard' }).sort({ createdAt: -1 }).limit(1).lean()
  return arr[0] || null
}

/** Cash put into the till (a hopper reinforcement, a float top-up) since the last real close: expected in the count, never a sale. */
export async function floatAddedSince(DayCloseT, lastClose) {
  const since = lastClose ? (lastClose.periodTo || lastClose.createdAt) : new Date(0)
  const rows = await DayCloseT.find({ source: 'adjustment', createdAt: { $gt: since } }).select('metadata').lean()
  return Number(rows.reduce((s, r) => s + (Number(r.metadata?.adjustmentAmount) || 0), 0).toFixed(2))
}

/**
 * One place that totals a set of sales, so the live summary and the close can never disagree.
 *  - cash / card: by payment method. Cash is what physically went through the till (recharges included);
 *    "card" is money spent from a card balance (it was cash when the card was topped up, earlier).
 *  - recharges: cash that was put ON cards. It is in the till, so it counts for the expected cash, but it is a
 *    prepayment, not a sale: revenue = cash + card - recharges (otherwise a 10 EUR top-up and the 10 EUR later
 *    spent from it would be reported as 20 EUR of sales).
 *  - refunds are negative rows of the same type/method as the sale they reverse, so they net out naturally.
 */
export function tallySales(sales) {
  let cash = 0, card = 0, mbway = 0, change = 0, prepaid = 0, cashPrepaid = 0
  for (const s of sales) {
    const amt = Number(s.amount || 0)
    if (s.method === 'cash') cash += amt
    else if (s.method === 'mbway') mbway += amt   // paid online (Eupago): money in the bank, never in the till
    else card += amt
    // Money that was put ON a card, to be spent later: a top-up, or the starting credit that comes with a new card.
    // It sits in the till today, but it is a prepayment: the sale is recorded when the card is spent.
    let pre = 0
    if (s.type === 'recharge') pre = amt
    else if (s.type === 'card_purchase') pre = Number(s.metadata && s.metadata.initialCredit || 0)
    prepaid += pre
    if (s.method === 'cash') cashPrepaid += pre
    change += Number(s.change || 0)
  }
  const r = (n) => Number(n.toFixed(2))
  return {
    totalCash: r(cash), totalCard: r(card), totalMbway: r(mbway), totalChangeDispensed: r(change),
    totalRecharges: r(prepaid),
    // The books follow the cash: money is recorded when it enters the till (sales, new cards, top-ups).
    // What customers later spend from their cards is shown for information only (totalCard) — it is not added again.
    // MB WAY is a real sale (revenue) that did not touch the till: it is in totalSales but never in the cash to count.
    totalSales: r(cash + mbway),
    cashSales: r(cash - cashPrepaid),
  }
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
  const tally = tallySales(sales)
  const tc = tally.totalCash
  const floatAdded = await floatAddedSince(DayCloseT, lastClose)
  const expectedCash = Number((openingFloat + tc + floatAdded).toFixed(2))

  // Coins/bills the hardware has actually accepted since the last close — see
  // services/cashDrawer.js. Lets Step 1 start from what's already known
  // instead of a full recount; the admin still confirms/corrects it.
  const acceptedDenominations = await getCashDrawerLedger(req).catch(() => [])
  const acceptedTotal = Number(acceptedDenominations.reduce((s, d) => s + d.value * d.count, 0).toFixed(2))

  return {
    periodFrom,
    periodTo: new Date(),
    openingFloat,
    floatAdded,
    totalCash: tc,
    cashSales: tally.cashSales,
    totalRecharges: tally.totalRecharges,
    totalCard: tally.totalCard,
    totalMbway: tally.totalMbway,
    totalSales: tally.totalSales,
    expectedCash,
    salesCount: sales.length,
    totalChangeDispensed: tally.totalChangeDispensed,
    acceptedDenominations,
    acceptedTotal,
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
    const tally = tallySales(sales)
    const tc = tally.totalCash
    const tk = tally.totalCard
    const floatAdded = await floatAddedSince(DayCloseT, lastClose)
    const expectedCash = Number((openingFloat + tc + floatAdded).toFixed(2))
    const totalChangeDispensed = tally.totalChangeDispensed

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
      floatAdded,
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
      totalMbway: tally.totalMbway,
      totalRecharges: tally.totalRecharges,
      totalSales: tally.totalSales,
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

    // What was just physically counted is the new ground truth — the
    // "accepted since last close" ledger starts fresh from here.
    await resetCashDrawerLedger(req).catch(() => { /* next Step 1 just starts unprefilled — not fatal */ })

    return { status: 200, body: dc }
  } finally {
    await releaseLock(req.tenantId, 'day-close')
  }
}

/**
 * Add cash straight to the float — for seeding a starting till, or topping
 * one up outside a normal count — without it ever being treated as bankable
 * sales money and without producing a false "discrepancy" in the history.
 *
 * Unlike `createDayClose`, this never asks for a physical count, and it is NOT a close: it does not touch the sales (they stay
 * open for the next real count) and does not become the baseline of the next period. It only records that this much was put in the
 * till; the next real close expects it on top of the last close's float (see floatAddedSince). `amountToBank` is always 0.
 *
 * `denominations` is the coin/bill breakdown (e.g. 10× €2) the admin actually
 * put in the till — the total is always derived from it server-side, the
 * same "never trust the client's arithmetic" rule `cleanDenoms` enforces for
 * a real close's counted denominations.
 */
export async function createFloatAdjustment(req, { amount, denominations = [], notes }) {
  const denomsClean = cleanDenoms(denominations)
  const amt = denomsClean.length ? denomsClean.reduce((s, d) => s + d.total, 0) : Number(amount)
  if (!Number.isFinite(amt) || amt <= 0) {
    return { status: 400, body: { error: 'amount must be a positive number' } }
  }

  const gotLock = await acquireLock(req.tenantId, 'day-close')
  if (!gotLock) {
    return { status: 409, body: { error: 'A cash session close is already in progress for this site. Please try again in a few seconds.' } }
  }

  try {
    const DayCloseT = withTenant(DayClose, req)

    const lastClose = await findLastDashboardClose(DayCloseT)
    const openingFloat = lastClose ? Number(lastClose.floatLeft || 0) : 0
    const now = new Date()
    const roundedAmt = Number(amt.toFixed(2))
    // Only the float: what was in the till at the last real close plus what has been put in since (this top-up included). The sales
    // since then are NOT swept in and NOT closed: they stay open for the next real count.
    const floatNow = Number((openingFloat + await floatAddedSince(DayCloseT, lastClose) + roundedAmt).toFixed(2))

    const dc = await DayCloseT.create({
      source: 'adjustment',
      openingFloat,
      expectedCash: floatNow,
      countedCash: floatNow,
      discrepancy: 0,
      countedDenominations: denomsClean,
      amountToBank: 0,
      floatLeft: floatNow,
      totalCash: 0,
      totalCard: 0,
      totalMbway: 0,
      totalRecharges: 0,
      totalSales: 0,
      salesCount: 0,
      notes: `Fundo adicionado: +${roundedAmt.toFixed(2)}€${notes ? ` — ${String(notes).slice(0, 400)}` : ''}`,
      closedBy: req.userModel?._id,
      closedByUsername: req.userModel?.username || '',
      periodFrom: now,
      periodTo: now,
      metadata: { adjustmentAmount: roundedAmt }
    })

    return { status: 200, body: dc }
  } finally {
    await releaseLock(req.tenantId, 'day-close')
  }
}

/** Plain-text Z-report body — mirrors the kiosk-printed version in src/lib/receipt.js so the two read identically. */
function formatDayCloseReceiptText(dc) {
  const f = (n) => Number(n || 0).toFixed(2)
  const lines = [
    'Fecho de Caixa', '',
    `Fundo inicial: €${f(dc.openingFloat)}`,
    `Vendas dinheiro: €${f(dc.totalCash)}`,
    `Vendas cartão: €${f(dc.totalCard)}`,
    `Esperado em caixa: €${f(dc.expectedCash)}`,
    `Contado: €${f(dc.countedCash)}`,
    `Diferença: €${f(dc.discrepancy)}`, '',
    `Para o banco: €${f(dc.amountToBank)}`,
    `Fundo para próxima sessão: €${f(dc.floatLeft)}`, '',
  ]
  if (dc.countedDenominations?.length) {
    lines.push('Contagem:')
    for (const d of dc.countedDenominations) {
      const label = d.value < 1 ? `${Math.round(d.value * 100)}c` : `${d.value}€`
      lines.push(`  ${label} x${d.count} = €${f(d.total)}`)
    }
    lines.push('')
  }
  if (dc.notes) lines.push(`Notas: ${dc.notes}`, '')
  lines.push(`Fechado por: ${dc.closedByUsername || '-'}`)
  lines.push(`Data: ${new Date(dc.periodTo || dc.createdAt).toLocaleString('pt-PT')}`)
  return lines.join('\n')
}

/** HTML twin of formatDayCloseReceiptText — same fields, same order. */
function formatDayCloseReceiptHtml(dc) {
  const f = (n) => Number(n || 0).toFixed(2)
  const row = (label, value, bold) => `<tr><td style="padding:5px 0; ${bold ? 'font-weight:bold;' : ''}">${escapeHtml(label)}</td><td style="padding:5px 0; text-align:right; ${bold ? 'font-weight:bold;' : ''}">€${value}</td></tr>`
  const rows = [
    row('Fundo inicial', f(dc.openingFloat)),
    row('Vendas dinheiro', f(dc.totalCash)),
    row('Vendas cartão', f(dc.totalCard)),
    row('Esperado em caixa', f(dc.expectedCash)),
    row('Contado', f(dc.countedCash)),
    row('Diferença', f(dc.discrepancy)),
    row('Para o banco', f(dc.amountToBank), true),
    row('Fundo para próxima sessão', f(dc.floatLeft), true),
  ].join('')

  let denomHtml = ''
  if (dc.countedDenominations?.length) {
    const denomRows = dc.countedDenominations.map((d) => {
      const label = d.value < 1 ? `${Math.round(d.value * 100)}c` : `${d.value}€`
      return row(`${label} x${d.count}`, f(d.total))
    }).join('')
    denomHtml = `<h3 style="margin:20px 0 8px; font-size:14px;">Contagem</h3><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${denomRows}</table>`
  }
  const notesHtml = dc.notes ? `<p style="margin-top:16px;"><strong>Notas:</strong> ${escapeHtml(dc.notes)}</p>` : ''

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
    ${denomHtml}
    ${notesHtml}
    <p style="margin-top:20px; font-size:13px; color:#3d6a63;">
      Fechado por: ${escapeHtml(dc.closedByUsername || '-')}<br>
      ${escapeHtml(new Date(dc.periodTo || dc.createdAt).toLocaleString('pt-PT'))}
    </p>
  `
}

/** Email a Z-report summary of one close (or float adjustment) — same record the history view already renders. */
export async function emailDayCloseReceipt(req, id, email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) {
    return { status: 400, body: { error: 'A valid email is required' } }
  }
  const DayCloseT = withTenant(DayClose, req)
  const dc = await DayCloseT.findById(id).lean()
  if (!dc) return { status: 404, body: { error: 'Cash session record not found' } }

  await sendMail({
    tenantId: req.tenantId,
    to: email,
    subject: 'Fecho de Caixa',
    text: formatDayCloseReceiptText(dc),
    html: renderEmailHtml({ title: 'Fecho de Caixa', bodyHtml: formatDayCloseReceiptHtml(dc), brand: await getEmailBrand(req.tenantId) }),
  })
  return { status: 200, body: { success: true } }
}

export default { findLastDashboardClose, getDayCloseSummary, createDayClose, createFloatAdjustment, emailDayCloseReceipt }

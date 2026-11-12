/**
 * Live per-denomination tracking of coins/bills physically accepted into the
 * cash drawer — the same idea as a hopper's `currentCount` (see
 * models/peripheral.js), just for the drawer instead of a payout hopper.
 *
 * Unlike the hopper, there's no sensor confirming what's still physically in
 * the drawer (it's a mechanical box, not something a coin counts itself back
 * out of) — so this only tracks what's gone IN since the last real close, not
 * the drawer's total contents. That's still enough to remove the "recount
 * everything from zero" tedium for the common case: nothing here claims to
 * know about cash that entered the drawer some other way (a manual top-up,
 * which goes through the float-adjustment flow instead and doesn't touch
 * this ledger).
 */
import Setting from '../models/setting.js'
import { withTenant } from './tenant.js'

export const CASH_DRAWER_DENOMS = [0.05, 0.10, 0.20, 0.50, 1.00, 2.00, 5, 10, 20, 50, 100, 200]
const LEDGER_KEY = 'cashDrawerLedger'

function emptyLedger() {
  return CASH_DRAWER_DENOMS.map(v => ({ value: v, count: 0 }))
}

/** Denomination breakdown accepted since the last real close — read by getDayCloseSummary. */
export async function getCashDrawerLedger(req) {
  const SettingT = withTenant(Setting, req)
  const s = await SettingT.findOne({ key: LEDGER_KEY })
  return s?.value?.length ? s.value : emptyLedger()
}

/**
 * Fire-and-forget increment — call on every accepted coin/bill. Never throws:
 * a missed increment just means Step 1's prefill drifts slightly, which the
 * operator corrects the same way they'd correct any other prefill.
 */
export async function incrementCashDrawer(tenantId, value) {
  if (!tenantId) return
  const rounded = Number(value)
  if (!CASH_DRAWER_DENOMS.some(d => Math.abs(d - rounded) < 0.001)) return
  try {
    const res = await Setting.updateOne(
      { tenantId, key: LEDGER_KEY, 'value.value': rounded },
      { $inc: { 'value.$.count': 1 } }
    )
    if (res.matchedCount === 0) {
      // No ledger yet for this tenant (or this denomination missing from an
      // older ledger shape) — seed a full one, then retry the increment.
      await Setting.updateOne(
        { tenantId, key: LEDGER_KEY },
        { $setOnInsert: { tenantId, key: LEDGER_KEY, value: emptyLedger() } },
        { upsert: true }
      )
      await Setting.updateOne(
        { tenantId, key: LEDGER_KEY, 'value.value': rounded },
        { $inc: { 'value.$.count': 1 } }
      )
    }
  } catch (e) {
    console.error('[cashDrawer] increment failed:', e.message)
  }
}

/** Reset to zero — called right after a real close, since what was just counted becomes the new physical baseline. */
export async function resetCashDrawerLedger(req) {
  const SettingT = withTenant(Setting, req)
  await SettingT.findOneAndUpdate(
    { key: LEDGER_KEY },
    { $set: { value: emptyLedger() } },
    { upsert: true }
  )
  // the shop PC counts the coins and notes (only it hears them go in): it starts again from this moment (see reconcileShopLedger)
  await SettingT.findOneAndUpdate({ key: RESET_KEY }, { $set: { value: new Date().toISOString() } }, { upsert: true })
}

// ── Which side owns what ──
// The coins and notes the hardware accepts are only heard on the SHOP PC, but the day close is done on the central server. The ledger was
// kept on both and the central copy (all zeros) was copied back over the shop's every 30 s, so the counting screen always opened with
// no coins and no notes (2026-11-12). Now the shop owns its ledger (it is never overwritten from the central settings) and sends it up;
// the central server only says when the last real close was (RESET_KEY).
export const RESET_KEY = 'cashDrawer.resetAt'
export const SINCE_KEY = 'cashDrawerLedger.since'
export const SHOP_OWNED_SETTINGS = new Set([LEDGER_KEY, SINCE_KEY])
/** The settings the shop may take from the central server: all but what the shop itself owns. */
export const applicableSettings = (docs) => docs.filter((d) => !SHOP_OWNED_SETTINGS.has(d.key))

/** Count the coins and notes that went in since `since`, from the flows (every credit writes a cash_in step). */
export async function ledgerFromFlows(tenantId, FlowModel, since) {
  const rows = await FlowModel.aggregate([
    { $match: { tenantId, lastAt: { $gte: since } } },
    { $unwind: '$steps' },
    { $match: { 'steps.type': 'cash_in', 'steps.at': { $gte: since } } },
    { $group: { _id: '$steps.data.value', n: { $sum: 1 } } },
  ])
  const led = emptyLedger()
  for (const r of rows) { const d = led.find((x) => Math.abs(x.value - Number(r._id)) < 0.001); if (d) d.count += r.n }
  return led
}

/**
 * Shop PC: make the ledger match the last real close the central server announced. A ledger with no start date is built once from the
 * flows since that close (what went in before this fix is not lost); one older than the close is zeroed (a close counted the cash).
 */
export async function reconcileShopLedger(tenantId, FlowModel) {
  const resetRow = await Setting.findOne({ tenantId, key: RESET_KEY }).lean()
  const resetAt = resetRow?.value ? new Date(resetRow.value) : null
  const sinceRow = await Setting.findOne({ tenantId, key: SINCE_KEY }).lean()
  const since = sinceRow?.value ? new Date(sinceRow.value) : null
  if (!since) {
    const led = resetAt && FlowModel ? await ledgerFromFlows(tenantId, FlowModel, resetAt) : emptyLedger()
    await Setting.updateOne({ tenantId, key: LEDGER_KEY }, { $set: { value: led } }, { upsert: true })
    await Setting.updateOne({ tenantId, key: SINCE_KEY }, { $set: { value: (resetAt || new Date()).toISOString() } }, { upsert: true })
    return 'seeded'
  }
  if (resetAt && resetAt > since) {
    await Setting.updateOne({ tenantId, key: LEDGER_KEY }, { $set: { value: emptyLedger() } }, { upsert: true })
    await Setting.updateOne({ tenantId, key: SINCE_KEY }, { $set: { value: resetAt.toISOString() } }, { upsert: true })
    return 'reset'
  }
  return 'ok'
}

/** What the shop sends to the central server: the counts and the close they start from. */
export async function readLedgerPayload(tenantId) {
  const [led, since] = await Promise.all([Setting.findOne({ tenantId, key: LEDGER_KEY }).lean(), Setting.findOne({ tenantId, key: SINCE_KEY }).lean()])
  return { since: since?.value || null, counts: (led?.value?.length ? led.value : emptyLedger()).filter((d) => d.count > 0).map((d) => ({ value: d.value, count: d.count })) }
}

/** Central server, once at start: a tenant with no RESET_KEY gets the end of its last real close. */
export async function ensureResetMarker(DayCloseModel) {
  const tenants = await DayCloseModel.distinct('tenantId', { source: 'dashboard' })
  let n = 0
  for (const t of tenants) {
    if (await Setting.exists({ tenantId: t, key: RESET_KEY })) continue
    const last = await DayCloseModel.findOne({ tenantId: t, source: 'dashboard' }).sort({ createdAt: -1 }).lean()
    await Setting.updateOne({ tenantId: t, key: RESET_KEY }, { $set: { value: new Date(last.periodTo || last.createdAt).toISOString() } }, { upsert: true })
    n++
  }
  return n
}

export default { getCashDrawerLedger, incrementCashDrawer, resetCashDrawerLedger }

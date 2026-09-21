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
}

export default { getCashDrawerLedger, incrementCashDrawer, resetCashDrawerLedger }

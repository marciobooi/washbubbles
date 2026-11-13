/**
 * Hopper reinforcement ("reforço"): coins brought from OUTSIDE are put into the change dispenser — e.g. the 1 EUR
 * coins ran out. Two things happen together:
 *   1. the stock the system keeps for the hopper that holds that coin goes up (hopperConfig.currentCount), and
 *   2. the money is booked as float (a "Fundo adicionado" adjustment), never as a sale, so the expected cash of the
 *      session stays right.
 * A coin value with no hopper configured for it is still booked as float and reported back (`noHopper`), so nothing
 * is silently lost and the operator sees it.
 */
import Peripheral from '../models/peripheral.js'
import { withTenant } from './tenant.js'
import { createFloatAdjustment } from './dayClose.js'

export const REFILL_COINS = [0.05, 0.10, 0.20, 0.50, 1.00, 2.00]

/**
 * "Repor": the SAME coins that are already in the cash float go back into the hopper (after it was emptied to count them). Nothing
 * is booked as money: only what the hopper holds again is written down, so the hopper screen opens with it. Not a reinforcement.
 */
export async function restoreHopper(req, { coins = [], notes = '' } = {}) {
  const clean = (Array.isArray(coins) ? coins : [])
    .map((c) => ({ value: Number(c && c.value), count: Math.floor(Number(c && c.count)) }))
    .filter((c) => REFILL_COINS.some((v) => Math.abs(v - c.value) < 0.001) && Number.isFinite(c.count) && c.count > 0)
  if (!clean.length) return { status: 400, body: { error: 'Indique pelo menos uma moeda' } }
  const { default: Setting } = await import('../models/setting.js')
  const total = Number(clean.reduce((s, c) => s + c.value * c.count, 0).toFixed(2))
  const value = { at: new Date().toISOString(), coins: clean, total, by: req.userModel?.username || '', notes: String(notes || '').slice(0, 300) }
  await withTenant(Setting, req).findOneAndUpdate({ key: 'hopperRestore' }, { $set: { value } }, { upsert: true })
  return { status: 200, body: { restored: value } }
}

export async function refillHopper(req, { coins = [], notes = '' } = {}) {
  const clean = (Array.isArray(coins) ? coins : [])
    .map((c) => ({ value: Number(c && c.value), count: Math.floor(Number(c && c.count)) }))
    .filter((c) => REFILL_COINS.some((v) => Math.abs(v - c.value) < 0.001) && Number.isFinite(c.count) && c.count > 0)
  if (!clean.length) return { status: 400, body: { error: 'Indique pelo menos uma moeda para o reforço' } }

  const PeripheralT = withTenant(Peripheral, req)
  const hoppers = await PeripheralT.find({ type: 'hopper', enabled: true })
  const refilled = []
  const noHopper = []
  for (const c of clean) {
    const h = hoppers.find((x) => Math.abs(Number(x.hopperConfig?.coinValue) - c.value) < 0.001)
    if (!h) { noHopper.push(c); continue }
    await PeripheralT.findOneAndUpdate({ _id: h._id }, { $inc: { 'hopperConfig.currentCount': c.count } })
    refilled.push({ ...c, hopper: h.name, hopperId: h._id })
  }

  const label = clean.map((c) => `${c.count}×${c.value}€`).join(', ')
  const { status, body } = await createFloatAdjustment(req, {
    denominations: clean,
    notes: `Reforço do hopper: ${label}${notes ? ` — ${String(notes).slice(0, 300)}` : ''}`,
  })
  if (status !== 200) {
    // The cash movement was refused (e.g. a day close is running): the stock goes back, or it would count coins nobody booked.
    for (const r of refilled) await PeripheralT.findOneAndUpdate({ _id: r.hopperId }, { $inc: { 'hopperConfig.currentCount': -r.count } })
    return { status, body }
  }
  return { status: 200, body: { adjustment: body, refilled: refilled.map(({ hopperId, ...r }) => r), noHopper } }
}

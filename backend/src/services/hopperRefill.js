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
    refilled.push({ ...c, hopper: h.name })
  }

  const label = clean.map((c) => `${c.count}×${c.value}€`).join(', ')
  const { status, body } = await createFloatAdjustment(req, {
    denominations: clean,
    notes: `Reforço do hopper: ${label}${notes ? ` — ${String(notes).slice(0, 300)}` : ''}`,
  })
  if (status !== 200) return { status, body }
  return { status: 200, body: { adjustment: body, refilled, noHopper } }
}

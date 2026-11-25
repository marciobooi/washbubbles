/**
 * A flow step marked ok:false is either a WARNING (something the customer did or a normal hiccup the system handled: a cancelled MB WAY,
 * a coin the machine did not accept, a change retry) or a real PROBLEM (the customer may be out of pocket: paid but the machine did not start,
 * change short, credit held, controller did not confirm). Only problems turn a flow red; warnings are orange.
 * Classification is by step type, so flows saved before this existed are shown correctly too.
 */
export const WARNING_STEP_TYPES = new Set(['mbway_cancelled', 'cash_rejected', 'change_retry'])

const PAID_TYPES = new Set(['sale_recorded', 'recharge_done', 'card_sold', 'mbway_paid'])

/** @returns {{problems:number, warnings:number}} counted from the steps (pay_refused in a flow that was later paid is ignored, as before) */
export function countSeverity(steps) {
  const paid = (steps || []).some((s) => s && PAID_TYPES.has(s.type))
  let problems = 0
  let warnings = 0
  for (const s of steps || []) {
    if (!s || s.ok !== false) continue
    if (paid && s.type === 'pay_refused') continue
    if (WARNING_STEP_TYPES.has(s.type)) warnings += 1
    else problems += 1
  }
  return { problems, warnings }
}

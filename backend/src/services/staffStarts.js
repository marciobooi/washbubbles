/**
 * The cycles the staff and the admin started by hand. They are NOT reliably in the sales (only some start routes write a sale row: on
 * 2026-11-10 there were 62 such sales against 256 starts in the flows), so the flows are the record: every start writes an
 * `admin_start` step. A DRYER also writes an `impulse_sent` once the controller took it, so a dryer start without one did not happen;
 * a washer writes nothing after it, so it counts unless a step marked as a problem follows it in the same flow.
 */
import Flow from '../models/flow.js'

/** [{ name, at, blocks }] for the shop's staff starts, newest first. `from`/`to` limit by date (optional). */
export async function staffStarts(tenantId, { from = null, to = null, dryNames = new Set() } = {}) {
  const q = { tenantId, 'steps.type': 'admin_start' }
  if (from) q.lastAt = { $gte: from }
  const flows = await Flow.find(q).select('steps').lean()
  const out = []
  for (const f of flows) {
    const steps = f.steps || []
    steps.forEach((s, i) => {
      if (s.type !== 'admin_start' || !s.data?.machine) return
      const after = steps.slice(i + 1)
      const dry = dryNames.has(String(s.data.machine).trim().toLowerCase())
      const took = dry ? after.some((x) => x.type === 'impulse_sent' && x.data?.machine === s.data.machine) : !after.some((x) => x.ok === false)
      const at = new Date(s.at)
      if (!took || (from && at < from) || (to && at >= to)) return
      out.push({ name: String(s.data.machine), at, blocks: Number(s.data.blocks) || 1 })
    })
  }
  return out.sort((a, b) => b.at - a.at)
}

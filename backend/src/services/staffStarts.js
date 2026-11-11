/**
 * The cycles the staff and the admin started by hand. They are NOT reliably in the sales (only some start routes write a sale row: on
 * 2026-11-10 there were 62 such sales against 256 starts in the flows), so the flows are the record: every start writes an
 * `admin_start` step and, once the controller took it, an `impulse_sent` step for the same machine. A start with no impulse after it
 * (the controller was away, the machine was already running) did not happen and is not counted.
 */
import Flow from '../models/flow.js'

/** [{ name, at, blocks }] for the shop's staff starts, newest first. `from`/`to` limit by date (optional). */
export async function staffStarts(tenantId, { from = null, to = null } = {}) {
  const q = { tenantId, 'steps.type': 'admin_start' }
  if (from) q.lastAt = { $gte: from }
  const flows = await Flow.find(q).select('steps').lean()
  const out = []
  for (const f of flows) {
    const steps = f.steps || []
    steps.forEach((s, i) => {
      if (s.type !== 'admin_start' || !s.data?.machine) return
      const took = steps.slice(i + 1).some((x) => x.type === 'impulse_sent' && x.data?.machine === s.data.machine)
      const at = new Date(s.at)
      if (!took || (from && at < from) || (to && at >= to)) return
      out.push({ name: String(s.data.machine), at, blocks: Number(s.data.blocks) || 1 })
    })
  }
  return out.sort((a, b) => b.at - a.at)
}

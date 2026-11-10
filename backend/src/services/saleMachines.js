/**
 * Which machine a sale was for. The shop's sales reached the central server WITHOUT their machine for weeks (only 12 of 495 had one on
 * 2026-11-10), so "Utilização das máquinas" counted almost nothing. The machine is still in the sale's own line (items[].productId is
 * the machine's id, items[].name its name), so it is recovered from there: by id when the shop knows it, else by name when exactly one
 * machine of the shop has that name. Idempotent: only sales with no machine are touched, and only when the match is certain.
 */
import mongoose from 'mongoose'
import Sale from '../models/sale.js'
import Machine from '../models/machine.js'

export async function backfillSaleMachines() {
  let fixed = 0
  const machines = await Machine.find({}).select('_id tenantId name').lean()
  const byTenant = new Map()
  for (const m of machines) {
    const t = String(m.tenantId)
    if (!byTenant.has(t)) byTenant.set(t, { ids: new Set(), names: new Map() })
    const e = byTenant.get(t)
    e.ids.add(String(m._id))
    const k = String(m.name || '').trim().toLowerCase()
    e.names.set(k, e.names.has(k) ? null : String(m._id)) // two machines with one name: ambiguous, never guessed
  }
  const cursor = Sale.find({ type: 'payment', $or: [{ machineId: null }, { machineId: { $exists: false } }] }).select('_id tenantId items').lean().cursor()
  const ops = []
  for await (const s of cursor) {
    const e = byTenant.get(String(s.tenantId))
    const line = Array.isArray(s.items) ? s.items[0] : null
    if (!e || !line) continue
    const byId = [line.productId, line._id].map(String).find((v) => mongoose.isValidObjectId(v) && e.ids.has(v))
    const id = byId || e.names.get(String(line.name || '').trim().toLowerCase())
    if (!id) continue
    ops.push({ updateOne: { filter: { _id: s._id, machineId: { $in: [null, undefined] } }, update: { $set: { machineId: new mongoose.Types.ObjectId(id) } } } })
    if (ops.length >= 500) { fixed += (await Sale.bulkWrite(ops)).modifiedCount; ops.length = 0 }
  }
  if (ops.length) fixed += (await Sale.bulkWrite(ops)).modifiedCount
  return fixed
}

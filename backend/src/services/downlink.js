/**
 * Central downlink — keep this site's configuration in step with the central
 * server (Hetzner), which is the source of truth. The local database is only
 * a working copy so the shop keeps running when the internet is down.
 *
 * Pulls machines, prices, interfaces, peripherals and settings from the
 * server's existing `/api/sync/pull/*` endpoints (the mirror image of
 * services/uplink.js, which pushes sales/cards/day-closes up).
 *
 * Rules, learned from the Electron sync engine's history of wiping config:
 *  - Always a FULL snapshot, never `?since=`: a partial result must not be able
 *    to delete the rest. An EMPTY or failed response changes nothing.
 *  - Machines: only configuration is overwritten. Runtime state (status, cycle,
 *    reservation, running program) belongs to this site and is never touched.
 *  - Settings are upserted by key and never deleted, so site-only keys survive.
 *  - Central ids are kept, and the tenant is remapped to this site's tenant.
 *  - Never throws into the caller: offline is a normal state.
 *
 * Enabled by the same SYNC_SERVER_URL / SYNC_API_KEY as the uplink.
 * Reference: docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md §14
 */
import EventEmitter from 'events'
import mongoose from 'mongoose'
import Machine from '../models/machine.js'
import Price from '../models/price.js'
import Setting from '../models/setting.js'
import Interface from '../models/interface.js'
import Peripheral from '../models/peripheral.js'

/** Machine fields owned by this site at runtime; a pull never overwrites them. */
export const MACHINE_RUNTIME_FIELDS = [
  'status', 'statusText', 'cycle', 'reserved', 'reservedBy', 'reservedAt',
  'reservationDuration', 'currentProgram', 'startedAt', 'estimatedEndTime',
  'runningDuration', 'lastServicedAt', 'pendingImpulses', 'nextImpulseAt',
]

/** Peripheral fields owned by this site: live status from the controller, and the hopper's coin stock. */
export const PERIPHERAL_RUNTIME_FIELDS = ['status', 'hopperConfig.currentCount', 'hopperConfig.currentStock']

/** Order matters: interfaces before the machines that point at them. */
export const RESOURCES = [
  { name: 'interfaces', Model: Interface, prune: true },
  { name: 'peripherals', Model: Peripheral, prune: true, skip: PERIPHERAL_RUNTIME_FIELDS, flatten: ['hopperConfig'] },
  { name: 'prices', Model: Price, prune: true },
  { name: 'machines', Model: Machine, prune: true, skip: MACHINE_RUNTIME_FIELDS },
  { name: 'settings', Model: Setting, prune: false },
]

const toOid = (v) => (v && mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : v)

/** Turn a pulled JSON document into a Mongo-ready one for this site. */
export function localDoc(item, tenantId, skip = []) {
  const doc = { ...item, tenantId: toOid(tenantId) }
  delete doc.__v
  for (const k of skip) {
    const [head, ...rest] = k.split('.')
    if (!rest.length) { delete doc[head]; continue }
    // Dotted path: drop just that nested field, keep the rest of the sub-document.
    if (doc[head] && typeof doc[head] === 'object') {
      doc[head] = { ...doc[head] }
      delete doc[head][rest.join('.')]
    }
  }
  for (const k of ['_id', 'interfaceId']) if (doc[k]) doc[k] = toOid(doc[k])
  for (const k of ['createdAt', 'updatedAt', 'reservedAt', 'startedAt']) {
    if (typeof doc[k] === 'string') doc[k] = new Date(doc[k])
  }
  return doc
}

export class Downlink extends EventEmitter {
  constructor({
    tenantId,
    url = process.env.SYNC_SERVER_URL,
    apiKey = process.env.SYNC_API_KEY,
    // Hetzner is the source of truth: a change made there (admin or straight in the database) must reach
    // the shop quickly. DOWNLINK_INTERVAL_MS overrides it; admin changes also trigger an immediate pull.
    intervalMs = Number(process.env.DOWNLINK_INTERVAL_MS) || 30_000,
    timeoutMs = 15_000,
    fetchImpl = globalThis.fetch,
    resources = RESOURCES,
  }) {
    super()
    this.tenantId = tenantId
    this.url = url ? String(url).replace(/\/+$/, '') : ''
    this.apiKey = apiKey
    this.intervalMs = intervalMs
    this.timeoutMs = timeoutMs
    this.fetch = fetchImpl
    this.resources = resources
    this.timer = null
    this.pulling = null
    this.lastPullAt = null
    this.lastError = ''
    this.counts = {}
  }

  get enabled() {
    return Boolean(this.url && this.apiKey) && process.env.SYNC_ENABLED !== 'false'
  }

  start() {
    if (!this.enabled) return
    this.timer = setInterval(() => this.pullAll().catch(() => {}), this.intervalMs)
    this.timer.unref?.()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = null
  }

  /** Pull every resource once. Safe to call concurrently; never rejects. */
  pullAll() {
    if (!this.enabled) return Promise.resolve(false)
    if (this.pulling) return this.pulling
    this.pulling = (async () => {
      try {
        for (const r of this.resources) await this.pullResource(r)
        this.lastPullAt = new Date()
        this.lastError = ''
        this.emit('synced', { ...this.counts })
        console.log('[Downlink] in step with central:', JSON.stringify(this.counts))
        return true
      } catch (err) {
        this.lastError = err.message
        console.warn(`[Downlink] pull skipped (${err.message}) - keeping local configuration`)
        return false
      } finally {
        this.pulling = null
      }
    })()
    return this.pulling
  }

  async fetchSnapshot(name) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await this.fetch(`${this.url}/sync/pull/${name}`, {
        headers: { Authorization: `ApiKey ${this.apiKey}` },
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
      const body = await res.json()
      if (!Array.isArray(body)) throw new Error(`${name}: unexpected response`)
      return body
    } finally {
      clearTimeout(t)
    }
  }

  async pullResource({ name, Model, prune, skip = [], flatten = [] }) {
    const items = await this.fetchSnapshot(name)
    // An empty snapshot is never trusted to mean "delete everything".
    if (items.length === 0) { this.counts[name] = 0; return }

    const docs = items.map((i) => localDoc(i, this.tenantId, skip))
    const tenant = toOid(this.tenantId)

    if (prune) {
      // Drop local rows central no longer has FIRST, so a different local row can
      // never block an insert through a unique index (price type+weight, ...).
      await Model.deleteMany({ tenantId: tenant, _id: { $nin: docs.map((d) => d._id) } })
    }
    const ops = docs.map((d) => {
      if (name === 'settings') {
        const { _id, ...rest } = d
        return { updateOne: { filter: { tenantId: tenant, key: d.key }, update: { $set: rest }, upsert: true } }
      }
      const { _id, ...rest } = d
      // Sub-documents named in `flatten` are set field by field (hopperConfig.coinValue, ...)
      // so site-owned fields inside them, such as the hopper's coin count, survive.
      for (const f of flatten) {
        if (rest[f] && typeof rest[f] === 'object' && !Array.isArray(rest[f])) {
          for (const [k, v] of Object.entries(rest[f])) rest[`${f}.${k}`] = v
          delete rest[f]
        }
      }
      return { updateOne: { filter: { _id }, update: { $set: rest }, upsert: true } }
    })
    await Model.bulkWrite(ops, { ordered: true })
    if (name === 'machines') {
      // `status` is runtime state and is never pulled, but "out of service" is the operator's decision
      // made on the central server: the shop must show it and refuse the sale.
      await Model.updateMany({ tenantId: tenant, outOfService: true, serviceStatus: 'fault', status: { $ne: 'fault' } },
        { $set: { status: 'fault', statusText: 'Avariada' } })
      await Model.updateMany({ tenantId: tenant, outOfService: true, serviceStatus: { $ne: 'fault' }, status: { $ne: 'offline' } },
        { $set: { status: 'offline', statusText: 'Fora de servi\u00e7o' } })
      await Model.updateMany({ tenantId: tenant, outOfService: { $ne: true }, status: 'offline' },
        { $set: { status: 'free', statusText: '' } })
    }
    this.counts[name] = docs.length
  }

  status() {
    return { enabled: this.enabled, lastPullAt: this.lastPullAt, lastError: this.lastError, counts: this.counts }
  }
}

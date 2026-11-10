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
import Sale from '../models/sale.js'
import Coupon from '../models/coupon.js'
import Card from '../models/card.js'
import AuditLog from '../models/auditLog.js'

/** Machine fields owned by this site at runtime; a pull never overwrites them. */
export const MACHINE_RUNTIME_FIELDS = [
  'status', 'statusText', 'cycle', 'reserved', 'reservedBy', 'reservedAt',
  'reservationDuration', 'currentProgram', 'startedAt', 'estimatedEndTime',
  'runningDuration', 'lastServicedAt', 'pendingImpulses', 'nextImpulseAt', 'busyUntil', 'sawBusy',
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
    // the shop PC tells us whether a card is in the reader (its balance is then in the session: leave it alone) and writes the chip
    cardBusy = () => false,
    onCardAdjusted = () => {},
  }) {
    super()
    this.cardBusy = cardBusy
    this.onCardAdjusted = onCardAdjusted
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
        await this.pullSaleCorrections().catch((e) => console.warn('[Downlink] sale corrections skipped:', e.message))
        await this.pullCoupons().catch((e) => console.warn('[Downlink] coupons skipped:', e.message))
        await this.pullCards().catch((e) => console.warn('[Downlink] cards skipped:', e.message))
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

  async fetchSnapshot(name, { object = false } = {}) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await this.fetch(`${this.url}/sync/pull/${name}`, {
        headers: { Authorization: `ApiKey ${this.apiKey}` },
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
      const body = await res.json()
      if (object ? (!body || typeof body !== 'object' || Array.isArray(body)) : !Array.isArray(body)) throw new Error(`${name}: unexpected response`)
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
      const gone = { tenantId: tenant, _id: { $nin: docs.map((d) => d._id) } }
      // A snapshot that would delete most of what is here is more likely a half answer than a real clean-up: nothing is deleted
      // this round (it is asked again in 30 s; a real clean-up of that size is done one shop row at a time or by hand).
      const [doomed, total] = await Promise.all([Model.countDocuments(gone), Model.countDocuments({ tenantId: tenant })])
      if (doomed >= 3 && doomed > total / 2) {
        if (Date.now() - (this.pruneWarned?.[name] || 0) > 3600_000) {
          this.pruneWarned = { ...(this.pruneWarned || {}), [name]: Date.now() }
          console.warn(`[Downlink] ${name}: the central list would delete ${doomed} of ${total} rows here: nothing deleted`)
          AuditLog.create({ tenantId: tenant, actorUsername: 'downlink', action: 'sync.prune.refused', targetType: name, targetId: '', details: { wouldDelete: doomed, of: total, received: docs.length } }).catch(() => {})
        }
      } else {
        // a machine that is running (or reserved by a payment in progress) is never deleted under the customer: it goes when it is free
        if (name === 'machines') gone.status = { $nin: ['working', 'reserved'] }
        await Model.deleteMany(gone)
      }
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
      // Back in service: only the machines that were offline BECAUSE of that decision. One the controller reports as not
      // answering is also 'offline' and must stay unsellable (it used to be freed here every 30 s).
      await Model.updateMany({ tenantId: tenant, outOfService: { $ne: true }, status: 'offline', statusText: 'Fora de servi\u00e7o' },
        { $set: { status: 'free', statusText: '' } })
    }
    this.counts[name] = docs.length
  }

  /**
   * A refund or void the central admin made on a sale: copy it here. Without this the shop kept the sale as it was (the two sides
   * disagreed for good). Written with updates, not save(): these rows came FROM the server and must not be sent back to it.
   */
  async pullSaleCorrections() {
    const body = await this.fetchSnapshot('sale-corrections', { object: true })
    const tenant = toOid(this.tenantId)
    let changed = 0
    for (const r of body.refunded || []) {
      if (!r.localId || !mongoose.isValidObjectId(r.localId)) continue
      const u = await Sale.updateOne({ _id: r.localId, tenantId: tenant, status: { $ne: 'refunded' } }, { $set: { status: 'refunded' } })
      changed += u.modifiedCount || 0
    }
    for (const r of body.refunds || []) {
      if (r.localId) continue // this shop made it itself
      const u = await Sale.updateOne(
        { tenantId: tenant, 'metadata.centralId': String(r.id) },
        { $setOnInsert: {
          machineId: r.machineId && mongoose.isValidObjectId(r.machineId) ? toOid(r.machineId) : null,
          amount: r.amount, type: 'refund', method: r.method, batchId: r.batchId || `refund-${r.id}`, status: 'completed',
          refundOf: r.refundOfLocalId && mongoose.isValidObjectId(r.refundOfLocalId) ? toOid(r.refundOfLocalId) : null,
          refundReason: r.refundReason || '', inserted: 0, change: 0, items: [], createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
          'metadata.syncedAt': new Date(),
        } },
        { upsert: true },
      )
      changed += u.upsertedCount || 0
    }
    if (changed) console.log(`[Downlink] ${changed} sale correction(s) from central applied`)
    return changed
  }

  /**
   * Coupons are made on the central server and USED at the shop. Settings (code, discount, expiry, limit, on/off) come from central;
   * the count of uses is the larger of the two (the shop sends its own up, see uplink). A coupon central no longer has is switched
   * off here, not deleted. Keyed by code (the ids differ).
   */
  async pullCoupons() {
    const items = await this.fetchSnapshot('coupons')
    const tenant = toOid(this.tenantId)
    for (const item of items) {
      const code = String(item.code || '').toUpperCase().trim()
      if (!code) continue
      const { _id, __v, tenantId, redemptionCount, createdAt, code: _c, ...cfg } = item
      await Coupon.updateOne({ tenantId: tenant, code }, { $set: cfg, $max: { redemptionCount: Number(redemptionCount) || 0 } }, { upsert: true })
    }
    await Coupon.updateMany({ tenantId: tenant, code: { $nin: items.map((i) => String(i.code || '').toUpperCase().trim()) }, active: true }, { $set: { active: false } })
    this.counts.coupons = items.length
    return items.length
  }

  /**
   * What the central admin did to CARDS, copied here:
   *  - blocked (lost, stolen): blocked here too. Only ever blocks on its own.
   *  - the holder's details: the NEWER edit wins (profileEditedAt), so the shop's own newer edit is not wound back.
   *  - a balance change (a manual edit, a refund onto the card): applied here ONCE (by opId) and acknowledged, so central stops
   *    offering it. The shop's balance is otherwise never overwritten (the card carries it). A card in the reader is left for the next round.
   */
  async pullCards() {
    const items = await this.fetchSnapshot('cards')
    const tenant = toOid(this.tenantId)
    let changed = 0
    for (const c of items) {
      if (!c.code) continue
      const local = await Card.findOne({ tenantId: tenant, code: String(c.code) }).lean()
      if (!local) continue
      if (c.status === 'blocked' && local.status !== 'blocked') {
        await Card.updateOne({ _id: local._id }, { $set: { status: 'blocked' } })
        changed++
      }
      const cAt = c.profileEditedAt ? new Date(c.profileEditedAt) : null
      if (cAt && !Number.isNaN(cAt.getTime()) && (!local.profileEditedAt || cAt > new Date(local.profileEditedAt))) {
        await Card.updateOne({ _id: local._id }, { $set: { name: c.name || '', email: c.email || '', phone: c.phone || '', contribuinte: c.contribuinte || '', profileEditedAt: cAt } })
        changed++
      }
      const adj = Array.isArray(c.shopAdjustments) ? c.shopAdjustments : []
      if (adj.length && !this.cardBusy(String(c.code))) {
        const done = []
        let fresh = local
        for (const a of adj) {
          if (!a?.opId || !Number.isFinite(Number(a.delta))) continue
          if ((fresh.appliedDeltas || []).includes(a.opId)) { done.push(a.opId); continue } // applied before, only the acknowledgement was lost
          const wanted = Math.round((Number(fresh.balance || 0) + Number(a.delta)) * 100) / 100
          const next = Math.max(0, wanted)
          const u = await Card.findOneAndUpdate(
            { _id: local._id, balance: fresh.balance, appliedDeltas: { $ne: a.opId } },
            { $set: { balance: next }, $push: { appliedDeltas: { $each: [a.opId], $slice: -200 } } },
            { new: true },
          ).lean()
          if (!u) break // the balance moved under us: try again next round
          fresh = u
          done.push(a.opId)
          changed++
          // A debit bigger than what the card still had here (the customer spent it meanwhile): the balance stops at zero and the
          // part that could not be taken is written down, instead of passing as fully applied.
          if (wanted < 0) {
            const short = Math.round(-wanted * 100) / 100
            console.warn(`[downlink] card ${c.code}: adjustment ${a.opId} of ${Number(a.delta).toFixed(2)} applied only in part, ${short.toFixed(2)} could not be taken (balance was not enough)`)
            await AuditLog.create({ tenantId: tenant, actorUsername: 'system', action: 'card.adjust.short', targetType: 'Card', targetId: String(local._id), details: { code: String(c.code), opId: a.opId, delta: Number(a.delta), notTaken: short } }).catch((e) => console.error('[downlink] audit:', e.message))
          }
        }
        if (done.length) {
          this.onCardAdjusted(String(c.code))
          await this.postJson('/sync/push/card-ack', { code: String(c.code), opIds: done }).catch(() => {})
        }
      }
    }
    if (changed) console.log(`[Downlink] ${changed} card change(s) from central applied`)
    return changed
  }

  async postJson(path, body) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await this.fetch(`${this.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${this.apiKey}` }, body: JSON.stringify(body), signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res
    } finally { clearTimeout(t) }
  }

  status() {
    return { enabled: this.enabled, lastPullAt: this.lastPullAt, lastError: this.lastError, counts: this.counts }
  }
}

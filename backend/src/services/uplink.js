/**
 * Central uplink — send this site's sales, card balances and day-closes to the
 * central server, whenever it can be reached.
 *
 * The site itself never waits for the internet: everything is recorded in the
 * local database first (coins, bills and cards all work with no connection), and
 * a record is queued in `SyncOutbox` in the same instant. This worker drains that
 * queue. Offline is a normal state, not an error: nothing is dropped, nothing is
 * counted against a record, and the queue simply waits for the next try.
 *
 * Safe to retry: the server's push endpoints are idempotent (sales and
 * day-closes by `local_id`, card creation by code, card balance is an absolute
 * value), so a request that succeeded but whose reply was lost is harmless.
 *
 * Enable with SYNC_SERVER_URL (e.g. https://api.washbubbles.app/api) and
 * SYNC_API_KEY (the kiosk key issued by that server). Unset = disabled.
 *
 * Reference: docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md §14
 */
import EventEmitter from 'events'
import SyncOutbox from '../models/syncOutbox.js'
import Card, { onCardChanged } from '../models/card.js'
import Peripheral from '../models/peripheral.js'
import Flow from '../models/flow.js'
import Machine from '../models/machine.js'
import modelEvents from './modelEvents.js'

const MAX_ATTEMPTS = 10

/** Map a local sale to the server's `push/sale` payload (snake_case). */
export function salePayload(sale) {
  const o = typeof sale.toObject === 'function' ? sale.toObject() : sale
  return {
    local_id: String(o._id),
    type: o.type || 'payment',
    amount: o.amount,
    method: o.method,
    batch_id: o.batchId,
    card_code: o.cardCode,
    inserted: o.inserted || 0,
    change_amount: o.change || 0,
    items: o.items,
    created_at: o.createdAt,
    // a refund (its row is negative, 'refund_of' is this site's id of the sale it reverses) and a sale that has been refunded since
    status: o.status || 'completed',
    refund_of: o.refundOf ? String(o.refundOf) : undefined,
    refund_reason: o.refundReason || undefined,
    // NOT sent: machine_id / card_id — they are this site's local ids and mean
    // nothing (or the wrong thing) on the server.
  }
}

/** Map a local day-close to the server's `push/day-close` payload. */
export function dayClosePayload(dc) {
  const o = typeof dc.toObject === 'function' ? dc.toObject() : dc
  return {
    local_id: String(o._id),
    total_sales: o.totalSales || 0,
    total_cash: o.totalCash || 0,
    total_card: o.totalCard || 0,
    total_recharges: o.totalRecharges || 0,
    sale_count: o.salesCount || 0,
    notes: o.notes || '',
    created_at: o.createdAt,
    date: o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : undefined,
  }
}

export class Uplink extends EventEmitter {
  constructor({
    tenantId,
    url = process.env.SYNC_SERVER_URL,
    apiKey = process.env.SYNC_API_KEY,
    intervalMs = 30_000,
    batchSize = 25,
    timeoutMs = 10_000,
    maxAttempts = MAX_ATTEMPTS,
    fetchImpl = globalThis.fetch,
    OutboxModel = SyncOutbox,
    CardModel = Card,
    PeripheralModel = Peripheral,
    MachineModel = Machine,
    statusIntervalMs = 60_000,
    machineStatusIntervalMs = 5_000,
  }) {
    super()
    this.tenantId = tenantId
    this.url = url ? String(url).replace(/\/+$/, '') : ''
    this.apiKey = apiKey
    this.intervalMs = intervalMs
    this.batchSize = batchSize
    this.timeoutMs = timeoutMs
    this.maxAttempts = maxAttempts
    this.fetch = fetchImpl
    this.Outbox = OutboxModel
    this.Card = CardModel
    this.Peripheral = PeripheralModel
    this.Machine = MachineModel
    this.machineStatusIntervalMs = machineStatusIntervalMs
    this.machineTimer = null
    this.lastMachineSig = ''
    this.lastMachinePushAt = 0
    this.statusIntervalMs = statusIntervalMs
    this.statusTimer = null
    this.lastStatusSig = ''
    this.lastStatusPushAt = 0

    this.online = null          // null = not tried yet
    this.lastSyncAt = null
    this.lastError = ''
    this.authFailed = false
    this.flushing = null
    this.backoffMs = 0
    this.nextTryAt = 0
    this.timer = null
    this.unsubscribers = []
  }

  get enabled() {
    return Boolean(this.url && this.apiKey) && process.env.SYNC_ENABLED !== 'false'
  }

  start() {
    if (!this.enabled) {
      console.log('[Uplink] disabled (set SYNC_SERVER_URL and SYNC_API_KEY to send data to the central server)')
      return
    }
    const sameTenant = (t) => String(t) === String(this.tenantId)

    const onSale = (sale) => {
      // A sale the server pushed to us must not go back to it. Those are marked
      // `metadata.syncedAt`. (NOT `metadata.localId`: the kiosk UI also sets that,
      // as a retry key, on ordinary sales — skipping those would lose them.)
      if (!sameTenant(sale.tenantId) || sale.metadata?.syncedAt) return
      this.enqueue('sale', String(sale._id), salePayload(sale)).catch(this.logQueueError)
    }
    const onDayClose = (dc) => {
      if (!sameTenant(dc.tenantId) || dc.source === 'adjustment' || dc.metadata?.syncedAt) return
      this.enqueue('day_close', String(dc._id), dayClosePayload(dc)).catch(this.logQueueError)
    }
    // A customer action (flow) that is over goes up with all its steps, so the central admin can show the whole story.
    const onFlow = async ({ tenantId, flowId }) => {
      if (!sameTenant(tenantId)) return
      const f = await Flow.findOne({ tenantId, flowId }).lean()
      if (!f) return
      const { _id, __v, createdAt, ...payload } = f
      await this.enqueue('flow', flowId, payload)
    }
    const onFlowSafe = (x) => onFlow(x).catch(this.logQueueError)
    const onCoupon = ({ tenantId, code, redemptionCount }) => {
      if (sameTenant(tenantId)) this.enqueue('coupon', String(code), { code, redemption_count: redemptionCount }).catch(this.logQueueError)
    }
    modelEvents.on('coupon:redeemed', onCoupon)
    modelEvents.on('sale:created', onSale)
    modelEvents.on('sale:refunded', onSale)
    modelEvents.on('dayclose:created', onDayClose)
    modelEvents.on('flow:closed', onFlowSafe)
    this.unsubscribers.push(
      () => modelEvents.off('sale:created', onSale),
      () => modelEvents.off('coupon:redeemed', onCoupon),
      () => modelEvents.off('sale:refunded', onSale),
      () => modelEvents.off('dayclose:created', onDayClose),
      () => modelEvents.off('flow:closed', onFlowSafe),
      onCardChanged((tenantId, code) => {
        if (sameTenant(tenantId)) this.enqueueCard(code).catch(this.logQueueError)
      }),
    )

    this.timer = setInterval(() => this.flush().catch(() => {}), this.intervalMs)
    this.timer.unref?.()
    this.flush().catch(() => {}) // drain anything left from before a restart
    // Live peripheral health is a state, not an event: it is sent as-is, never queued.
    this.statusTimer = setInterval(() => this.pushPeripheralStatus().catch(() => {}), this.statusIntervalMs)
    this.statusTimer.unref?.()
    this.statusSoon = setTimeout(() => this.pushPeripheralStatus().catch(() => {}), 20_000)
    this.statusSoon.unref?.()
    // Occupied / free / fault of each machine, so the central admin sees what the shop sees.
    this.machineTimer = setInterval(() => this.pushMachineStatus().catch(() => {}), this.machineStatusIntervalMs)
    this.machineTimer.unref?.()
    console.log(`[Uplink] enabled -> ${this.url}`)
  }

  stop() {
    clearInterval(this.timer)
    clearInterval(this.statusTimer)
    clearInterval(this.machineTimer)
    this.machineTimer = null
    clearTimeout(this.statusSoon)
    this.statusTimer = null
    this.timer = null
    for (const off of this.unsubscribers) off()
    this.unsubscribers = []
  }

  logQueueError = (err) => console.error('[Uplink] could not queue record:', err.message)

  // -------------------------------------------------------------- queueing

  /** Queue one record. Idempotent: an already-pending record is refreshed, not duplicated. */
  async enqueue(entityType, entityId, payload) {
    if (!this.enabled) return
    try {
      await this.Outbox.updateOne(
        { tenantId: this.tenantId, entityType, entityId, status: 'pending' },
        {
          $set: { payload, nextAttemptAt: new Date() },
          $inc: { rev: 1 },
          $setOnInsert: { attempts: 0, createdAt: new Date() },
        },
        { upsert: true },
      )
    } catch (err) {
      if (err?.code !== 11000) throw err // lost a race with an identical enqueue: fine
    }
    // Do not wait for the interval when we might be online already.
    if (this.online !== false) this.flush().catch(() => {})
  }

  /** Queue a card's latest state (a newer one replaces a still-pending older one). */
  async enqueueCard(code) {
    const card = await this.Card.findOne({ tenantId: this.tenantId, code }).lean()
    if (!card) return
    await this.enqueue('card', code, {
      code: card.code,
      balance: card.balance,
      status: card.status,
      name: card.name || '',
      email: card.email || '',
      phone: card.phone || '',
      contribuinte: card.contribuinte || '',
      marketingOptIn: Boolean(card.marketingOptIn),
      privacyConsentAt: card.privacyConsentAt || null,
      // The purchase was re-keyed to the chip's own id: the central must RENAME its row, not add a second card.
      previousCode: card.metadata?.previousCode || undefined,
    })
  }

  // -------------------------------------------------------------- draining

  /** Send everything that is due. Concurrent calls share one run. */
  flush() {
    if (!this.enabled) return Promise.resolve({ status: 'disabled' })
    if (this.flushing) return this.flushing
    if (Date.now() < this.nextTryAt) return Promise.resolve({ status: 'waiting' })

    this.flushing = this.runFlush().finally(() => { this.flushing = null })
    return this.flushing
  }

  async runFlush() {
    let sent = 0
    for (;;) {
      const batch = await this.Outbox
        .find({ tenantId: this.tenantId, status: 'pending', nextAttemptAt: { $lte: new Date() } })
        .sort({ createdAt: 1 })
        .limit(this.batchSize)
      if (batch.length === 0) break

      let again = false
      for (const item of batch) {
        const outcome = await this.pushItem(item)
        if (outcome === 'offline') return { status: 'offline', sent }
        if (outcome === 'auth') return { status: 'auth-failed', sent }
        if (outcome === 'sent') sent++
        if (outcome === 'stale') again = true
      }
      if (batch.length < this.batchSize && !again) break
    }
    return { status: 'ok', sent }
  }

  /** @returns {'sent'|'stale'|'failed'|'offline'|'auth'} */
  async pushItem(item) {
    try {
      await this.send(item)
    } catch (err) {
      return this.handleFailure(item, err)
    }
    // Mark sent ONLY if the entry is still the revision we just sent. If a newer
    // state replaced it while the request was in flight, it stays pending and goes
    // out on the next pass — otherwise the newer state would be silently lost.
    const marked = await this.Outbox.updateOne(
      { _id: item._id, status: 'pending', rev: item.rev },
      { $set: { status: 'sent', sentAt: new Date(), lastError: '' } },
    )
    this.online = true
    this.backoffMs = 0
    this.nextTryAt = 0
    this.authFailed = false
    this.lastSyncAt = new Date()
    this.lastError = ''
    if (marked.modifiedCount === 0) return 'stale' // refreshed meanwhile: goes out again
    this.emit('sent', { entityType: item.entityType, entityId: item.entityId })
    return 'sent'
  }

  /**
   * Tell the central server how each peripheral is doing right now (ok / fault / offline),
   * so its admin shows the shop's real hardware instead of its own empty copies.
   * Sent when something changed, and at least every 5 minutes as a heartbeat. Offline or
   * rejected is simply tried again next time; nothing is queued.
   */
  /** Live machine state (a state, not an event: sent as-is, only when it changed). */
  async pushMachineStatus() {
    if (!this.enabled || this.authFailed) return false
    const rows = await this.Machine.find({ tenantId: this.tenantId }).select('_id status statusText').lean()
    if (rows.length === 0) return false
    const machines = rows.map((r) => ({ id: String(r._id), status: r.status, statusText: r.statusText || '' }))
    const sig = JSON.stringify(machines)
    if (sig === this.lastMachineSig && Date.now() - this.lastMachinePushAt < 5 * 60_000) return false
    try {
      await this.post('/sync/push/machine-status', { machines })
      this.lastMachineSig = sig
      this.lastMachinePushAt = Date.now()
      return true
    } catch (err) {
      this.lastMachineSig = '' // send again next time
      return false
    }
  }

  async pushPeripheralStatus() {
    if (!this.enabled || this.authFailed) return false
    const rows = await this.Peripheral.find({ tenantId: this.tenantId }).select('_id status').lean()
    if (rows.length === 0) return false
    const peripherals = rows.map((r) => ({ id: String(r._id), status: r.status }))
    const sig = JSON.stringify(peripherals)
    if (sig === this.lastStatusSig && Date.now() - this.lastStatusPushAt < 5 * 60_000) return false
    try {
      await this.post('/sync/push/peripheral-status', { peripherals })
      this.lastStatusSig = sig
      this.lastStatusPushAt = Date.now()
      return true
    } catch (err) {
      this.lastStatusSig = '' // send again next time
      return false
    }
  }

  async post(path, body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetch(`${this.url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        let detail = ''
        try { detail = ` — ${(await res.text()).slice(0, 200)}` } catch { /* ignore */ }
        const err = new Error(`HTTP ${res.status}${detail}`)
        err.httpStatus = res.status
        throw err
      }
      return res
    } finally {
      clearTimeout(timer)
    }
  }

  async send(item) {
    const p = item.payload
    switch (item.entityType) {
      case 'sale':
        await this.post('/sync/push/sale', p)
        return
      case 'day_close':
        await this.post('/sync/push/day-close', p)
        return
      case 'flow':
        await this.post('/sync/push/flow', p)
        return
      case 'coupon':
        await this.post('/sync/push/coupon', p)
        return
      case 'card': {
        // 1) make sure the card exists there (no-op if it does)
        await this.post('/sync/push/card', {
          create: true, code: p.code, balance: p.balance, previousCode: p.previousCode,
          status: p.status === 'active' ? 'active' : 'pending_write',
          name: p.name, email: p.email, phone: p.phone, contribuinte: p.contribuinte,
          marketingOptIn: Boolean(p.marketingOptIn), privacyConsentAt: p.privacyConsentAt || null,
        })
        if (p.status !== 'active') return // still awaiting its write at the reader
        // 2) a card written at the shop becomes usable there (409 = already active: fine)
        try {
          await this.post('/sync/push/card', { code: p.code, status: 'active' })
        } catch (err) {
          if (err.httpStatus !== 409) throw err
        }
        // 3) the latest balance. Absolute, which suits a single-kiosk site whose
        //    card carries the truth; a retry just sets the same number again.
        await this.post('/sync/push/card', { code: p.code, balance: p.balance })
        return
      }
      default:
        throw Object.assign(new Error(`unknown entity ${item.entityType}`), { httpStatus: 400 })
    }
  }

  async handleFailure(item, err) {
    // No HTTP status = we never got an answer: no internet, DNS, timeout, refused.
    // That is being offline — it must not count against the record.
    if (!err.httpStatus) {
      this.online = false
      this.lastError = err.name === 'AbortError' ? 'timeout' : (err.cause?.code || err.message)
      this.backoffMs = Math.min((this.backoffMs || 5_000) * 2, 5 * 60_000)
      this.nextTryAt = Date.now() + this.backoffMs
      this.emit('offline', { reason: this.lastError })
      return 'offline'
    }

    this.online = true // the server answered
    this.lastError = err.message

    if (err.httpStatus === 401 || err.httpStatus === 403) {
      // The key is wrong or revoked. Retrying fast helps nobody; keep every record.
      this.authFailed = true
      this.nextTryAt = Date.now() + 5 * 60_000
      console.error(`[Uplink] the central server rejected our API key (${err.httpStatus}) — records are kept and will retry`)
      return 'auth'
    }

    const attempts = item.attempts + 1
    const dead = attempts >= this.maxAttempts && err.httpStatus < 500
    await this.Outbox.updateOne(
      { _id: item._id },
      {
        $set: {
          attempts, lastError: err.message.slice(0, 300),
          status: dead ? 'dead' : 'pending',
          nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts * 1000, 10 * 60_000)),
        },
      },
    )
    if (dead) {
      console.error(`[Uplink] giving up on ${item.entityType} ${item.entityId}: ${err.message}`)
      this.emit('dead', { entityType: item.entityType, entityId: item.entityId, error: err.message })
    }
    return 'failed'
  }

  // -------------------------------------------------------------- admin

  async status() {
    const count = (status) => this.Outbox.countDocuments({ tenantId: this.tenantId, status })
    const [pending, dead] = await Promise.all([count('pending'), count('dead')])
    return {
      enabled: this.enabled,
      url: this.url || null,
      online: this.online,
      pending,
      dead,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError || null,
      authFailed: this.authFailed,
    }
  }

  /** Give up-for-dead records another chance (after fixing whatever the server objected to). */
  async retryDead() {
    const res = await this.Outbox.updateMany(
      { tenantId: this.tenantId, status: 'dead' },
      { $set: { status: 'pending', attempts: 0, nextAttemptAt: new Date() } },
    )
    this.nextTryAt = 0
    this.flush().catch(() => {})
    return { requeued: res.modifiedCount }
  }
}

/**
 * WashBubbles Sync Engine
 * Background sync between local SQLite and cloud server
 *
 * Fixes applied:
 * - #2:  _pushItem checks resp.ok before marking synced
 * - #7:  Pull uses /sync/pull/* endpoints (kiosk-accessible) not /admin/*
 * - #9:  Card pull uses bulkUpsertPreserveBalance (keeps local balance if unsynced)
 * - #10: Machine pull uses bulkUpsertConfigOnly (preserves local runtime status)
 * - #11: Periodic cleanup of synced items
 * - #22: errors array capped at 50
 */
const EventEmitter = require('events')
const { machines, cards, sales, prices, settings, interfaces, peripherals,
        syncQueue, syncMeta } = require('./database.cjs')

class SyncEngine extends EventEmitter {
  constructor(config, tenantId) {
    super()
    this.serverUrl = config.serverUrl
    this.apiKey = config.apiKey
    this.tenantId = tenantId
    this.online = false
    this.syncing = false
    this.timers = {}
    this.stats = { lastSync: null, pendingCount: 0, errors: [] }
  }

  start() {
    console.log('[Sync] Starting — Server:', this.serverUrl)
    this.timers.connectivity = setInterval(() => this.checkConnectivity(), 30000)
    this.checkConnectivity()
    this.timers.outbound = setInterval(() => this.pushOutbound(), 60000)
    this.timers.prices = setInterval(() => this.pullEntity('prices'), 10 * 60000)
    this.timers.settings = setInterval(() => this.pullEntity('settings'), 10 * 60000)
    this.timers.machines = setInterval(() => this.pullEntity('machines'), 10 * 60000)
    this.timers.cards = setInterval(() => this.pullEntity('cards'), 5 * 60000)
    this.timers.interfaces = setInterval(() => this.pullEntity('interfaces'), 30 * 60000)
    this.timers.peripherals = setInterval(() => this.pullEntity('peripherals'), 30 * 60000)
    // Fix #11: Cleanup old synced items every hour
    this.timers.cleanup = setInterval(() => syncQueue.cleanup(), 60 * 60000)
    console.log('[Sync] Engine started')
  }

  stop() {
    for (const t of Object.values(this.timers)) clearInterval(t)
    this.timers = {}
    console.log('[Sync] Engine stopped')
  }

  async forceSync() {
    console.log('[Sync] Force sync triggered')
    await this.checkConnectivity()
    if (!this.online) return { success: false, error: 'Server unreachable' }
    await this.pushOutbound()
    await this.pullAll()
    return { success: true, stats: this.getStatus() }
  }

  async checkConnectivity() {
    try {
      const resp = await this._fetch('/health', { method: 'GET', timeout: 5000 })
      if (resp.ok) {
        if (!this.online) {
          this.online = true
          console.log('[Sync] Server is ONLINE')
          this.emit('online')
          setTimeout(() => this.pushOutbound(), 1000)
          setTimeout(() => this.pullAll(), 3000)
        }
      } else { this._setOffline() }
    } catch { this._setOffline() }
  }

  _setOffline() {
    if (this.online) {
      this.online = false
      console.log('[Sync] Server is OFFLINE')
      this.emit('offline')
    }
  }

  // ─── Outbound: Push local → server ───

  async pushOutbound() {
    if (!this.online || this.syncing) return
    this.syncing = true
    try {
      const pending = syncQueue.getPending(50)
      if (pending.length === 0) { this.syncing = false; return }
      console.log(`[Sync] Pushing ${pending.length} items...`)

      for (const item of pending) {
        try {
          await this._pushItem(item)
          syncQueue.markSynced(item.id)
        } catch (err) {
          console.error(`[Sync] Push failed ${item.entity_type}/${item.entity_id}:`, err.message)
          syncQueue.markFailed(item.id, err.message)
          // Fix #22: cap errors array
          this.stats.errors.push({ id: item.id, error: err.message, at: new Date().toISOString() })
          if (this.stats.errors.length > 50) this.stats.errors = this.stats.errors.slice(-50)
        }
      }
      this.stats.lastSync = new Date().toISOString()
      this.stats.pendingCount = syncQueue.countPending()
      this.emit('sync:pushed', { count: pending.length })
    } catch (err) {
      console.error('[Sync] Outbound error:', err)
    } finally {
      this.syncing = false
    }
  }

  /** Fix #2: Check response status before considering push successful */
  async _pushItem(item) {
    const payload = JSON.parse(item.payload)
    let endpoint
    switch (item.entity_type) {
      case 'sale':    endpoint = '/sync/push/sale'; break
      case 'card':    endpoint = '/sync/push/card'; break
      case 'machine': endpoint = '/sync/push/machine'; break
      default:
        console.warn(`[Sync] Unknown entity: ${item.entity_type}`)
        return
    }

    const resp = await this._fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload)
    })

    // Fix #2: Throw on non-ok response so item gets marked failed, not synced
    if (!resp.ok) {
      let errMsg = `HTTP ${resp.status}`
      try { const body = await resp.json(); errMsg = body.error || errMsg } catch {}
      throw new Error(errMsg)
    }
  }

  // ─── Inbound: Pull server → local ───

  async pullAll() {
    if (!this.online) return
    for (const entity of ['machines', 'prices', 'settings', 'cards', 'interfaces', 'peripherals']) {
      try { await this.pullEntity(entity) }
      catch (err) { console.error(`[Sync] Pull ${entity} error:`, err.message) }
    }
  }

  async pullEntity(entityType) {
    if (!this.online) return
    try {
      const meta = syncMeta.get(entityType)
      const since = meta?.last_synced_at || '1970-01-01T00:00:00Z'

      // Fix #7: All pulls use /sync/pull/* endpoints (kiosk-accessible)
      const endpoint = `/sync/pull/${entityType}`

      const resp = await this._fetch(`${endpoint}?since=${encodeURIComponent(since)}`, { method: 'GET' })
      if (!resp.ok) {
        console.warn(`[Sync] Pull ${entityType} got ${resp.status}`)
        return
      }

      const data = await resp.json()
      const items = Array.isArray(data) ? data : (data.items || data.data || [])
      if (items.length === 0) return

      console.log(`[Sync] Pulled ${items.length} ${entityType}`)

      switch (entityType) {
        case 'prices':
          prices.bulkReplace(this.tenantId, items.map(p => this._mapPrice(p)))
          break
        case 'settings':
          settings.bulkReplace(this.tenantId, items)
          break
        case 'machines':
          // Fix #10: Preserve local runtime status (working, cycle, etc.)
          machines.bulkUpsertConfigOnly(items.map(m => this._mapMachine(m)))
          break
        case 'cards':
          // Fix #9: Don't overwrite local unsynced card balance
          cards.bulkUpsertPreserveBalance(items.map(c => this._mapCard(c)))
          break
        case 'interfaces':
          interfaces.bulkReplace(this.tenantId, items.map(i => this._mapInterface(i)))
          break
        case 'peripherals':
          peripherals.bulkReplace(this.tenantId, items.map(p => this._mapPeripheral(p)))
          break
      }

      syncMeta.set(entityType, { last_synced_at: new Date().toISOString() })
      this.emit('sync:pulled', { entityType, count: items.length })
    } catch (err) {
      console.error(`[Sync] Pull ${entityType} failed:`, err.message)
    }
  }

  async bootstrap() {
    console.log('[Sync] Starting bootstrap...')
    this.emit('bootstrap:start')
    try {
      await this.checkConnectivity()
      if (!this.online) throw new Error('Server unreachable')
      for (const entity of ['machines', 'prices', 'settings', 'cards', 'interfaces', 'peripherals']) {
        this.emit('bootstrap:progress', { entity, status: 'pulling' })
        await this.pullEntity(entity)
        this.emit('bootstrap:progress', { entity, status: 'done' })
      }
      this.emit('bootstrap:complete')
      console.log('[Sync] Bootstrap complete!')
      return { success: true }
    } catch (err) {
      console.error('[Sync] Bootstrap failed:', err)
      this.emit('bootstrap:failed', { error: err.message })
      return { success: false, error: err.message }
    }
  }

  // ─── Mappers: MongoDB → SQLite ───

  _mapMachine(m) {
    return {
      id: m._id || m.id, local_id: null, tenant_id: m.tenantId || this.tenantId,
      name: m.name, number: m.number || null, brand: m.brand || '', model: m.model || '',
      serial_number: m.serialNumber || '', status: m.status || 'free',
      status_text: m.statusText || null, cycle: m.cycle || 0, weight: m.weight || 0,
      type: m.type || 'wash', icon: m.icon || null, int_id: m.intId || null,
      channel: m.channel || null, impulses: m.impulses || '1',
      reserved: m.reserved ? 1 : 0, reserved_by: m.reservedBy || null,
      reserved_at: m.reservedAt || null, reservation_duration: m.reservationDuration || 0,
      current_program: m.currentProgram || null, started_at: m.startedAt || null,
      estimated_end_time: m.estimatedEndTime || null, running_duration: m.runningDuration || 0,
      interface_id: m.interfaceId?._id || m.interfaceId || null,
      port: m.port || null, activation: m.activation || 'high', t_imp: m.tImp || null,
      created_at: m.createdAt || new Date().toISOString(),
      updated_at: m.updatedAt || new Date().toISOString(),
      synced: 1, last_synced_at: new Date().toISOString()
    }
  }

  _mapCard(c) {
    return {
      id: c._id || c.id, local_id: null, tenant_id: c.tenantId || this.tenantId,
      code: c.code, balance: c.balance || 0, name: c.name || '', email: c.email || '',
      phone: c.phone || '', contribuinte: c.contribuinte || '',
      metadata: c.metadata ? JSON.stringify(c.metadata) : null,
      created_at: c.createdAt || new Date().toISOString(),
      updated_at: c.updatedAt || new Date().toISOString(),
      synced: 1, last_synced_at: new Date().toISOString()
    }
  }

  _mapPrice(p) {
    return {
      id: p._id || p.id, tenant_id: p.tenantId || this.tenantId,
      type: p.type, weight: p.weight, duration: p.duration || null,
      cash_price: p.cashPrice ?? p.cash_price ?? 0,
      card_price: p.cardPrice ?? p.card_price ?? 0,
      promo_active: p.promoActive ? 1 : 0,
      promo_cash_price: p.promoCashPrice ?? null, promo_card_price: p.promoCardPrice ?? null,
      promo_start_time: p.promoStartTime || null, promo_end_time: p.promoEndTime || null,
      promo_days: p.promoDays ? JSON.stringify(p.promoDays) : null,
      created_at: p.createdAt || new Date().toISOString(),
      updated_at: p.updatedAt || new Date().toISOString()
    }
  }

  _mapInterface(i) {
    return {
      id: i._id || i.id, tenant_id: i.tenantId || this.tenantId,
      name: i.name, brand: i.brand || '', model: i.model || '',
      serial_number: i.serialNumber || i.serial_number,
      address: i.address, ports: i.ports || 2,
      t_on: i.tOn ?? i.t_on ?? 100, t_off: i.tOff ?? i.t_off ?? 100,
      status: i.status || 'inactive',
      created_at: i.createdAt || new Date().toISOString(),
      updated_at: i.updatedAt || new Date().toISOString()
    }
  }

  _mapPeripheral(p) {
    return {
      id: p._id || p.id, tenant_id: p.tenantId || this.tenantId,
      name: p.name, type: p.type, enabled: p.enabled ? 1 : 0,
      protocol: p.protocol || 'pulse', address: p.address || '',
      baud_rate: p.baudRate || p.baud_rate || '', brand: p.brand || '',
      model: p.model || '', serial_number: p.serialNumber || p.serial_number || '',
      status: p.status || 'unknown', image: p.image || '',
      hopper_config: p.hopperConfig ? JSON.stringify(p.hopperConfig) : null,
      created_at: p.createdAt || new Date().toISOString(),
      updated_at: p.updatedAt || new Date().toISOString()
    }
  }

  async _fetch(urlPath, opts = {}) {
    const url = `${this.serverUrl}${urlPath}`
    const headers = {
      'Authorization': `ApiKey ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Tenant-Id': this.tenantId
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), opts.timeout || 10000)
    try {
      return await fetch(url, {
        method: opts.method || 'GET', headers,
        body: opts.body || undefined, signal: controller.signal
      })
    } finally { clearTimeout(timeout) }
  }

  getStatus() {
    return {
      online: this.online, syncing: this.syncing,
      lastSync: this.stats.lastSync,
      pendingCount: syncQueue.countPending(),
      errors: this.stats.errors.slice(-10)
    }
  }
}

module.exports = { SyncEngine }

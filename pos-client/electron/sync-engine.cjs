/**
 * WashBubbles Sync Engine
 * Background sync between local SQLite and cloud MongoDB server
 * Handles outbound pushes, inbound pulls, and connectivity monitoring
 */
const EventEmitter = require('events')
const { machines, cards, sales, prices, settings, interfaces, peripherals, syncQueue, syncMeta } = require('./database.cjs')

class SyncEngine extends EventEmitter {
  constructor(config, tenantId) {
    super()
    this.serverUrl = config.serverUrl // e.g. http://192.168.1.100:3000/api
    this.apiKey = config.apiKey
    this.tenantId = tenantId
    this.online = false
    this.syncing = false
    this.timers = {}
    this.stats = { lastSync: null, pendingCount: 0, errors: [] }
  }

  /** Start the sync engine */
  start() {
    console.log('[Sync] Starting sync engine...')
    console.log('[Sync] Server:', this.serverUrl)

    // Connectivity check every 30s
    this.timers.connectivity = setInterval(() => this.checkConnectivity(), 30000)
    this.checkConnectivity() // immediate first check

    // Outbound sync every 60s
    this.timers.outbound = setInterval(() => this.pushOutbound(), 60000)

    // Inbound sync at different intervals per entity
    this.timers.prices = setInterval(() => this.pullEntity('prices'), 10 * 60000)       // 10 min
    this.timers.settings = setInterval(() => this.pullEntity('settings'), 10 * 60000)   // 10 min
    this.timers.machines = setInterval(() => this.pullEntity('machines'), 10 * 60000)   // 10 min
    this.timers.cards = setInterval(() => this.pullEntity('cards'), 5 * 60000)          // 5 min
    this.timers.interfaces = setInterval(() => this.pullEntity('interfaces'), 30 * 60000) // 30 min
    this.timers.peripherals = setInterval(() => this.pullEntity('peripherals'), 30 * 60000)

    console.log('[Sync] Engine started')
  }

  /** Stop sync engine */
  stop() {
    for (const timer of Object.values(this.timers)) clearInterval(timer)
    this.timers = {}
    console.log('[Sync] Engine stopped')
  }

  /** Force a full sync now */
  async forceSync() {
    console.log('[Sync] Force sync triggered')
    await this.checkConnectivity()
    if (!this.online) return { success: false, error: 'Server unreachable' }
    await this.pushOutbound()
    await this.pullAll()
    return { success: true, stats: this.getStatus() }
  }

  /** Check server connectivity */
  async checkConnectivity() {
    try {
      const resp = await this._fetch('/pos/machine-status', { method: 'GET', timeout: 5000 })
      if (resp.ok) {
        if (!this.online) {
          this.online = true
          console.log('[Sync] Server is ONLINE')
          this.emit('online')
          // Trigger immediate sync when coming back online
          setTimeout(() => this.pushOutbound(), 1000)
          setTimeout(() => this.pullAll(), 3000)
        }
      } else {
        this._setOffline()
      }
    } catch (err) {
      this._setOffline()
    }
  }

  _setOffline() {
    if (this.online) {
      this.online = false
      console.log('[Sync] Server is OFFLINE')
      this.emit('offline')
    }
  }

  // ─── Outbound: Push local changes to server ───

  async pushOutbound() {
    if (!this.online || this.syncing) return
    this.syncing = true

    try {
      const pending = syncQueue.getPending(50)
      if (pending.length === 0) { this.syncing = false; return }

      console.log(`[Sync] Pushing ${pending.length} pending items...`)

      for (const item of pending) {
        try {
          await this._pushItem(item)
          syncQueue.markSynced(item.id)
        } catch (err) {
          console.error(`[Sync] Failed to push ${item.entity_type}/${item.entity_id}:`, err.message)
          syncQueue.markFailed(item.id, err.message)
          if (item.attempts >= 10) {
            this.stats.errors.push({ id: item.id, error: err.message, at: new Date().toISOString() })
          }
        }
      }

      this.stats.lastSync = new Date().toISOString()
      this.stats.pendingCount = syncQueue.countPending()
      this.emit('sync:pushed', { count: pending.length })
    } catch (err) {
      console.error('[Sync] Outbound sync error:', err)
    } finally {
      this.syncing = false
    }
  }

  async _pushItem(item) {
    const payload = JSON.parse(item.payload)

    switch (item.entity_type) {
      case 'sale':
        await this._fetch('/sync/push/sale', {
          method: 'POST',
          body: JSON.stringify(payload)
        })
        break

      case 'card':
        await this._fetch('/sync/push/card', {
          method: 'POST',
          body: JSON.stringify(payload)
        })
        break

      case 'machine':
        await this._fetch('/sync/push/machine', {
          method: 'POST',
          body: JSON.stringify(payload)
        })
        break

      default:
        console.warn(`[Sync] Unknown entity type: ${item.entity_type}`)
    }
  }

  // ─── Inbound: Pull server changes to local ───

  async pullAll() {
    if (!this.online) return
    const entities = ['prices', 'settings', 'machines', 'cards', 'interfaces', 'peripherals']
    for (const entity of entities) {
      try {
        await this.pullEntity(entity)
      } catch (err) {
        console.error(`[Sync] Pull ${entity} error:`, err.message)
      }
    }
  }

  async pullEntity(entityType) {
    if (!this.online) return

    try {
      const meta = syncMeta.get(entityType)
      const since = meta?.last_synced_at || '1970-01-01T00:00:00Z'

      let endpoint
      switch (entityType) {
        case 'prices': endpoint = '/admin/prices'; break
        case 'settings': endpoint = '/admin/settings'; break
        case 'machines': endpoint = '/admin/machines'; break
        case 'cards': endpoint = '/sync/pull/cards'; break
        case 'interfaces': endpoint = '/admin/interfaces'; break
        case 'peripherals': endpoint = '/admin/peripherals'; break
        default: return
      }

      const resp = await this._fetch(`${endpoint}?since=${encodeURIComponent(since)}`, { method: 'GET' })
      if (!resp.ok) return

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
          machines.bulkUpsert(items.map(m => this._mapMachine(m)))
          break
        case 'cards':
          cards.bulkUpsert(items.map(c => this._mapCard(c)))
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

  /** Initial bootstrap — download everything on first launch */
  async bootstrap() {
    console.log('[Sync] Starting initial bootstrap...')
    this.emit('bootstrap:start')

    try {
      await this.checkConnectivity()
      if (!this.online) throw new Error('Server unreachable — cannot bootstrap')

      // Pull all data (no "since" filter)
      const entities = ['machines', 'prices', 'settings', 'cards', 'interfaces', 'peripherals']
      for (const entity of entities) {
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
      id: m._id || m.id,
      local_id: null,
      tenant_id: m.tenantId || this.tenantId,
      name: m.name,
      number: m.number || null,
      brand: m.brand || '',
      model: m.model || '',
      serial_number: m.serialNumber || '',
      status: m.status || 'free',
      status_text: m.statusText || null,
      cycle: m.cycle || 0,
      weight: m.weight || 0,
      type: m.type || 'wash',
      icon: m.icon || null,
      int_id: m.intId || null,
      channel: m.channel || null,
      impulses: m.impulses || '1',
      reserved: m.reserved ? 1 : 0,
      reserved_by: m.reservedBy || null,
      reserved_at: m.reservedAt || null,
      reservation_duration: m.reservationDuration || 0,
      current_program: m.currentProgram || null,
      started_at: m.startedAt || null,
      estimated_end_time: m.estimatedEndTime || null,
      running_duration: m.runningDuration || 0,
      interface_id: m.interfaceId?._id || m.interfaceId || null,
      port: m.port || null,
      activation: m.activation || 'high',
      t_imp: m.tImp || null,
      created_at: m.createdAt || new Date().toISOString(),
      updated_at: m.updatedAt || new Date().toISOString(),
      synced: 1,
      last_synced_at: new Date().toISOString()
    }
  }

  _mapCard(c) {
    return {
      id: c._id || c.id,
      local_id: null,
      tenant_id: c.tenantId || this.tenantId,
      code: c.code,
      balance: c.balance || 0,
      name: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      contribuinte: c.contribuinte || '',
      metadata: c.metadata ? JSON.stringify(c.metadata) : null,
      created_at: c.createdAt || new Date().toISOString(),
      updated_at: c.updatedAt || new Date().toISOString(),
      synced: 1,
      last_synced_at: new Date().toISOString()
    }
  }

  _mapPrice(p) {
    return {
      id: p._id || p.id,
      tenant_id: p.tenantId || this.tenantId,
      type: p.type,
      weight: p.weight,
      duration: p.duration || null,
      cash_price: p.cashPrice ?? p.cash_price ?? 0,
      card_price: p.cardPrice ?? p.card_price ?? 0,
      promo_active: p.promoActive ? 1 : 0,
      promo_cash_price: p.promoCashPrice ?? null,
      promo_card_price: p.promoCardPrice ?? null,
      promo_start_time: p.promoStartTime || null,
      promo_end_time: p.promoEndTime || null,
      promo_days: p.promoDays ? JSON.stringify(p.promoDays) : null,
      created_at: p.createdAt || new Date().toISOString(),
      updated_at: p.updatedAt || new Date().toISOString()
    }
  }

  _mapInterface(i) {
    return {
      id: i._id || i.id,
      tenant_id: i.tenantId || this.tenantId,
      name: i.name,
      brand: i.brand || '',
      model: i.model || '',
      serial_number: i.serialNumber || i.serial_number,
      address: i.address,
      ports: i.ports || 2,
      t_on: i.tOn ?? i.t_on ?? 100,
      t_off: i.tOff ?? i.t_off ?? 100,
      status: i.status || 'inactive',
      created_at: i.createdAt || new Date().toISOString(),
      updated_at: i.updatedAt || new Date().toISOString()
    }
  }

  _mapPeripheral(p) {
    return {
      id: p._id || p.id,
      tenant_id: p.tenantId || this.tenantId,
      name: p.name,
      type: p.type,
      enabled: p.enabled ? 1 : 0,
      protocol: p.protocol || 'pulse',
      address: p.address || '',
      baud_rate: p.baudRate || p.baud_rate || '',
      brand: p.brand || '',
      model: p.model || '',
      serial_number: p.serialNumber || p.serial_number || '',
      status: p.status || 'unknown',
      image: p.image || '',
      hopper_config: p.hopperConfig ? JSON.stringify(p.hopperConfig) : null,
      created_at: p.createdAt || new Date().toISOString(),
      updated_at: p.updatedAt || new Date().toISOString()
    }
  }

  // ─── HTTP helper ───

  async _fetch(path, opts = {}) {
    const url = `${this.serverUrl}${path}`
    const headers = {
      'Authorization': `ApiKey ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Tenant-Id': this.tenantId
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), opts.timeout || 10000)

    try {
      // Use Node.js native fetch (available in Electron 28+)
      const resp = await fetch(url, {
        method: opts.method || 'GET',
        headers,
        body: opts.body || undefined,
        signal: controller.signal
      })
      return resp
    } finally {
      clearTimeout(timeout)
    }
  }

  // ─── Status ───

  getStatus() {
    return {
      online: this.online,
      syncing: this.syncing,
      lastSync: this.stats.lastSync,
      pendingCount: syncQueue.countPending(),
      errors: this.stats.errors.slice(-10)
    }
  }
}

module.exports = { SyncEngine }

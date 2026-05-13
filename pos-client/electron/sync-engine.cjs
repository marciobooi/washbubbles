/**
 * WashBubbles Sync Engine
 * Background sync between local SQLite and cloud server
 */
const EventEmitter = require('events')
const { app } = require('electron')
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
    this.stats = { 
      lastSync: null, lastPull: null, pendingCount: 0, 
      errors: [], pulledCount: 0, pushedCount: 0
    }
    
    // Security: Log masked API Key
    const masked = this.apiKey ? (this.apiKey.substring(0, 4) + '****' + this.apiKey.substring(this.apiKey.length - 4)) : 'MISSING'
    console.log(`[Sync] Initialized — Server: ${this.serverUrl}, Key: ${masked}`)
  }

  start() {
    this.timers.connectivity = setInterval(() => this.checkConnectivity(), 30000)
    this.checkConnectivity()
    this.timers.outbound = setInterval(() => this.pushOutbound(), 60000)
    this.timers.prices = setInterval(() => this.pullEntity('prices'), 10 * 60000)
    this.timers.settings = setInterval(() => this.pullEntity('settings'), 10 * 60000)
    this.timers.machines = setInterval(() => this.pullEntity('machines'), 10 * 60000)
    this.timers.cards = setInterval(() => this.pullEntity('cards'), 5 * 60000)
    this.timers.commands = setInterval(() => this.checkRemoteCommands(), 120000)
    this.timers.cleanup = setInterval(() => syncQueue.cleanup(), 60 * 60000)
    console.log('[Sync] Engine started')
  }

  stop() {
    for (const t of Object.values(this.timers)) clearInterval(t)
    this.timers = {}
    console.log('[Sync] Engine stopped')
  }

  async forceSync() {
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
      this.emit('offline')
    }
  }

  async checkRemoteCommands() {
    if (!this.online) return
    try {
      const resp = await this._fetch('/sync/commands', { method: 'GET' })
      if (!resp.ok) return
      const commands = await resp.json()
      if (!Array.isArray(commands) || commands.length === 0) return

      for (const cmd of commands) {
        try {
          await this.executeCommand(cmd)
          await this._fetch(`/sync/commands/${cmd.id}/done`, { method: 'POST' })
        } catch (err) {
          await this._fetch(`/sync/commands/${cmd.id}/fail`, { 
            method: 'POST', body: JSON.stringify({ error: err.message }) 
          })
        }
      }
    } catch (err) {}
  }

  async executeCommand(cmd) {
    switch (cmd.type) {
      case 'reboot':
        setTimeout(() => app.relaunch() && app.exit(0), 5000)
        break
      case 'sync_now':
        await this.forceSync()
        break
      default:
        throw new Error('Unknown command type: ' + cmd.type)
    }
  }

  async pushOutbound() {
    if (!this.online || this.syncing) return
    this.syncing = true
    try {
      const pending = syncQueue.getPending(50)
      if (pending.length === 0) { this.syncing = false; return }

      for (const item of pending) {
        try {
          await this._pushItem(item)
          syncQueue.markSynced(item.id)
          this.stats.pushedCount++
        } catch (err) {
          syncQueue.markFailed(item.id, err.message)
          this.stats.errors.push({ id: item.id, error: err.message, at: new Date().toISOString() })
          if (this.stats.errors.length > 50) this.stats.errors.shift()
        }
      }
      this.stats.lastSync = new Date().toISOString()
      this.stats.pendingCount = syncQueue.countPending()
      this.emit('sync:pushed', { count: pending.length })
    } finally {
      this.syncing = false
    }
  }

  async _pushItem(item) {
    const payload = JSON.parse(item.payload)
    let endpoint
    switch (item.entity_type) {
      case 'sale':    endpoint = '/sync/push/sale'; break
      case 'card':    endpoint = '/sync/push/card'; break
      case 'machine': endpoint = '/sync/push/machine'; break
      case 'day_close': endpoint = '/sync/push/day-close'; break
      default: return
    }
    const resp = await this._fetch(endpoint, { method: 'POST', body: JSON.stringify(payload) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  }

  async pullAll() {
    if (!this.online) return
    const entities = ['machines', 'prices', 'settings', 'cards', 'interfaces', 'peripherals']
    for (const entity of entities) {
      await this.pullEntity(entity)
    }
    this.stats.lastPull = new Date().toISOString()
  }

  async pullEntity(entityType) {
    if (!this.online) return
    try {
      const meta = syncMeta.get(entityType)
      const since = meta?.last_synced_at || '1970-01-01T00:00:00Z'
      const endpoint = `/sync/pull/${entityType}`

      const resp = await this._fetch(`${endpoint}?since=${encodeURIComponent(since)}`, { method: 'GET' })
      if (!resp.ok) return

      const items = await resp.json()
      if (!Array.isArray(items) || items.length === 0) return

      this.stats.pulledCount += items.length

      switch (entityType) {
        case 'prices': prices.bulkReplace(this.tenantId, items.map(p => this._mapPrice(p))); break
        case 'settings': settings.bulkReplace(this.tenantId, items); break
        case 'machines': machines.bulkUpsertConfigOnly(items.map(m => this._mapMachine(m))); break
        case 'cards': cards.bulkUpsertPreserveBalance(items.map(c => this._mapCard(c))); break
        case 'interfaces': interfaces.bulkReplace(this.tenantId, items.map(i => this._mapInterface(i))); break
        case 'peripherals': peripherals.bulkReplace(this.tenantId, items.map(p => this._mapPeripheral(p))); break
      }
      syncMeta.set(entityType, { last_synced_at: new Date().toISOString() })
    } catch (err) {}
  }

  async bootstrap() {
    this.emit('bootstrap:start')
    try {
      await this.checkConnectivity()
      if (!this.online) throw new Error('Server unreachable')
      for (const entity of ['machines', 'prices', 'settings', 'cards', 'interfaces', 'peripherals']) {
        await this.pullEntity(entity)
      }
      this.emit('bootstrap:complete')
      return { success: true }
    } catch (err) {
      this.emit('bootstrap:failed', { error: err.message })
      return { success: false, error: err.message }
    }
  }

  _mapMachine(m) { return { id: m._id || m.id, local_id: null, tenant_id: m.tenantId || this.tenantId, name: m.name, number: m.number, brand: m.brand, model: m.model, serial_number: m.serialNumber, status: m.status, status_text: m.statusText, cycle: m.cycle, weight: m.weight, type: m.type, icon: m.icon, int_id: m.intId, channel: m.channel, impulses: m.impulses, reserved: m.reserved?1:0, reserved_by: m.reservedBy, reserved_at: m.reservedAt, reservation_duration: m.reservationDuration, current_program: m.currentProgram, started_at: m.startedAt, estimated_end_time: m.estimatedEndTime, running_duration: m.runningDuration, interface_id: m.interfaceId?._id || m.interfaceId, port: m.port, activation: m.activation, t_imp: m.tImp, created_at: m.createdAt, updated_at: m.updatedAt, synced: 1, last_synced_at: new Date().toISOString() } }
  _mapCard(c) { return { id: c._id || c.id, local_id: null, tenant_id: c.tenantId || this.tenantId, code: c.code, balance: c.balance, name: c.name, email: c.email, phone: c.phone, contribuinte: c.contribuinte, metadata: c.metadata?JSON.stringify(c.metadata):null, created_at: c.createdAt, updated_at: c.updatedAt, synced: 1, last_synced_at: new Date().toISOString() } }
  _mapPrice(p) { return { id: p._id || p.id, tenant_id: p.tenantId || this.tenantId, type: p.type, weight: p.weight, duration: p.duration, cash_price: p.cashPrice??p.cash_price??0, card_price: p.cardPrice??p.card_price??0, promo_active: p.promoActive?1:0, promo_cash_price: p.promoCashPrice, promo_card_price: p.promoCardPrice, promo_start_time: p.promoStartTime, promo_end_time: p.promoEndTime, promo_days: p.promoDays?JSON.stringify(p.promoDays):null, created_at: p.createdAt, updated_at: p.updatedAt } }
  _mapInterface(i) { return { id: i._id || i.id, tenant_id: i.tenantId || this.tenantId, name: i.name, brand: i.brand, model: i.model, serial_number: i.serialNumber||i.serial_number, address: i.address, ports: i.ports||2, t_on: i.tOn??i.t_on??100, t_off: i.tOff??i.t_off??100, status: i.status||'inactive', created_at: i.createdAt, updated_at: i.updatedAt } }
  _mapPeripheral(p) { return { id: p._id || p.id, tenant_id: p.tenantId || this.tenantId, name: p.name, type: p.type, enabled: p.enabled?1:0, protocol: p.protocol||'pulse', address: p.address, baud_rate: p.baudRate||p.baud_rate, brand: p.brand, model: p.model, serial_number: p.serialNumber||p.serial_number, status: p.status||'unknown', image: p.image, hopper_config: p.hopperConfig?JSON.stringify(p.hopperConfig):null, created_at: p.createdAt, updated_at: p.updatedAt } }

  async _fetch(urlPath, opts = {}) {
    const url = `${this.serverUrl}${urlPath}`
    const headers = { 'Authorization': `ApiKey ${this.apiKey}`, 'Content-Type': 'application/json', 'X-Tenant-Id': this.tenantId }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), opts.timeout || 10000)
    try {
      return await fetch(url, { method: opts.method || 'GET', headers, body: opts.body || undefined, signal: controller.signal })
    } finally { clearTimeout(timeout) }
  }

  getStatus() {
    return { online: this.online, syncing: this.syncing, lastSync: this.stats.lastSync, lastPull: this.stats.lastPull, pendingCount: syncQueue.countPending(), pushedTotal: this.stats.pushedCount, pulledTotal: this.stats.pulledCount, errors: this.stats.errors.slice(-10) }
  }
}

module.exports = { SyncEngine }

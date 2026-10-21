/**
 * Remote commands — the central admin asks, this shop does.
 *
 * The central server (Hetzner) has no machines connected, so an admin pressing "Start" there
 * queues a `SyncCommand` for this site's kiosk user. This worker asks for pending commands
 * every few seconds, runs each one against the real hardware, and reports back done/failed.
 *
 * Offline is normal: nothing runs while the internet is down and nothing is lost — the
 * commands wait on the server. A command is handed out once (the server marks it executing),
 * and the server expires nothing, so a command left over from a crash is reported by the
 * operator, not silently replayed (an old "start the washer" must never run hours later).
 * To guard that, commands older than `maxAgeMs` are failed, not executed.
 *
 * Enabled by the same SYNC_SERVER_URL / SYNC_API_KEY as the uplink.
 * Reference: docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md §14
 */
import EventEmitter from 'events'

export class RemoteCommands extends EventEmitter {
  constructor({
    handlers = {},
    url = process.env.SYNC_SERVER_URL,
    apiKey = process.env.SYNC_API_KEY,
    intervalMs = 5_000,
    timeoutMs = 10_000,
    maxAgeMs = 2 * 60_000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    super()
    this.handlers = handlers
    this.url = url ? String(url).replace(/\/+$/, '') : ''
    this.apiKey = apiKey
    this.intervalMs = intervalMs
    this.timeoutMs = timeoutMs
    this.maxAgeMs = maxAgeMs
    this.fetch = fetchImpl
    this.timer = null
    this.busy = null
    this.lastOkAt = null // last time the central server answered us
    this.connected = null // null = not tried yet
  }

  /** Did the central server answer within the last `withinMs`? (the shop asks every few seconds) */
  isOnline(withinMs = 20_000) {
    return Boolean(this.lastOkAt) && Date.now() - this.lastOkAt < withinMs
  }

  /** What the kiosk badge and the admin show. `enabled: false` = no central server on this install (nothing to be offline from). */
  connection() {
    return { enabled: this.enabled, online: this.enabled ? this.isOnline() : null, lastOkAt: this.lastOkAt ? new Date(this.lastOkAt).toISOString() : null }
  }

  noteResult(ok) {
    if (ok) this.lastOkAt = Date.now()
    // One missed poll is not an outage: it takes more than 20 s without an answer.
    const now = ok ? true : this.isOnline() ? this.connected : false
    if (now === this.connected) return
    const was = this.connected
    this.connected = now
    if (was !== null) this.emit(now ? 'online' : 'offline')
  }

  get enabled() {
    return Boolean(this.url && this.apiKey) && process.env.SYNC_ENABLED !== 'false'
  }

  start() {
    if (!this.enabled) return
    this.timer = setInterval(() => this.poll().catch(() => {}), this.intervalMs)
    this.timer.unref?.()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = null
  }

  async call(path, method, body) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await this.fetch(`${this.url}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${this.apiKey}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res
    } finally {
      clearTimeout(t)
    }
  }

  /** One round: fetch pending commands, run them in order. Never rejects; never overlaps itself. */
  poll() {
    if (!this.enabled) return Promise.resolve([])
    if (this.busy) return this.busy
    this.busy = (async () => {
      const results = []
      let list
      try {
        list = await (await this.call('/sync/commands', 'GET')).json()
        this.noteResult(true)
      } catch {
        this.noteResult(false)
        return results // offline or server down: ask again next time
      }
      if (!Array.isArray(list)) return results
      for (const cmd of list) results.push(await this.run(cmd))
      return results
    })().finally(() => { this.busy = null })
    return this.busy
  }

  async run(cmd) {
    const id = cmd.id || cmd._id
    const age = cmd.createdAt ? Date.now() - new Date(cmd.createdAt).getTime() : 0
    let error = ''
    let result
    if (age > this.maxAgeMs) {
      error = 'Expired: the command was older than ' + Math.round(this.maxAgeMs / 1000) + 's when this site got it'
    } else if (!this.handlers[cmd.type]) {
      error = `Unsupported command: ${cmd.type}`
    } else {
      try {
        result = await this.handlers[cmd.type](cmd.payload || {})
      } catch (err) {
        error = err?.message || String(err)
      }
    }
    try {
      if (error) await this.call(`/sync/commands/${id}/fail`, 'POST', { error })
      else await this.call(`/sync/commands/${id}/done`, 'POST', result === undefined ? {} : { result })
    } catch { /* the result could not be reported; the command ran (or failed) all the same */ }
    this.emit(error ? 'failed' : 'done', { id, type: cmd.type, error })
    if (error) console.warn(`[RemoteCommands] ${cmd.type} failed: ${error}`)
    else console.log(`[RemoteCommands] ${cmd.type} done`)
    return { id, type: cmd.type, error }
  }
}

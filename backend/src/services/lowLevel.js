/**
 * Low-level controller link (TCP + JSON).
 *
 * The shop hardware is not wired to the POS PC. Coin/bill acceptors, hopper,
 * card dispenser, RFID writer, printer and the KITSEC machine interfaces all sit
 * behind a separate controller on the hardware LAN (observed: 192.168.2.201,
 * TCP 16852). The legacy LMA middleware (`lma-middleware-pt-0317/app.js`) is a
 * thin bridge to it: it opens ONE TCP socket and exchanges JSON.
 *
 *   PC  -> controller : {"cl":"<n>","c":{"op":"...", ...}}   (framed, see below)
 *   controller -> PC  : {"op":"...", "data"|"dev": ..., "code": "200"}  (bare JSON)
 *
 * Responses to a request carry a `code` ("200" ok, "201" written, anything else a
 * failure). Unsolicited events (coin-inserted, card-inserted, ...) have no `code`.
 *
 * Everything on this wire is a string: ids, channels, cents, codes.
 *
 * Reference: docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md
 */
import net from 'net'
import EventEmitter from 'events'
import { StringDecoder } from 'string_decoder'

export const LOWLEVEL_DEFAULT_HOST = '192.168.2.201'
export const LOWLEVEL_DEFAULT_PORT = 16852

/** Legacy keep-alive cadence: every 90 s, but only if the app was silent for 2 min. */
// The legacy bridge pinged every 90 s when idle. Same cadence here; LOWLEVEL_KEEPALIVE_MS overrides.
export const KEEPALIVE_CHECK_MS = Number(process.env.LOWLEVEL_KEEPALIVE_MS) || 90 * 1000
export const KEEPALIVE_IDLE_MS = 2 * 60 * 1000
export const RECONNECT_MS = 5 * 1000

/** Hard cap on buffered, unparsed bytes so a garbage stream cannot grow forever. */
const MAX_BUFFER_CHARS = 1024 * 1024

/**
 * Build the wire frame for one request.
 *
 * The length formula is copied verbatim from the legacy bridge — including its
 * quirk of adding the digit-count of the *payload* length rather than of the
 * frame length, so `cl` is one short right at the 99->100 style boundaries.
 * The controller has always been fed this exact value, so it is deliberately
 * NOT "fixed" here.
 */
export function frameLowLevel(pkg) {
  const dataLength = JSON.stringify(pkg).length
  const pkgLength = dataLength + dataLength.toString().length + 14
  return JSON.stringify({ cl: pkgLength.toString(), c: pkg })
}

/**
 * Incremental extractor of top-level JSON objects from a TCP byte stream.
 *
 * The legacy bridge did `JSON.parse(chunk)` per `data` event, which silently
 * lost any message split across two TCP segments and any two messages delivered
 * in one — e.g. two coins credited back to back. This walks braces instead
 * (string- and escape-aware), so framing no longer depends on segment
 * boundaries.
 */
export class LowLevelStreamParser {
  constructor() {
    this.decoder = new StringDecoder('utf8')
    this.buf = ''
  }

  /** Feed a chunk; returns every complete message now available. */
  push(chunk) {
    this.buf += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    const out = []

    for (;;) {
      const start = this.buf.indexOf('{')
      if (start === -1) { this.buf = ''; break }
      if (start > 0) this.buf = this.buf.slice(start)

      const end = this.findObjectEnd(this.buf)
      if (end === -1) break // incomplete — wait for more bytes

      const text = this.buf.slice(0, end + 1)
      this.buf = this.buf.slice(end + 1)
      try {
        const obj = JSON.parse(text)
        if (obj && typeof obj === 'object') out.push(obj)
      } catch {
        // A balanced-but-invalid object: drop it, keep the stream going.
      }
    }

    if (this.buf.length > MAX_BUFFER_CHARS) {
      console.error(`[LowLevel] receive buffer over 1 MB, dropped ${this.buf.length} bytes`)
      this.buf = ''
    }
    return out
  }

  /** Index of the `}` closing the object that starts at 0, or -1 if incomplete. */
  findObjectEnd(s) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return i
      }
    }
    return -1
  }
}

/** Euros -> the integer-cents string the controller expects ("150" for 1.50). */
export function euroToCents(value) {
  return String(Math.round(Number(value) * 100))
}

/** Controller cents (string or number) -> euros. */
export function centsToEuro(cents) {
  const n = Number(cents)
  return Number.isFinite(n) ? Math.round(n) / 100 : 0
}

/**
 * Decode a `status_int` reply.
 *
 * `dev` is `[{ id, active, status }]`: `id` the interface id, `active` "1" when
 * the interface answers (anything else = disconnected), and `status` a bit
 * string with one character per channel; channel *n* is `status[status.length - n]`.
 *
 * A bit is the electrical LEVEL of that channel, not "running". Whether high or
 * low means busy depends on the machine's `activation` polarity — see
 * `isChannelBusy`. (The legacy kiosk's availability logic is polarity-aware; only
 * its admin status page assumes "1 = running".)
 */
export function decodeInterfaceStatus(dev) {
  if (!Array.isArray(dev)) return []
  return dev.map((item) => {
    const id = String(item.id)
    const connected = String(item.active) === '1'
    const bits = typeof item.status === 'string' ? item.status : ''
    const channels = []
    for (let chn = 1; chn <= bits.length && chn <= 8; chn++) {
      channels.push({ chn, level: bits[bits.length - chn] === '1' })
    }
    return { id, connected, channels }
  })
}

/**
 * Is a machine busy, given its channel level and activation polarity?
 * `high`: level 1 = busy. `low`: level 0 = busy. (Legacy `Machines.updateMachineState`.)
 */
export function isChannelBusy(level, activation = 'high') {
  return activation === 'low' ? !level : Boolean(level)
}

/**
 * TCP client for the low-level controller: connects, reconnects, frames
 * outgoing requests, splits incoming messages and keeps the link awake.
 *
 * Events: `connect`, `disconnect`, `package` (a decoded message), `link-error`.
 */
export class LowLevelLink extends EventEmitter {
  constructor({
    host = LOWLEVEL_DEFAULT_HOST,
    port = LOWLEVEL_DEFAULT_PORT,
    reconnectMs = RECONNECT_MS,
    keepAliveCheckMs = KEEPALIVE_CHECK_MS,
    keepAliveIdleMs = KEEPALIVE_IDLE_MS,
    keepAlive = true,
  } = {}) {
    super()
    this.host = host
    this.port = port
    this.reconnectMs = reconnectMs
    this.keepAliveCheckMs = keepAliveCheckMs
    this.keepAliveIdleMs = keepAliveIdleMs
    this.keepAlive = keepAlive

    this.socket = null
    this.parser = new LowLevelStreamParser()
    this.connected = false
    this.stopped = true
    this.lastAppSendAt = 0
    this.reconnectTimer = null
    this.keepAliveTimer = null
  }

  get isConnected() { return this.connected }

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.lastAppSendAt = 0
    this.openSocket()
    if (this.keepAlive) {
      this.keepAliveTimer = setInterval(() => this.keepAliveTick(), this.keepAliveCheckMs)
      this.keepAliveTimer.unref?.()
    }
  }

  stop() {
    this.stopped = true
    clearTimeout(this.reconnectTimer)
    clearInterval(this.keepAliveTimer)
    this.reconnectTimer = this.keepAliveTimer = null
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.on('error', () => {})
      this.socket.destroy()
      this.socket = null
    }
    if (this.connected) {
      this.connected = false
      this.emit('disconnect')
    }
  }

  openSocket() {
    if (this.stopped) return
    const socket = new net.Socket()
    this.socket = socket
    this.parser = new LowLevelStreamParser()
    socket.setNoDelay(true)
    socket.setKeepAlive?.(true, 30000) // so a half-dead link is noticed

    socket.on('connect', () => {
      this.connected = true
      this.emit('connect')
    })
    socket.on('data', (chunk) => {
      for (const pkg of this.parser.push(chunk)) this.emit('package', pkg)
    })
    socket.on('error', (err) => {
      this.emit('link-error', err)
    })
    socket.on('close', () => {
      const wasConnected = this.connected
      this.connected = false
      if (this.socket === socket) this.socket = null
      if (wasConnected) this.emit('disconnect')
      this.scheduleReconnect()
    })

    socket.connect(this.port, this.host)
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket()
    }, this.reconnectMs)
    this.reconnectTimer.unref?.()
  }

  /**
   * Send one request. Returns true when the frame was handed to the socket and
   * false when there is no connection — callers must treat false as "not sent"
   * rather than assume delivery.
   */
  send(pkg, { keepAlive = false } = {}) {
    if (!this.connected || !this.socket) return false
    this.socket.write(frameLowLevel(pkg))
    if (!keepAlive) this.lastAppSendAt = Date.now()
    return true
  }

  /**
   * The legacy bridge's "activation message": a `has-card` ping, cheap and side-effect free
   * (it only asks whether the dispenser has cards). It is sent on EVERY tick, whatever else
   * the app sent. It used to be skipped while the app had been busy within the last 2 minutes,
   * but this app polls status every minute, so the ping practically never went out and the
   * bill acceptor / card reader went dead after a while (replug fixed it).
   */
  keepAliveTick() {
    if (!this.connected) return
    this.send({ op: 'has-card' }, { keepAlive: true })
  }
}

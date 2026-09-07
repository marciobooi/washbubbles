/**
 * ccTalk protocol (see https://cctalk.org — Part 1, section 4).
 *
 * Shared by the backend middleware and mirrored by the kiosk's embedded agent
 * (`pos-client/electron/hardware-agent.cjs`). Both talk to the same devices, so
 * the framing must not drift between them.
 *
 * A frame is `[dest, dataLength, src, header, ...data, checksum]` and the
 * checksum makes the whole frame sum to zero mod 256.
 */
import EventEmitter from 'events'

export const CC_HOST = 1

/** Conventional device addresses. Overridable per peripheral in the admin UI. */
export const CC_ADDR = {
  COIN: 2,
  HOPPER: 3,
  CARD_DISPENSER: 4,
  BILL: 40,
}

export const CC_HEADER = {
  SIMPLE_POLL: 0xFE,
  READ_BUFFERED_CREDIT: 0xE5, // coin acceptor: read buffered credit / error codes
  READ_BUFFERED_BILL: 0x9F,   // bill validator: read buffered bill events
  ROUTE_BILL: 0x9A,           // bill validator: stack (0x01) or return (0x00)
  ENABLE_HOPPER: 0xA4,
  HOPPER_STATUS: 0xA6,
  DISPENSE_HOPPER: 0xA7,
  DISPENSE_CARD: 0xC0,
}

export const ROUTE = { RETURN: 0x00, STACK: 0x01 }

/**
 * Largest data payload we will believe.
 *
 * The protocol allows 252, but nothing this application asks for replies with
 * more than about a dozen bytes (a buffered-credit poll is the biggest). A
 * larger length byte is therefore noise, not a real frame — and believing it
 * makes the parser wait for bytes that never arrive.
 */
export const MAX_DATA_LEN = 64

/** ACK is a zero-length reply; NAK and BUSY are the documented negative replies. */
export const CC_REPLY = { ACK: 0x00, NAK: 0x05, BUSY: 0x06 }

export function ccChecksum(bytes) {
  return (256 - (bytes.reduce((a, b) => a + b, 0) & 0xFF)) & 0xFF
}

export function ccFrame(dest, src, header, data = []) {
  const head = [dest, data.length, src, header, ...data]
  return Buffer.from([...head, ccChecksum(head)])
}

/**
 * Pull one complete, checksum-valid ccTalk frame off the front of `buf`.
 *
 * Returns `{frame, rest}`; `frame` is null when there is not yet a whole frame.
 * On a checksum failure the leading byte is discarded and the caller should call
 * again — that resynchronises the stream after line noise instead of wedging.
 */
export function readCcFrame(buf, expectedDest = CC_HOST) {
  if (buf.length < 5) return { frame: null, rest: buf }

  // Every reply addressed to us carries our address in byte 0. A buffer that
  // starts with anything else is mid-stream garbage — drop a byte and resync.
  // Without this a noise byte landing in the length position (say 0xBB = 187)
  // makes the parser wait for 192 bytes that will never arrive, wedging the
  // peripheral silently until the process restarts.
  if (buf[0] !== expectedDest) return { frame: null, rest: buf.slice(1), resync: true }

  const len = buf[1]
  if (len > MAX_DATA_LEN) return { frame: null, rest: buf.slice(1), resync: true }

  const total = len + 5
  if (buf.length < total) return { frame: null, rest: buf }

  const bytes = buf.slice(0, total)
  if (ccChecksum([...bytes.slice(0, total - 1)]) !== bytes[total - 1]) {
    // Bad checksum: drop one byte and let the caller retry from the next offset.
    return { frame: null, rest: buf.slice(1), resync: true }
  }

  return {
    frame: { dest: bytes[0], len, src: bytes[2], header: bytes[3], data: bytes.slice(4, 4 + len) },
    rest: buf.slice(total),
  }
}

/**
 * ccTalk master over one serial port.
 *
 * Serial is a byte stream with arbitrary chunk boundaries, so every byte goes
 * through a buffer and only whole checksum-valid frames are surfaced. Reading
 * `data[0]` off a raw chunk — as the old middleware did — credits one coin when
 * two arrive together, and reads a mid-frame byte as a €20 note.
 *
 * Requests are serialised through a queue. Registering a bare `once('data')` per
 * caller (the old `waitForResponse`) let one chunk resolve two pending promises,
 * so command A's ACK was read as command B's reply.
 */
export class CcTalkLink extends EventEmitter {
  constructor(port, address, { timeoutMs = 1000 } = {}) {
    super()
    this.port = port
    this.address = address
    this.timeoutMs = timeoutMs
    this.buffer = Buffer.alloc(0)
    this.queue = []
    this.active = null
    port.on('data', (chunk) => this._onData(chunk))
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])

    // Drain every complete frame the buffer now holds — there may be several.
    for (;;) {
      const { frame, rest, resync } = readCcFrame(this.buffer, CC_HOST)
      this.buffer = rest
      if (resync) {
        this.emit('framing-error', { address: this.address })
        continue
      }
      if (!frame) break

      if (this.active) {
        const { resolve, timer } = this.active
        this.active = null
        clearTimeout(timer)
        resolve(frame)
        this._drain()
      } else {
        // No one is waiting — an unsolicited event frame from the device.
        this.emit('frame', frame)
      }
    }

    // A buffer that can never contain a valid frame is line noise; drop it
    // rather than growing without bound.
    if (this.buffer.length > 512) this.buffer = this.buffer.slice(-64)
  }

  _drain() {
    if (this.active || this.queue.length === 0) return
    const next = this.queue.shift()
    this._send(next)
  }

  _send(job) {
    const timer = setTimeout(() => {
      this.active = null
      // Whatever is sitting in the buffer did not form a frame in time, so it is
      // stale or corrupt. Dropping it stops a half-frame from being glued to the
      // front of the next reply and corrupting that one too.
      this.buffer = Buffer.alloc(0)
      job.reject(new Error(`ccTalk timeout (addr ${this.address}, header 0x${job.header.toString(16)})`))
      this._drain()
    }, job.timeoutMs)

    this.active = { resolve: job.resolve, timer }
    try {
      this.port.write(ccFrame(this.address, CC_HOST, job.header, job.data))
    } catch (err) {
      clearTimeout(timer)
      this.active = null
      job.reject(err)
      this._drain()
    }
  }

  /**
   * Send one command and resolve with its reply frame.
   * Queued behind any request already in flight on this port.
   */
  request(header, data = [], timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      this.queue.push({ header, data, timeoutMs, resolve, reject })
      this._drain()
    })
  }

  /** Reject everything outstanding — used when the port drops. */
  destroy(reason = 'port closed') {
    if (this.active) {
      clearTimeout(this.active.timer)
      this.active = null
    }
    const pending = this.queue.splice(0)
    for (const job of pending) job.reject(new Error(reason))
  }
}

export default { CC_HOST, CC_ADDR, CC_HEADER, ROUTE, CC_REPLY, ccChecksum, ccFrame, readCcFrame, CcTalkLink }

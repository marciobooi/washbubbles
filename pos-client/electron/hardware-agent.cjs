/**
 * WashBubbles Embedded Hardware Agent
 * Integrated into Electron main process for direct serial communication
 *
 * Improvements:
 * - #2: Auto-reconnect logic for disconnected ports
 * - #20: Detailed status reporting
 * - #25: Real ccTalk protocol for coin/bill acceptors and the hopper
 *   (poll-based, matching the documented protocol in
 *   backend/src/HARDWARE_AGENT_README.md and the reference implementation
 *   in virtual-serial-server/index.js — the two most common ccTalk message
 *   classes: simple poll / read-buffered-credit, and dispense/status for a
 *   payout hopper. Anything beyond that — MDB, multi-hopper coin sorting,
 *   vendor-specific event tables — is out of scope until a real device
 *   proves it's needed.)
 */
const EventEmitter = require('events')
const { SerialPort } = require('serialport')
const { ReadlineParser } = require('@serialport/parser-readline')

// ─── ccTalk framing (see https://cctalk.org — Part 1, section 4) ───────────
const CC_HOST = 1
const CC_ADDR = { BV: 40, HOP: 4 } // conventional addresses for bill validator / hopper
const CC_HEADER = {
  SIMPLE_POLL: 0xFE,
  READ_BUFFERED_CREDIT: 0x9F, // bill validator: read buffered bill events
  ROUTE_BILL: 0x9A,           // bill validator: stack (0x01) or return (0x00) the last bill
  ENABLE_HOPPER: 0xA4,
  HOPPER_STATUS: 0xA6,
  DISPENSE_HOPPER: 0xA7,
}
const ROUTE = { RETURN: 0x00, STACK: 0x01 }

function ccChecksum(bytes) {
  return (256 - (bytes.reduce((a, b) => a + b, 0) & 0xFF)) & 0xFF
}
function ccFrame(dest, src, header, data = []) {
  const head = [dest, data.length, src, header, ...data]
  return Buffer.from([...head, ccChecksum(head)])
}
/** Pull one complete ccTalk frame off the front of `buf`, if present. */
function readCcFrame(buf) {
  if (buf.length < 5) return null
  const len = buf[1]
  const total = len + 5
  if (buf.length < total) return null
  return {
    dest: buf[0], len, src: buf[2], header: buf[3],
    data: buf.slice(4, 4 + len), total,
  }
}

/**
 * Minimal ccTalk master: one request in flight at a time, matching how a
 * simple host polling loop actually talks to a slave device.
 */
class CcTalkLink {
  constructor(port, address) {
    this.port = port
    this.address = address
    this.buffer = Buffer.alloc(0)
    this.waiter = null
    port.on('data', (chunk) => this._onData(chunk))
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frame = readCcFrame(this.buffer)
    if (!frame) return
    this.buffer = this.buffer.slice(frame.total)
    if (this.waiter) {
      const { resolve, timer } = this.waiter
      this.waiter = null
      clearTimeout(timer)
      resolve(frame)
    }
  }

  request(header, data = [], timeoutMs = 1000) {
    if (this.waiter) return Promise.reject(new Error('ccTalk request already in flight'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiter = null; reject(new Error('ccTalk timeout')) }, timeoutMs)
      this.waiter = { resolve, timer }
      this.port.write(ccFrame(this.address, CC_HOST, header, data))
    })
  }
}

class EmbeddedHardwareAgent extends EventEmitter {
  constructor(config) {
    super()
    this.config = config || { peripherals: {} }
    this.ports = {} // Maps type -> SerialPort object
    this.links = {} // Maps type -> CcTalkLink (bill_acceptor, coin_acceptor, hopper)
    this.pollTimers = {}
    this.peripheralsStatus = {} // Maps type -> { connected: bool, error: string, lastError: string }
    this.reconnectTimer = null
  }

  /** Start all configured peripherals */
  async start() {
    console.log('[HW] Starting embedded hardware agent...')
    await this.initializePeripherals()

    // Start auto-reconnect loop every 30s
    this.reconnectTimer = setInterval(() => this.autoReconnect(), 30000)

    return this.getStatus()
  }

  /** Stop all peripherals */
  async stop() {
    console.log('[HW] Stopping hardware agent...')
    if (this.reconnectTimer) clearInterval(this.reconnectTimer)
    for (const timer of Object.values(this.pollTimers)) clearInterval(timer)
    this.pollTimers = {}

    for (const [type, port] of Object.entries(this.ports)) {
      if (port && port.isOpen) {
        await new Promise(resolve => port.close(resolve))
      }
    }
    this.ports = {}
    this.links = {}
  }

  async initializePeripherals() {
    const { peripherals } = this.config
    const types = ['coin_acceptor', 'bill_acceptor', 'interface', 'hopper', 'card_dispenser', 'printer', 'rfid_reader']

    for (const type of types) {
      const p = peripherals[type]
      if (p && p.enabled && p.port) {
        try {
          await this.connectPeripheral(type, p)
          this.peripheralsStatus[type] = { connected: true, port: p.port }
        } catch (err) {
          this.peripheralsStatus[type] = { connected: false, error: err.message, port: p.port }
        }
      } else {
        this.peripheralsStatus[type] = { connected: false, error: 'disabled' }
      }
    }
  }

  /** Auto-reconnect loop: attempts to fix broken connections */
  async autoReconnect() {
    const { peripherals } = this.config
    for (const [type, status] of Object.entries(this.peripheralsStatus)) {
      if (!status.connected && status.error !== 'disabled') {
        const p = peripherals[type]
        if (p && p.port) {
          console.log(`[HW] Attempting auto-reconnect for ${type} on ${p.port}...`)
          try {
            await this.connectPeripheral(type, p)
            this.peripheralsStatus[type] = { connected: true, port: p.port }
            this.emit('hardware:reconnected', { type })
          } catch (err) {
            this.peripheralsStatus[type].error = err.message
          }
        }
      }
    }
  }

  async connectPeripheral(type, config) {
    // If already open, close it first to be safe
    if (this.ports[type] && this.ports[type].isOpen) {
      await new Promise(resolve => this.ports[type].close(resolve))
    }
    if (this.pollTimers[type]) { clearInterval(this.pollTimers[type]); delete this.pollTimers[type] }

    return new Promise((resolve, reject) => {
      const port = new SerialPort({
        path: config.port,
        baudRate: parseInt(config.baudRate) || 9600,
        autoOpen: false
      })

      port.open((err) => {
        if (err) return reject(err)

        this.ports[type] = port
        this.setupParser(type, port, config)
        resolve()
      })

      port.on('error', (err) => {
        console.error(`[HW] Error on ${type}:`, err.message)
        this.peripheralsStatus[type] = { connected: false, error: err.message, lastError: err.message }
        this.emit('hardware:error', { type, error: err.message })
      })

      port.on('close', () => {
        if (this.peripheralsStatus[type]?.connected) {
          console.warn(`[HW] Port closed unexpectedly for ${type}`)
          this.peripheralsStatus[type] = { connected: false, error: 'disconnected' }
          this.emit('hardware:disconnected', { type })
        }
        if (this.pollTimers[type]) { clearInterval(this.pollTimers[type]); delete this.pollTimers[type] }
      })
    })
  }

  setupParser(type, port, config) {
    if (type === 'rfid_reader') {
      const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }))
      parser.on('data', (line) => this.handleIncomingData(type, line.trim()))
      return
    }
    if (type === 'coin_acceptor' || type === 'bill_acceptor') {
      const address = config.address || CC_ADDR.BV
      this.links[type] = new CcTalkLink(port, address)
      this.startBillPolling(type)
      return
    }
    if (type === 'hopper') {
      this.links[type] = new CcTalkLink(port, config.address || CC_ADDR.HOP)
      return
    }
    if (type === 'card_dispenser') {
      // ccTalk (address-based) or plain pulse — pulse dispensers don't talk back.
      if (config.protocol === 'cctalk') this.links[type] = new CcTalkLink(port, config.address || 4)
      return
    }
    port.on('data', (data) => this.handleRawData(type, data))
  }

  /** Poll a bill/coin acceptor for buffered credit events. This is the
   *  standard ccTalk host loop: the device never pushes data unsolicited. */
  startBillPolling(type) {
    const link = this.links[type]
    const intervalMs = 300
    this.pollTimers[type] = setInterval(async () => {
      try {
        const frame = await link.request(CC_HEADER.READ_BUFFERED_CREDIT)
        for (let i = 0; i + 1 < frame.data.length; i += 2) {
          this.handleBillEvent(type, link, frame.data[i], frame.data[i + 1])
        }
      } catch (err) {
        // Timeout/no response on a poll tick is routine (nothing happened) —
        // only surface it if the port itself is gone.
      }
    }, intervalMs)
  }

  /** eventCode/billType pairs follow virtual-serial-server's simplified event
   *  table (0x10 inserted, 0x11 stacked, 0x12 rejected) — the same shape most
   *  ccTalk bill validators use for their basic "credit" event class. */
  async handleBillEvent(type, link, eventCode, billType) {
    if (eventCode === 0x10) {
      // Bill inserted and validated — accept it (route to stack). A real
      // deployment could add fraud/limit checks here before accepting.
      try { await link.request(CC_HEADER.ROUTE_BILL, [ROUTE.STACK]) }
      catch (err) { console.error(`[HW] Failed to route bill on ${type}:`, err.message) }
      return
    }
    if (eventCode === 0x11) {
      // Stacked — money is now committed, safe to credit. `amount` is the
      // raw device-reported type code; the actual currency value comes from
      // the configurable coinEqTable/billEqTable (see pos-engine.cjs).
      const amount = `0x${String(billType).padStart(2, '0')}`
      this.emit('credit', { type, amount })
      return
    }
    if (eventCode === 0x12) {
      this.emit('credit:rejected', { type, reason: 'device_rejected' })
    }
  }

  handleIncomingData(type, data) {
    if (!data) return
    if (type === 'rfid_reader') this.emit('rfid:card_detected', { cardCode: data })
  }

  handleRawData(type, data) {
    // Binary protocol handling for peripherals without their own parser (KITSEC interface, printer)
  }

  activateMachine(machine, iface) {
    const port = this.ports['interface']
    if (!port || !port.isOpen) {
      this.emit('machine:activation_failed', { machineId: machine.id, error: 'Interface disconnected' })
      return false
    }
    const cmd = Buffer.from([0x02, 0x41, iface.address || 0, machine.port || 0, 0x05, 0x00, 0x03])
    port.write(cmd, (err) => {
      if (err) this.emit('machine:activation_failed', { machineId: machine.id, error: err.message })
      else this.emit('machine:activation_sent', { machineId: machine.id })
    })
    return true
  }

  /** Dispense `amount` euros of change from the hopper.
   *  Basic/most-common case: a single-denomination hopper (one coin value
   *  loaded, configured via peripherals.hopper.coinValue — defaults to 1€,
   *  the typical laundromat setup). Multi-hopper denomination mixing isn't
   *  implemented — the backend's day-close/hopper-target UI already assumes
   *  per-denomination hoppers, so this is the piece to extend first if a
   *  real deployment needs more than one coin value dispensed here.
   *
   *  ccTalk dispense (167) only ACKs that the command was *accepted* —
   *  coins physically drop out over the next several hundred ms per coin,
   *  so completion/failure is only knowable by polling status (166)
   *  afterwards until the hopper stops reporting "paying". */
  async dispenseCoins(amount, opts = {}) {
    const link = this.links['hopper']
    const port = this.ports['hopper']
    if (!link || !port || !port.isOpen) {
      console.error('[HW] Hopper not connected, cannot dispense')
      this.emit('hopper:fault', { reason: 'not_connected' })
      return false
    }
    // Admin-dashboard settings (opts, threaded through from pos-engine.cjs)
    // take priority over the local per-kiosk config.json — this is a
    // business/money value, not a wiring detail, so it belongs in one place
    // the operator can change without touching every kiosk's files.
    const coinValue = Number(opts.coinValue) || Number(this.config.peripherals?.hopper?.coinValue) || 1.0
    const count = Math.round(amount / coinValue)
    if (count <= 0) return true

    // Safety ceiling: a laundromat hopper giving change should never need to
    // dispense more than a few dozen coins for one transaction. This exists
    // to catch a calculation bug (e.g. euros vs cents, a misplaced decimal)
    // before it drains the hopper — refuse and fault instead of trying.
    const MAX_COINS_PER_DISPENSE = Number(opts.maxCoins) || 50
    if (count > MAX_COINS_PER_DISPENSE) {
      console.error(`[HW] Refusing to dispense ${count} coins (>${MAX_COINS_PER_DISPENSE}) for €${amount} — looks like a calculation error, not real change`)
      this.emit('hopper:fault', { reason: 'dispense_amount_too_large', requested: amount, count })
      return false
    }

    console.log(`[HW] Dispensing €${amount.toFixed(2)} as ${count} x €${coinValue} from hopper`)
    try {
      const ack = await link.request(CC_HEADER.DISPENSE_HOPPER, [count], 3000)
      if (ack.header !== 0x00) throw new Error('dispense command NAK\'d by hopper')
    } catch (err) {
      console.error('[HW] Hopper dispense command failed:', err.message)
      this.emit('hopper:fault', { reason: 'fault' })
      return false
    }

    // Poll status until the hopper reports it's done paying (or we time out).
    const deadline = Date.now() + count * 500 + 2000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250))
      const status = await this.checkHopperStatus()
      if (status && !status.paying) {
        this.emit('hopper:dispensed', { success: true, count })
        return true
      }
    }
    console.error('[HW] Hopper dispense timed out waiting for completion')
    this.emit('hopper:dispensed', { success: false, count })
    this.emit('hopper:fault', { reason: 'jam' })
    return false
  }

  /** Poll the hopper's own paying/idle status. */
  async checkHopperStatus() {
    const link = this.links['hopper']
    if (!link) return null
    try {
      const resp = await link.request(CC_HEADER.HOPPER_STATUS)
      const paying = resp.data[0] === 0x01
      return { paying }
    } catch {
      return null
    }
  }

  async dispenseCard() {
    const port = this.ports['card_dispenser']
    const link = this.links['card_dispenser']
    if (!port || !port.isOpen) {
      this.emit('card_dispenser:dispensed', { success: false, error: 'not_connected' })
      return false
    }
    if (link) {
      try {
        await link.request(0xC0, [], 3000) // ccTalk dispense-card command
        this.emit('card_dispenser:dispensed', { success: true })
        return true
      } catch (err) {
        this.emit('card_dispenser:dispensed', { success: false, error: err.message })
        return false
      }
    }
    // Pulse-based dispenser — no talk-back, fire and assume success.
    const pulseWidth = this.config.peripherals?.card_dispenser?.pulseWidth || 500
    port.set({ rts: true })
    setTimeout(() => port.set({ rts: false }), pulseWidth)
    this.emit('card_dispenser:dispensed', { success: true })
    return true
  }

  printReceipt(content) {
    const port = this.ports['printer']
    if (!port || !port.isOpen) return false
    port.write(content)
    port.write('\n\n\n\x1Bm')
    return true
  }

  getStatus() {
    return { ...this.peripheralsStatus }
  }
}

module.exports = { EmbeddedHardwareAgent }

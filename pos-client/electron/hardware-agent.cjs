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

// ─── RFID: MIFARE Classic over a PC/SC-style pseudo-APDU reader ────────────
// Mirrors backend/src/services/middleware.js's RFID section exactly — same
// command bytes, same authenticate-before-every-block requirement, same
// "read back what we wrote" write verification. See that file's header
// comment for the full reasoning and, importantly, its confidence note:
// these commands are the standard PC/SC Part 3 family (Get UID, Load Key,
// General Authenticate, Read/Update Binary) supported by most USB CCID
// contactless readers, but have NOT been exercised against a real reader in
// either place — confirm against the actual reader's datasheet before
// relying on this in production.
const MIFARE_BLOCK_SIZE = 16
const MIFARE_DEFAULT_KEY = Buffer.from('FFFFFFFFFFFF', 'hex')
const MIFARE_KEY_SLOT = 0x00
const MIFARE_KEY_TYPE_A = 0x60
const RFID_POLL_INTERVAL_MS = 500

/** Data block numbers on a MIFARE Classic card, skipping sector trailers (every 4th: 3, 7, 11, …). */
function dataBlockNumbers(count, maxBlock = 63) {
  const blocks = []
  for (let b = 1; b <= maxBlock && blocks.length < count; b++) {
    if ((b + 1) % 4 === 0) continue
    blocks.push(b)
  }
  return blocks
}

/** PC/SC-style readers answer with a two-byte status word; 0x9000 means OK. */
function isPcscSuccess(resp) {
  if (!resp || resp.length < 2) return false
  return resp[resp.length - 2] === 0x90 && resp[resp.length - 1] === 0x00
}

/**
 * One command in flight at a time on an RFID port, matching how a PC/SC
 * reader is actually addressed: it only ever speaks in reply to something we
 * just asked it. Every byte it sends is therefore the answer to whichever
 * request is currently queued — never a spontaneous "card tapped" push — so
 * this must be the ONLY listener on the port's `data` event.
 */
class RfidLink {
  constructor(port) {
    this.port = port
    this.queue = Promise.resolve()
  }

  request(command, timeoutMs = 500) {
    const run = () => new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => { clearTimeout(timer); this.port.removeListener('data', onData) }
      const onData = (data) => { if (settled) return; settled = true; cleanup(); resolve(data) }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        resolve(null) // silence on a poll tick is routine, not fatal — caller decides
      }, timeoutMs)
      this.port.on('data', onData)
      this.port.write(command, (err) => {
        if (err && !settled) { settled = true; cleanup(); reject(err) }
      })
    })
    const result = this.queue.then(run, run)
    this.queue = result.then(() => {}, () => {})
    return result
  }
}

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
    this.rfidLinks = {} // Maps type -> RfidLink (rfid_reader)
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
    this.rfidLinks = {}
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
      // A PC/SC-style reader only speaks when asked, so `RfidLink` is the ONLY
      // listener on this port's `data` event — see its class comment. Nothing
      // else may attach a listener here, or a command's own reply gets
      // reinterpreted as a spontaneous tap.
      this.rfidLinks[type] = new RfidLink(port)
      this.startRfidPolling(type)
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

  /**
   * Read the card's factory UID via the standard PC/SC "Get Data" command.
   * Used only to detect that a (possibly different) card is now present —
   * never trusted as identity, since a cheap clone card can present any UID
   * it likes. The card's real identity is the code WE write into its data
   * blocks (see `readCardIdentity`), which requires the MIFARE key to forge.
   */
  async getCardUid(type) {
    const link = this.rfidLinks[type]
    if (!link) return null
    try {
      const resp = await link.request(Buffer.from([0xFF, 0xCA, 0x00, 0x00, 0x00]), 300)
      if (!resp || !isPcscSuccess(resp) || resp.length <= 2) return null
      return resp.slice(0, -2).toString('hex')
    } catch {
      return null
    }
  }

  /**
   * Authenticate to the sector containing `blockNumber` with the factory
   * default key. Every card this system dispenses is unformatted stock, so
   * this is the only key ever needed. Throws (the safe outcome) for a card
   * that isn't ours — a foreign card, or one formatted with a different key.
   */
  async authenticateBlock(type, blockNumber) {
    const link = this.rfidLinks[type]
    const loadKey = await link.request(
      Buffer.from([0xFF, 0x82, 0x00, MIFARE_KEY_SLOT, MIFARE_DEFAULT_KEY.length, ...MIFARE_DEFAULT_KEY]), 300
    )
    if (!isPcscSuccess(loadKey)) throw new Error('Failed to load the authentication key')

    const auth = await link.request(
      Buffer.from([0xFF, 0x86, 0x00, 0x00, 0x05, 0x01, 0x00, blockNumber, MIFARE_KEY_TYPE_A, MIFARE_KEY_SLOT]), 300
    )
    if (!isPcscSuccess(auth)) {
      throw new Error(`Authentication failed for block ${blockNumber} — not one of our cards, or a different key`)
    }
  }

  /** Read data from RFID card sectors — skips sector trailers (keys/access bits, not card data). */
  async readRFIDSectors(type, maxBlocks = 10) {
    const link = this.rfidLinks[type]
    if (!link) throw new Error('No RFID reader connected')
    const blocks = []
    for (const blockNumber of dataBlockNumbers(maxBlocks)) {
      await this.authenticateBlock(type, blockNumber)
      const resp = await link.request(Buffer.from([0xFF, 0xB0, 0x00, blockNumber, MIFARE_BLOCK_SIZE]), 500)
      if (!resp || resp.length < MIFARE_BLOCK_SIZE) {
        throw new Error(`No data back for block ${blockNumber} after a successful authentication`)
      }
      // A READ BINARY reply conventionally carries a trailing 2-byte status
      // word, but not every reader/driver appends one over a plain
      // byte-stream transport — strip it only when the length implies one is
      // actually present.
      const hasStatusWord = resp.length === MIFARE_BLOCK_SIZE + 2
      if (hasStatusWord && !isPcscSuccess(resp)) {
        throw new Error(`RFID reader rejected the read of block ${blockNumber}`)
      }
      blocks.push(resp.slice(0, MIFARE_BLOCK_SIZE))
    }
    return Buffer.concat(blocks).toString('utf-8').replace(/\0/g, '')
  }

  /** Write data to RFID card sectors, one authenticated block at a time. */
  async writeRFIDSectors(type, dataString) {
    const link = this.rfidLinks[type]
    if (!link) throw new Error('No RFID reader connected')

    const dataBuffer = Buffer.from(dataString, 'utf-8')
    const blocks = []
    for (let i = 0; i < dataBuffer.length; i += MIFARE_BLOCK_SIZE) {
      const block = dataBuffer.slice(i, i + MIFARE_BLOCK_SIZE)
      blocks.push(Buffer.concat([block, Buffer.alloc(MIFARE_BLOCK_SIZE - block.length)]))
    }

    const targets = dataBlockNumbers(blocks.length)
    if (targets.length < blocks.length) {
      throw new Error(`Card data is ${dataBuffer.length} bytes and needs ${blocks.length} blocks, but only ${targets.length} usable data blocks are available`)
    }

    for (let i = 0; i < blocks.length; i++) {
      const blockNumber = targets[i]
      await this.authenticateBlock(type, blockNumber)
      const writeCommand = Buffer.concat([Buffer.from([0xFF, 0xD6, 0x00, blockNumber, MIFARE_BLOCK_SIZE]), blocks[i]])
      const resp = await link.request(writeCommand, 500)
      if (!isPcscSuccess(resp)) {
        throw new Error(`RFID reader rejected the write to block ${blockNumber}` + (resp ? ` (SW=${resp.slice(-2).toString('hex')})` : ' (no response)'))
      }
    }
    return blocks.length
  }

  /**
   * Read this card's identity as WE wrote it — the single source of truth
   * used everywhere a card needs recognising: explicit reads, write
   * verification, and every-day tap detection. Never guesses: a card that
   * fails authentication, or doesn't decode to our JSON shape, throws.
   */
  async readCardIdentity(type, maxBlocks = 10) {
    const dataString = await this.readRFIDSectors(type, maxBlocks)
    let identity
    try { identity = JSON.parse(dataString) }
    catch { throw new Error('Card data does not decode as a WashBubbles card') }
    if (!identity || typeof identity.code !== 'string' || !identity.code) {
      throw new Error('Card data has no usable code')
    }
    return identity
  }

  /**
   * Poll for card presence and surface taps as `rfid:card_detected`. Goes
   * through the same request queue as every other RFID command, so a poll
   * tick and an in-progress write/read (BuyCardModal) can never collide.
   */
  startRfidPolling(type) {
    let lastUid = null
    this.pollTimers[type] = setInterval(async () => {
      const uid = await this.getCardUid(type)
      if (uid === lastUid) return // no change: same card still present, or still absent
      lastUid = uid
      if (!uid) return // card removed

      try {
        const identity = await this.readCardIdentity(type)
        this.emit('rfid:card_detected', { cardCode: identity.code })
      } catch (err) {
        // Not one of our cards — blank, foreign, or a clone that can't pass
        // authentication. A UID-prefixed id can never collide with a real
        // generated code, so it flows through the existing "card not found"
        // path with no other change needed — nothing is auto-registered.
        console.warn(`[HW] Unrecognised card on ${type} (uid ${uid}): ${err.message}`)
        this.emit('rfid:card_detected', { cardCode: `UID:${uid}` })
      }
    }, RFID_POLL_INTERVAL_MS)
  }

  /** Write a card's data (called from BuyCardModal's write flow) and read it back to verify. */
  async writeCardData(cardData) {
    const type = 'rfid_reader'
    if (!this.rfidLinks[type]) throw new Error('RFID reader not available')

    const dataString = JSON.stringify({
      code: cardData.code || '', balance: cardData.balance || 0, name: cardData.name || '',
      email: cardData.email || '', phone: cardData.phone || '', contribuinte: cardData.contribuinte || ''
    })
    const written = await this.writeRFIDSectors(type, dataString)

    // Each block write was ACK'd, but that only proves the reader accepted
    // the command — not that the full concatenated JSON round-trips. This is
    // the last check before the customer is told their card is ready.
    let confirmed
    try { confirmed = await this.readCardIdentity(type) }
    catch (err) { throw new Error(`Card was written but does not read back correctly: ${err.message}`) }
    if (confirmed.code !== cardData.code) {
      throw new Error(`Card was written but reads back as a different code (wrote ${cardData.code}, read ${confirmed.code})`)
    }

    this.emit('card:written', { cardData, blocks: written })
    return { success: true, cardCode: cardData.code, blocksWritten: written }
  }

  /** Explicit on-demand read (distinct from the passive tap-detection poll). */
  async readCardData() {
    const type = 'rfid_reader'
    if (!this.rfidLinks[type]) throw new Error('RFID reader not available')
    const cardData = await this.readCardIdentity(type)
    return { success: true, cardData }
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

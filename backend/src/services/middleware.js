import EventEmitter from 'events'
import { SerialPort } from 'serialport'
import Peripheral from '../models/peripheral.js'
import Interface from '../models/interface.js'
import { CcTalkLink, CC_ADDR, CC_HEADER, ROUTE } from './ccTalk.js'
import { readKitsecFrame, parseStatusByte, kitsecFrame, KITSEC_CMD } from './kitsec.js'
import { roundMoney } from '../utils/money.js'

/** MIFARE Classic block size, in bytes. */
const MIFARE_BLOCK_SIZE = 16

/**
 * Data block numbers on a MIFARE Classic card, skipping sector trailers.
 *
 * Every 4th block (3, 7, 11, 15, …) is the sector trailer holding the access
 * keys and permission bits. The old code wrote to consecutive blocks starting at
 * 4, so as soon as the JSON payload exceeded 48 bytes — which it does the moment
 * a name or email is set — it overwrote block 7 with text. That destroys the
 * keys and the card becomes **permanently unreadable**.
 *
 * Block 0 is the read-only manufacturer block, so usable data starts at 1.
 */
function dataBlockNumbers(count, maxBlock = 63) {
  const blocks = []
  for (let b = 1; b <= maxBlock && blocks.length < count; b++) {
    if ((b + 1) % 4 === 0) continue // 3, 7, 11, … are sector trailers
    blocks.push(b)
  }
  return blocks
}

/**
 * Does this look like a serial device path on any platform we run on?
 *
 * Windows uses COM1..COMn (COM10+ needs the \\.\ prefix), Linux /dev/ttyUSB0,
 * /dev/ttyS0, /dev/ttyACM0, and macOS /dev/tty.usbserial-* or /dev/cu.*.
 */
function isSerialPath(address) {
  if (!address || typeof address !== 'string') return false
  const a = address.trim()
  return /^(\\\\\.\\)?COM\d+$/i.test(a) || a.startsWith('/dev/')
}

/** Safety ceiling on a single payout, unless the peripheral overrides it. */
const MAX_COINS_PER_DISPENSE = 50
const HOPPER_DISPENSE_TIMEOUT_MS = 30000
const HOPPER_POLL_INTERVAL_MS = 200
const HOPPER_LOW_STOCK_COINS = 20
const RECONNECT_BASE_MS = 2000
const RECONNECT_MAX_MS = 60000
const CREDIT_POLL_INTERVAL_MS = 300
const RFID_POLL_INTERVAL_MS = 500

/**
 * MIFARE Classic factory default key A. Every unformatted card ships with this
 * key on every sector, and it stays in effect until something else changes it.
 * Cards this system dispenses are unformatted stock, so this is the only key
 * ever used here.
 *
 * NOTE ON CONFIDENCE: the ccTalk work in this file was exercised over a real
 * PTY against a simulated device. This RFID section has not been — there is no
 * physical PC/SC reader in this environment to test against. The command bytes
 * below (Get UID, Load Key, General Authenticate, Read/Update Binary) are the
 * standard PC/SC Part 3 pseudo-APDU family that the reader/writer commands
 * already in this file (0xFF 0xB0 / 0xFF 0xD6) belong to, and are supported by
 * the large majority of USB CCID contactless readers (ACR122U, PN532-based
 * modules, etc.) — but they are NOT verified against whatever reader model this
 * project ends up buying. Confirm against its datasheet before relying on this
 * in production, the same way the coin-value and hopper-address settings need
 * confirming per device.
 */
const MIFARE_DEFAULT_KEY = Buffer.from('FFFFFFFFFFFF', 'hex')
const MIFARE_KEY_SLOT = 0x00
const MIFARE_KEY_TYPE_A = 0x60
/** ccTalk error codes that indicate a manipulation attempt rather than a bad coin. */
const FRAUD_CODES = new Set([2, 3, 4, 5, 6, 15, 16, 17])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Work out which hopper pays what, largest coin first.
 *
 * `unpayable` is the remainder that no configured hopper can make — e.g. €0.03
 * when the smallest hopper holds 5c coins. Reporting it is what stops the
 * customer being silently short-changed.
 */
function planPayout(amount, hoppers) {
  let remaining = roundMoney(amount)
  const steps = []

  for (const h of hoppers) {
    if (remaining < h.coinValue) continue
    const stock = Number(h.connection.peripheral.hopperConfig?.currentCount)
    const available = Number.isFinite(stock) && stock > 0 ? stock : Infinity
    const wanted = Math.floor(roundMoney(remaining) / h.coinValue + 1e-9)
    const count = Math.min(wanted, available)
    if (count <= 0) continue
    steps.push({ connection: h.connection, coinValue: h.coinValue, count })
    remaining = roundMoney(remaining - count * h.coinValue)
    if (remaining <= 0) break
  }

  return { steps, unpayable: Math.max(0, remaining) }
}

/** PC/SC-style readers answer with a two-byte status word; 0x9000 means OK. */
function isPcscSuccess(resp) {
  if (!resp || resp.length < 2) return false
  return resp[resp.length - 2] === 0x90 && resp[resp.length - 1] === 0x00
}

/**
 * Middleware service for communicating with peripherals via serial/other protocols
 * Handles coin acceptors, bill acceptors, card dispensers, hoppers, printers, RFID readers
 * Also manages machine control interfaces
 */
class Middleware extends EventEmitter {
  constructor() {
    super()
    this.connections = new Map() // peripheral._id -> connection instance
    this.interfaces = new Map()  // interface._id -> connection instance
    this.subscriptions = []
    this.reconnectTimers = new Map() // peripheral._id -> pending retry timer
    // Operator-configured maps of raw device credit codes to euro values.
    this.coinEqTable = null
    this.billEqTable = null
  }

  /**
   * Initialize connections to all enabled peripherals and active interfaces
   */
  async initialize() {
    try {
      // Must load before any acceptor starts polling — an unmapped code is
      // refused, so polling without the tables would reject real money.
      await this.loadEquivalenceTables()

      const peripherals = await Peripheral.find({ enabled: true })
      
      for (const peripheral of peripherals) {
        await this.connect(peripheral)
      }

      console.log(`Middleware initialized with ${this.connections.size} peripheral(s)`)

      // Load and connect interfaces (for machine control)
      const interfaces = await Interface.find({ status: 'active' })
      
      for (const iface of interfaces) {
        await this.connectInterface(iface)
      }

      console.log(`Connected to ${this.interfaces.size} interface(s)`)
    } catch (err) {
      console.error('Failed to initialize middleware:', err)
    }
  }

  /**
   * Connect to a specific peripheral
   */
  async connect(peripheral) {
    try {
      if (this.connections.has(peripheral._id.toString())) {
        console.log(`Peripheral ${peripheral.name} already connected`)
        return
      }

      // Skip if no address configured
      if (!peripheral.address && peripheral.protocol !== 'pulse') {
        console.log(`Skipping ${peripheral.name} - no address configured`)
        return
      }

      // Handle different connection types based on protocol
      switch (peripheral.protocol) {
        case 'rs232':
        case 'cctalk':
        case 'MDB':
          await this.connectSerial(peripheral)
          break
        case 'pulse':
          await this.connectPulse(peripheral)
          break
        case 'usb':
          await this.connectUSB(peripheral)
          break
        case 'ethernet':
          await this.connectEthernet(peripheral)
          break
        default:
          console.warn(`Unknown protocol ${peripheral.protocol} for ${peripheral.name}`)
      }
    } catch (err) {
      console.error(`Failed to connect to ${peripheral.name}:`, err.message)
      await this.updatePeripheralStatus(peripheral._id, 'fault')
    }
  }

  /**
   * Connect to serial peripheral (RS232, ccTalk, MDB)
   */
  async connectSerial(peripheral) {
    try {
      const baudRate = peripheral.baudRate ? parseInt(peripheral.baudRate) : 9600
      
      const port = new SerialPort({
        path: peripheral.address,
        baudRate: baudRate,
        autoOpen: false
      })

      port.on('open', () => {
        console.log(`Serial port opened: ${peripheral.name} at ${peripheral.address}`)
        this.updatePeripheralStatus(peripheral._id, 'ok')
      })

      port.on('data', (data) => {
        this.handleData(peripheral, data)
      })

      port.on('error', (err) => {
        console.error(`Serial port error for ${peripheral.name}:`, err)
        this.updatePeripheralStatus(peripheral._id, 'fault')
      })

      port.on('close', () => {
        console.log(`Serial port closed: ${peripheral.name}`)
        this.updatePeripheralStatus(peripheral._id, 'offline')
        // Remove the entry, otherwise `connect()` short-circuits on "already
        // connected" forever and a USB replug needs a full process restart —
        // meanwhile `send()` keeps writing into a dead port.
        const key = peripheral._id.toString()
        const existing = this.connections.get(key)
        if (existing && existing.link) existing.link.destroy('port closed')
        this.connections.delete(key)
        this.scheduleReconnect(peripheral)
      })

      await new Promise((resolve, reject) => {
        port.open((err) => {
          if (err) reject(err)
          else resolve()
        })
      })

      const connection = { port, peripheral }
      this.connections.set(peripheral._id.toString(), connection)

      // ccTalk devices are poll-driven and framed: attach the link and start
      // polling rather than reacting to raw `data` chunks.
      if (peripheral.protocol === 'cctalk') {
        const fallback = peripheral.type === 'bill_acceptor' ? CC_ADDR.BILL
          : peripheral.type === 'hopper' ? CC_ADDR.HOPPER
          : peripheral.type === 'card_dispenser' ? CC_ADDR.CARD_DISPENSER
          : CC_ADDR.COIN
        connection.link = this.getCcTalkLink(connection, fallback)
        if (peripheral.type === 'coin_acceptor' || peripheral.type === 'bill_acceptor') {
          this.startCreditPolling(connection)
        }
      } else if (peripheral.type === 'rfid_reader' && (peripheral.protocol === 'usb' || peripheral.protocol === 'rs232')) {
        // A PC/SC-style reader only speaks when asked, so detecting a tap means
        // actively polling for a UID rather than waiting on the port's data event.
        this.startRfidPolling(connection)
      }
    } catch (err) {
      throw new Error(`Serial connection failed: ${err.message}`)
    }
  }

  /**
   * Poll a ccTalk acceptor for buffered credit events.
   *
   * ccTalk is master-driven: the device does not push credits, the host asks for
   * them. The reply is an event counter plus a ring buffer of recent events, and
   * only the events between the last counter and the new one are new money. That
   * counter comparison is what makes a dropped or repeated poll safe — without it
   * a re-read of the same buffer credits the same coin twice.
   */
  startCreditPolling(connection) {
    const peripheral = connection.peripheral
    const isBill = peripheral.type === 'bill_acceptor'
    const header = isBill ? CC_HEADER.READ_BUFFERED_BILL : CC_HEADER.READ_BUFFERED_CREDIT

    let lastCounter = null
    const timer = setInterval(async () => {
      if (!this.connections.has(peripheral._id.toString())) {
        clearInterval(timer)
        return
      }
      try {
        const reply = await connection.link.request(header, [])
        if (!reply || reply.data.length < 1) return

        const counter = reply.data[0]
        if (lastCounter === null) { lastCounter = counter; return } // first poll: adopt, don't replay
        if (counter === lastCounter) return

        // Events are newest-first, paired as [credit code, error code].
        const newEvents = Math.min((counter - lastCounter + 256) % 256, Math.floor((reply.data.length - 1) / 2))
        for (let i = newEvents - 1; i >= 0; i--) {
          const code = reply.data[1 + i * 2]
          const errorCode = reply.data[2 + i * 2]
          if (code > 0) {
            if (isBill) {
              // Route the note to the stacker before crediting: an unrouted note
              // sits in escrow and can be pulled back out after the credit.
              try {
                await connection.link.request(CC_HEADER.ROUTE_BILL, [ROUTE.STACK])
              } catch (err) {
                console.error(`[HW] Failed to stack bill on ${peripheral.name}: ${err.message} — not crediting`)
                continue
              }
            }
            this.handleCcTalkCredit(peripheral, { code, isBill })
          } else if (errorCode) {
            const fraud = FRAUD_CODES.has(errorCode)
            this.emit(isBill ? 'bill-rejected' : 'coin-rejected', {
              peripheral, reason: `error ${errorCode}`, fraud,
            })
          }
        }
        lastCounter = counter
      } catch (err) {
        // A timeout here is normal if the device is briefly busy; only log.
        if (!/timeout/i.test(err.message)) {
          console.error(`[HW] Credit poll failed on ${peripheral.name}:`, err.message)
        }
      }
    }, CREDIT_POLL_INTERVAL_MS)

    if (timer.unref) timer.unref()
    connection.pollTimer = timer
  }

  /** Load the operator's coin/bill code → euro-value maps from settings. */
  async loadEquivalenceTables() {
    try {
      const Setting = (await import('../models/setting.js')).default
      const rows = await Setting.find({ key: { $in: ['coinEqTable', 'billEqTable'] } }).lean()
      const toMap = (val) => {
        const map = {}
        if (Array.isArray(val)) for (const e of val) map[String(e.key)] = Number(e.value)
        else if (val && typeof val === 'object') Object.assign(map, val)
        return map
      }
      for (const row of rows) {
        if (row.key === 'coinEqTable') this.coinEqTable = toMap(row.value)
        if (row.key === 'billEqTable') this.billEqTable = toMap(row.value)
      }
    } catch (err) {
      console.error('[HW] Failed to load coin/bill equivalence tables:', err.message)
    }
  }

  /**
   * Connect to pulse-based peripheral (card dispenser)
   */
  async connectPulse(peripheral) {
    // GPIO/pulse output is not implemented. Registering it as `ok` made a pulse
    // card dispenser look healthy on the dashboard while `dispenseCard` returned
    // {success:true} without a card ever leaving the stack — the customer was
    // charged and got nothing. Report the truth instead.
    return this.registerUnimplemented(peripheral, 'pulse')
  }

  /**
   * Connect to USB peripheral
   */
  async connectUSB(peripheral) {
    return this.registerUnimplemented(peripheral, 'usb')
  }

  /**
   * Connect to ethernet peripheral
   */
  async connectEthernet(peripheral) {
    return this.registerUnimplemented(peripheral, 'ethernet')
  }

  /**
   * Register a peripheral whose transport this build cannot drive.
   *
   * It is stored so the dashboard can list it, but flagged `unsupported` so any
   * attempt to use it throws rather than silently succeeding, and its status
   * shows `fault` rather than `ok`.
   */
  async registerUnimplemented(peripheral, transport) {
    console.warn(`[HW] ${transport} transport is not implemented — ${peripheral.name} will report a fault`)
    this.connections.set(peripheral._id.toString(), {
      type: transport,
      peripheral,
      unsupported: `The ${transport} transport is not implemented in this build`,
    })
    await this.updatePeripheralStatus(peripheral._id, 'fault')
  }

  /**
   * Retry a dropped peripheral with backoff.
   *
   * Without this a peripheral that unplugs (or whose USB adapter resets) stays
   * dead until someone restarts the server — on an unattended kiosk that is the
   * rest of the day's takings.
   */
  scheduleReconnect(peripheral, attempt = 1) {
    const key = peripheral._id.toString()
    if (this.reconnectTimers.has(key)) return

    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS)
    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(key)
      if (this.connections.has(key)) return // came back another way

      try {
        const fresh = await Peripheral.findById(peripheral._id)
        if (!fresh || !fresh.enabled) return // deliberately turned off
        await this.connect(fresh)
        if (this.connections.has(key)) {
          console.log(`[HW] Reconnected ${fresh.name} after ${attempt} attempt(s)`)
          this.emit('peripheral-reconnected', { peripheral: fresh })
          return
        }
      } catch (err) {
        console.warn(`[HW] Reconnect attempt ${attempt} for ${peripheral.name} failed:`, err.message)
      }
      this.scheduleReconnect(peripheral, attempt + 1)
    }, delay)

    if (timer.unref) timer.unref()
    this.reconnectTimers.set(key, timer)
  }

  /** Throw if this peripheral cannot actually be driven. */
  assertUsable(connection) {
    if (connection && connection.unsupported) {
      throw new Error(`${connection.peripheral.name}: ${connection.unsupported}`)
    }
  }

  /**
   * Connect to Interface hardware (for machine control)
   * Interfaces use serial (RS232) communication for sending commands AND receiving status updates
   */
  async connectInterface(iface) {
    try {
      if (this.interfaces.has(iface._id.toString())) {
        console.log(`Interface ${iface.name} already connected`)
        return
      }

      // Open serial connection if address is a COM port
      let serialPort = null
      // `startsWith('COM')` meant no port was ever opened on Linux or macOS
      // (/dev/ttyUSB0, /dev/tty.usbserial-*), yet the interface was still
      // registered `connected: true` and every activation became a silent no-op.
      // The production server is Linux, so this mattered immediately.
      if (isSerialPath(iface.address)) {
        try {
          serialPort = new SerialPort({
            path: iface.address,
            baudRate: 9600,
            dataBits: 8,
            parity: 'none',
            stopBits: 1
          })

          // Buffer for incoming data. Framing is driven by the length byte and
          // verified by checksum — scanning for the first 0x03 treated ordinary
          // payload values (port 3, or status 0x03 = a normally running machine)
          // as end-of-frame, truncating the frame and desynchronising the stream.
          let buffer = Buffer.alloc(0)

          serialPort.on('data', (data) => {
            buffer = Buffer.concat([buffer, data])
            for (;;) {
              const { frame, rest, resync } = readKitsecFrame(buffer)
              buffer = rest
              if (resync) continue
              if (!frame) break
              this.handleInterfaceFrame(iface, frame)
            }
            if (buffer.length > 512) buffer = buffer.slice(-64)
          })

          serialPort.on('error', (err) => {
            console.error(`Interface ${iface.name} serial error:`, err)
            this.emit('interface-error', { interface: iface, error: err.message })
          })

          console.log(`Interface ${iface.name} serial connected on ${iface.address}`)
        } catch (err) {
          console.warn(`Could not open serial port for Interface ${iface.name}:`, err.message)
        }
      }

      // Store interface connection
      this.interfaces.set(iface._id.toString(), {
        interface: iface,
        serialPort: serialPort,
        type: 'interface',
        connected: true
      })

      console.log(`Interface registered: ${iface.name} at address ${iface.address}`)
    } catch (err) {
      console.error(`Failed to register interface ${iface.name}:`, err)
    }
  }

  /**
   * Handle incoming data from Interface hardware
   * Status updates include: door closed/open, occupied, fault, machine running, etc.
   */
  /**
   * Handle one decoded interface frame.
   *
   * Takes an already-validated frame (length-delimited, checksum-checked) rather
   * than a raw byte slice, so a corrupted byte can no longer be reported as a
   * fault on the wrong port.
   */
  handleInterfaceFrame(iface, frame) {
    try {
      const { cmd, port, payload } = frame

      if (cmd === KITSEC_CMD.STATUS) {
        if (payload.length < 1) return
        const status = { port, ...parseStatusByte(payload[0]) }
        this.emit('machine-status-update', { interfaceId: iface._id, port, status })
        return
      }

      if (cmd === KITSEC_CMD.ERROR) {
        if (payload.length < 1) return
        const errorCode = payload[0]
        console.log(`Interface ${iface.name} Port ${port} error: ${errorCode}`)
        this.emit('machine-fault', { interfaceId: iface._id, port, errorCode })
      }
    } catch (err) {
      console.error('Error handling Interface frame:', err)
    }
  }

  /**
   * Handle incoming data from peripheral
   */
  handleData(peripheral, data) {
    // ccTalk devices are framed and go through CcTalkLink, which is attached at
    // connect time and consumes the port's data events itself. Anything reaching
    // here for those types is a device configured with a non-ccTalk protocol.
    switch (peripheral.type) {
      case 'coin_acceptor':
        this.handleCoinData(peripheral, data)
        break
      case 'bill_acceptor':
        this.handleBillData(peripheral, data)
        break
      case 'card_dispenser':
        this.handleCardData(peripheral, data)
        break
      // rfid_reader is deliberately absent: an authenticated PC/SC exchange
      // only ever speaks when it's polled, so every byte it sends is the reply
      // to a `requestOnPort` call already waiting for it (see `startRfidPolling`
      // / `readCardIdentity`). Dispatching it here as well — which the old
      // `handleRFIDData` did — meant a write's own ACK, or a read's own block
      // data, got reinterpreted as a spontaneous "card tapped" event on every
      // single command.
      case 'hopper':
        this.handleHopperData(peripheral, data)
        break
      case 'printer':
        this.handlePrinterData(peripheral, data)
        break
    }
  }

  /**
   * Handle coin acceptor data
   */
  handleCoinData(peripheral, data) {
    // Non-ccTalk (pulse/MDB) devices only: a single credit code per event.
    const coinValue = this.parseCoinValue(data)

    if (coinValue > 0) {
      this.emit('coin-inserted', { peripheral, value: coinValue })
      console.log(`Coin accepted: €${coinValue.toFixed(2)} from ${peripheral.name}`)
    } else if (data[0] !== 0) {
      // Coin was detected but not accepted. `reason`, not `signal`: coinMachine
      // destructures {reason, fraud}, so the old `signal` key meant the handler
      // always saw undefined and fraud alerts never fired.
      const reason = `code 0x${data[0].toString(16).toUpperCase()}`
      this.emit('coin-rejected', { peripheral, reason, signal: data[0] })
      console.log(`Coin rejected: ${reason} from ${peripheral.name}`)
    }
  }

  /**
   * Handle one framed ccTalk credit event from a coin or bill acceptor.
   *
   * This is where accepted money now arrives. Reading `data[0]` off a raw serial
   * chunk (what the old code did) credited ONE coin when two arrived in the same
   * chunk, and read a mid-frame byte as a credit code when a reply straddled two
   * chunks — 0x03 as €0.05, or in parseBillValue as €20.00 of free credit.
   */
  handleCcTalkCredit(peripheral, { code, isBill }) {
    const table = isBill ? this.billEqTable : this.coinEqTable
    // `code` off the wire is always a plain byte (1, 2, 3…), but the
    // equivalence table's keys are typed/stored as "0x01"-style hex strings
    // (see the admin UI's own placeholder text and "Carregar Padrões"
    // defaults) — table[String(code)] against those never matched, so no
    // coin/bill could ever actually be credited through this path. Accept
    // either form so both the documented "0x01" convention and a plain
    // decimal key work.
    const hexKey = `0x${Number(code).toString(16).padStart(2, '0')}`
    const rawKey = String(code)
    const value = table ? Number(table[hexKey] ?? table[rawKey]) : NaN

    if (!Number.isFinite(value) || value <= 0) {
      // An unmapped code is NOT money. Crediting a guess is how phantom notes
      // got accepted; refuse and make it visible so the operator maps it.
      console.warn(`[HW] ${peripheral.name}: unmapped ${isBill ? 'bill' : 'coin'} code ${code} — no credit given`)
      this.emit(isBill ? 'bill-rejected' : 'coin-rejected', {
        peripheral, reason: `unmapped code ${code}`, fraud: false, code,
      })
      return
    }

    const rounded = roundMoney(value)
    this.emit(isBill ? 'bill-inserted' : 'coin-inserted', { peripheral, value: rounded, code })
    console.log(`${isBill ? 'Bill' : 'Coin'} accepted: €${rounded.toFixed(2)} from ${peripheral.name}`)
  }

  /**
   * Handle bill acceptor data
   */
  handleBillData(peripheral, data) {
    const billValue = this.parseBillValue(data)
    
    if (billValue > 0) {
      this.emit('bill-inserted', { peripheral, value: billValue })
      console.log(`Bill accepted: €${billValue.toFixed(2)} from ${peripheral.name}`)
    } else if (data[0] !== 0) {
      // `reason`/`fraud` are the keys coinMachine actually destructures.
      const reason = `code 0x${data[0].toString(16).toUpperCase()}`
      this.emit('bill-rejected', { peripheral, reason, fraud: false, signal: data[0] })
      console.log(`Bill rejected: ${reason} from ${peripheral.name}`)
    }
  }

  /**
   * Handle card dispenser data
   */
  handleCardData(peripheral, data) {
    this.emit('card-dispensed', { peripheral, data })
    console.log(`Card dispensed from ${peripheral.name}`)
  }

  /**
   * Read the card's factory UID via the standard PC/SC "Get Data" command.
   *
   * The UID is used ONLY to detect that a (possibly different) card is now
   * present — it is never trusted as an identity. MIFARE UIDs are burned in by
   * the manufacturer, but cheap "magic"/CUID clone cards can present ANY UID
   * they like, so authorizing spend based on a raw UID would let someone clone
   * another customer's card. The card's actual identity is the code WE write
   * into its data blocks (see `readCardIdentity`), which requires knowing the
   * MIFARE key to overwrite — a UID clone alone cannot forge that.
   *
   * @returns hex UID string, or null if no card is present / the reader can't
   *          see one.
   */
  async getCardUid(connection) {
    if (!connection.port) return null
    try {
      const resp = await this.requestOnPort(connection, Buffer.from([0xFF, 0xCA, 0x00, 0x00, 0x00]), 300)
      if (!resp || !isPcscSuccess(resp) || resp.length <= 2) return null
      return resp.slice(0, -2).toString('hex')
    } catch (err) {
      return null
    }
  }

  /**
   * Authenticate to the sector containing `blockNumber` with the default key.
   *
   * MIFARE Classic gates every block behind a per-sector authentication; there
   * is no reading or writing without it. Skipping this step (which the earlier
   * version of this file did) means every read/write command was being sent to
   * a card that would simply refuse it — the write "succeeded" only because
   * nothing checked the status word.
   *
   * Failing here is the SAFE outcome for a card that isn't ours: a foreign card
   * formatted with a non-default key, or a chip that doesn't speak MIFARE
   * Classic at all, throws instead of silently reading zeros or writing into
   * whatever happened to be there.
   */
  async authenticateBlock(connection, blockNumber) {
    const loadKey = await this.requestOnPort(
      connection,
      Buffer.from([0xFF, 0x82, 0x00, MIFARE_KEY_SLOT, MIFARE_DEFAULT_KEY.length, ...MIFARE_DEFAULT_KEY]),
      300
    )
    if (!isPcscSuccess(loadKey)) throw new Error('Failed to load the authentication key')

    // General Authenticate: FF 86 00 00 05 <version=01> <blockMSB> <blockLSB> <keyType> <keySlot>
    const auth = await this.requestOnPort(
      connection,
      Buffer.from([0xFF, 0x86, 0x00, 0x00, 0x05, 0x01, 0x00, blockNumber, MIFARE_KEY_TYPE_A, MIFARE_KEY_SLOT]),
      300
    )
    if (!isPcscSuccess(auth)) {
      throw new Error(`Authentication failed for block ${blockNumber} — not one of our cards, or a different key`)
    }
  }

  /**
   * Read this card's identity as WE wrote it (see `writeCardData`), the single
   * source of truth used everywhere a card needs to be recognised: the explicit
   * read API, write verification, AND day-to-day tap detection.
   *
   * Never guesses. A card that fails authentication, or whose data blocks don't
   * decode to the JSON shape we write, throws — callers treat that as "not a
   * recognised card," never as a partial match.
   */
  async readCardIdentity(connection, maxBlocks = 10) {
    const dataString = await this.readRFIDSectors(connection, maxBlocks)
    let identity
    try {
      identity = JSON.parse(dataString)
    } catch (err) {
      throw new Error('Card data does not decode as a WashBubbles card')
    }
    if (!identity || typeof identity.code !== 'string' || !identity.code) {
      throw new Error('Card data has no usable code')
    }
    return identity
  }

  /**
   * Poll an RFID reader for card presence and surface taps as `card-read`.
   *
   * Replaces the old passive `port.on('data')` handler, which treated whatever
   * raw bytes happened to arrive as the card number — including the reply bytes
   * to our own read/write commands, since that listener never distinguished a
   * command's reply from an unsolicited event. A PC/SC reader only speaks when
   * spoken to, so detecting a tap means actively polling for a UID; everything
   * below goes through `requestOnPort`'s queue like any other command, so a
   * poll and a purchase-flow write can never be interpreted as each other.
   */
  startRfidPolling(connection) {
    const peripheral = connection.peripheral
    let lastUid = null

    const timer = setInterval(async () => {
      if (!this.connections.has(peripheral._id.toString())) {
        clearInterval(timer)
        return
      }

      const uid = await this.getCardUid(connection)
      if (uid === lastUid) return // no change: same card still present, or still absent

      lastUid = uid
      if (!uid) return // card was removed; nothing to report

      // A new card just landed. Try to read what WE wrote to it.
      try {
        const identity = await this.readCardIdentity(connection)
        this.emit('card-read', { peripheral, cardNumber: identity.code })
        console.log(`Card read: ${identity.code} from ${peripheral.name}`)
      } catch (err) {
        // Not one of our cards — a blank card, a foreign chip, or a clone with
        // no way to pass authentication. Report it under a UID-prefixed id that
        // can never collide with one of our own generated codes, so it flows
        // through the existing "card not found" rejection with no other change
        // needed: `client.setClientInfoByCard` looks it up, finds nothing, and
        // the caller is told the card is invalid. Nothing is auto-registered.
        console.warn(`[HW] Unrecognised card on ${peripheral.name} (uid ${uid}): ${err.message}`)
        this.emit('card-read', { peripheral, cardNumber: `UID:${uid}` })
      }
    }, RFID_POLL_INTERVAL_MS)

    if (timer.unref) timer.unref()
    connection.pollTimer = timer
  }

  /**
   * Write data to RFID card
   * Sends commands to RFID reader to write card data
   */
  async writeCardData(peripheralId, cardData) {
    const connection = this.connections.get(peripheralId.toString())
    
    if (!connection || connection.peripheral.type !== 'rfid_reader') {
      throw new Error('RFID reader not available')
    }

    const peripheral = connection.peripheral
    console.log(`Writing card data to ${peripheral.name}...`)

    // A write we cannot actually perform must fail loudly. This used to emit
    // `card-written` and return `{success:true}` even when there was no port and
    // nothing had been sent — so a €20 top-up was booked as written to a card
    // that held nothing.
    if (!connection.port) {
      throw new Error(`RFID reader ${peripheral.name} has no open port — cannot write card`)
    }

    // Card data format: code, balance, name, email, phone, contribuinte
    const dataString = JSON.stringify({
      code: cardData.code || '',
      balance: cardData.balance || 0,
      name: cardData.name || '',
      email: cardData.email || '',
      phone: cardData.phone || '',
      contribuinte: cardData.contribuinte || ''
    })

    const written = await this.writeRFIDSectors(connection, dataString)

    // Read it back. Each individual block write was ACK'd, but that only means
    // the reader accepted the command — it does not prove the full concatenated
    // JSON round-trips (a padding or block-count mismatch could still leave the
    // card unreadable). This is the last line of defence before the customer is
    // told their card is ready.
    let confirmed
    try {
      confirmed = await this.readCardIdentity(connection)
    } catch (err) {
      throw new Error(`Card was written but does not read back correctly: ${err.message}`)
    }
    if (confirmed.code !== cardData.code) {
      throw new Error(`Card was written but reads back as a different code (wrote ${cardData.code}, read ${confirmed.code})`)
    }

    this.emit('card-written', { peripheral, cardData, blocks: written })
    console.log(`Card data written and verified: ${cardData.code} (${written} block(s))`)

    return { success: true, cardCode: cardData.code, blocksWritten: written }
  }

  /**
   * Write data to RFID card sectors (for MIFARE cards)
   */
  async writeRFIDSectors(connection, dataString) {
    if (!connection.port) throw new Error('No serial port connection for RFID writer')

    // Split data into 16-byte blocks (MIFARE Classic block size)
    const dataBuffer = Buffer.from(dataString, 'utf-8')
    const blocks = []
    for (let i = 0; i < dataBuffer.length; i += MIFARE_BLOCK_SIZE) {
      const block = dataBuffer.slice(i, i + MIFARE_BLOCK_SIZE)
      blocks.push(Buffer.concat([block, Buffer.alloc(MIFARE_BLOCK_SIZE - block.length)]))
    }

    const targets = dataBlockNumbers(blocks.length)
    if (targets.length < blocks.length) {
      throw new Error(
        `Card data is ${dataBuffer.length} bytes and needs ${blocks.length} blocks, ` +
        `but only ${targets.length} usable data blocks are available`
      )
    }

    for (let i = 0; i < blocks.length; i++) {
      const blockNumber = targets[i]
      const writeCommand = Buffer.concat([
        Buffer.from([0xFF, 0xD6, 0x00, blockNumber, MIFARE_BLOCK_SIZE]), // Write block
        blocks[i]
      ])

      // Authenticate to this block's sector before touching it — MIFARE
      // Classic refuses every read and write until this succeeds, and the
      // earlier version of this file never did it at all.
      await this.authenticateBlock(connection, blockNumber)

      // One call writes and waits for that command's own reply. The ACK was
      // previously discarded entirely, so a NAK counted as success.
      const resp = await this.requestOnPort(connection, writeCommand, 500)
      if (!isPcscSuccess(resp)) {
        throw new Error(`RFID reader rejected the write to block ${blockNumber}` +
          (resp ? ` (SW=${resp.slice(-2).toString('hex')})` : ' (no response)'))
      }
    }

    return blocks.length
  }

  /**
   * Read card data from RFID reader
   * Reads all sectors and reconstructs card data
   */
  async readCardData(peripheralId) {
    const connection = this.connections.get(peripheralId.toString())
    
    if (!connection || connection.peripheral.type !== 'rfid_reader') {
      throw new Error('RFID reader not available')
    }

    const peripheral = connection.peripheral
    console.log(`Reading card data from ${peripheral.name}...`)
    
    try {
      // `readCardIdentity` is the same function the tap-detection poll uses —
      // one path for "what is on this card," so this route and a live tap can
      // never disagree about how to interpret the same bytes.
      const cardData = await this.readCardIdentity(connection)
      this.emit('card-data-read', { peripheral, cardData })
      console.log(`Card data read successfully: ${cardData.code}`)
      return { success: true, cardData }
    } catch (err) {
      console.error('Failed to read card data:', err)
      throw err
    }
  }

  /**
   * Read data from RFID card sectors
   */
  async readRFIDSectors(connection, maxBlocks = 10) {
    if (!connection.port) {
      throw new Error('No serial port connection for RFID reader')
    }

    const blocks = []
    
    // Read blocks from card
    // Read the same data blocks writeRFIDSectors uses — skipping sector
    // trailers, which are keys and access bits, not card data.
    for (const blockNumber of dataBlockNumbers(maxBlocks)) {
      await this.authenticateBlock(connection, blockNumber)
      const readCommand = Buffer.from([0xFF, 0xB0, 0x00, blockNumber, MIFARE_BLOCK_SIZE])
      const resp = await this.requestOnPort(connection, readCommand, 500)
      if (!resp || resp.length < MIFARE_BLOCK_SIZE) {
        throw new Error(`No data back for block ${blockNumber} after a successful authentication`)
      }
      // A PC/SC READ BINARY reply is conventionally the data followed by a
      // 2-byte status word, but not every reader/driver appends one over a
      // plain byte-stream transport — this has not been confirmed against a
      // real device. Strip a trailing status word only when the length implies
      // one is actually present; otherwise take the block as-is.
      const hasStatusWord = resp.length === MIFARE_BLOCK_SIZE + 2
      if (hasStatusWord && !isPcscSuccess(resp)) {
        throw new Error(`RFID reader rejected the read of block ${blockNumber}`)
      }
      blocks.push(resp.slice(0, MIFARE_BLOCK_SIZE))
    }

    // Concatenate all blocks and convert to string
    const dataBuffer = Buffer.concat(blocks)
    const dataString = dataBuffer.toString('utf-8').replace(/\0/g, '') // Remove null padding
    
    return dataString
  }

  /**
   * Handle hopper data
   */
  handleHopperData(peripheral, data) {
    this.emit('hopper-event', { peripheral, data })
  }

  /**
   * Handle printer data
   */
  handlePrinterData(peripheral, data) {
    this.emit('printer-event', { peripheral, data })
  }

  /**
   * Parse coin value from raw data
   * Maps hardware signals to euro coin denominations
   * Only accepts: 0.05€, 0.10€, 0.20€, 0.50€, 1.00€, 2.00€
   */
  parseCoinValue(data) {
    // Extract signal ID from data buffer
    const signal = data[0]
    
    // Accepted euro coin denominations only
    const acceptedEuroCoins = {
      0x03: 0.05,  // 5 cents
      0x04: 0.10,  // 10 cents
      0x05: 0.20,  // 20 cents
      0x06: 0.50,  // 50 cents
      0x07: 1.00,  // 1 euro
      0x08: 2.00,  // 2 euros
      // Alternative mapping for different acceptor models
      0x10: 0.05,
      0x20: 0.10,
      0x30: 0.20,
      0x40: 0.50,
      0x50: 1.00,
      0x60: 2.00
    }
    
    const value = acceptedEuroCoins[signal] || 0
    
    if (value === 0 && signal !== 0) {
      console.warn(`Coin rejected (not accepted denomination): 0x${signal.toString(16).toUpperCase()}`)
    }
    
    return value
  }

  /**
   * Parse bill value from raw data
   * Maps hardware signals to euro bill denominations
   * Only accepts: 5€, 10€, 20€
   */
  parseBillValue(data) {
    const signal = data[0]
    
    // Accepted euro bill denominations only
    const acceptedEuroBills = {
      0x01: 5.00,   // 5 euros
      0x02: 10.00,  // 10 euros
      0x03: 20.00,  // 20 euros
      // Alternative mapping for different acceptor models
      0x10: 5.00,
      0x20: 10.00,
      0x30: 20.00
    }
    
    const value = acceptedEuroBills[signal] || 0
    
    if (value === 0 && signal !== 0) {
      console.warn(`Bill rejected (not accepted denomination): 0x${signal.toString(16).toUpperCase()}`)
    }
    
    return value
  }

  /**
   * Send command to peripheral
   */
  async send(peripheralId, command) {
    const connection = this.connections.get(peripheralId.toString())
    
    if (!connection) {
      throw new Error(`Peripheral ${peripheralId} not connected`)
    }

    if (connection.port) {
      return new Promise((resolve, reject) => {
        connection.port.write(command, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
  }

  /**
   * Dispense card
   * Sends ccTalk or pulse command to card dispenser
   */
  async dispenseCard(peripheralId) {
    const connection = this.connections.get(peripheralId.toString())
    
    if (!connection || connection.peripheral.type !== 'card_dispenser') {
      throw new Error('Card dispenser not available')
    }

    const peripheral = connection.peripheral
    console.log(`Dispensing card from ${peripheral.name}...`)
    
    // A dispenser we cannot drive must throw, not quietly succeed: `pos.js`
    // books a CardPurchase with `dispenserUsed: true` off the back of this, so
    // reporting success meant the customer paid for a card they never received.
    this.assertUsable(connection)

    if (peripheral.protocol === 'cctalk') {
      await this.sendCardDispenserCCTalkCommand(connection)
    } else if (peripheral.protocol === 'pulse') {
      await this.sendCardDispenserPulseCommand(connection)
    } else {
      if (!connection.port) {
        throw new Error(`Card dispenser ${peripheral.name} has no open port`)
      }
      await this.send(peripheralId, Buffer.from([0xFF])) // Trigger signal
    }

    this.emit('card-dispensed', { peripheral: connection.peripheral })
    return { success: true }
  }

  /**
   * Send ccTalk command to card dispenser
   */
  async sendCardDispenserCCTalkCommand(connection) {
    if (!connection.port) return
    
    const address = parseInt(connection.peripheral.address) || 4
    const command = 192 // Dispense card command (0xC0)
    const source = 1
    const dataBytes = [0x01] // Dispense 1 card
    const length = dataBytes.length + 2
    
    const packet = [address, length, source, command, ...dataBytes]
    const sum = packet.reduce((acc, byte) => acc + byte, 0)
    const checksum = (256 - (sum % 256)) & 0xFF
    packet.push(checksum)
    
    console.log(`Card dispenser command:`, packet.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '))
    
    const reply = await this.requestOnPort(connection, Buffer.from(packet), 1000)
    // The reply used to be discarded, so a silent or refusing dispenser still
    // reported a card as delivered. A ccTalk ACK is a zero-data reply.
    if (!reply) throw new Error('Card dispenser did not respond to the dispense command')
    if (reply.length >= 4 && reply[1] !== 0x00) {
      throw new Error(`Card dispenser refused the dispense command (reply header 0x${reply[3].toString(16)})`)
    }
  }

  /**
   * Send pulse command to card dispenser
   */
  async sendCardDispenserPulseCommand(connection) {
    // Guard first: the pulse transport is a stub, and returning quietly here is
    // what let dispenseCard report a card as delivered.
    this.assertUsable(connection)
    if (!connection.port) {
      throw new Error(`Card dispenser ${connection.peripheral.name} has no open port`)
    }

    // Simple pulse: HIGH for 200ms, then LOW
    const highSignal = Buffer.from([0xFF])
    const lowSignal = Buffer.from([0x00])
    
    connection.port.write(highSignal)
    await new Promise(resolve => setTimeout(resolve, 200))
    connection.port.write(lowSignal)
  }

  /**
   * Generic response wait helper
   */
  /**
   * Write a command to a peripheral's port and wait for THAT command's reply.
   *
   * Replaces the old `waitForResponse`, which registered a bare `once('data')`
   * per caller against a shared port. Two concurrent callers each got their own
   * listener, so a single inbound chunk resolved both promises — command A's ACK
   * was read as command B's reply. In `readRFIDSectors` a late block-N reply
   * satisfied the wait for block N−1, shifting the balance data by one block.
   *
   * Every command on a port now goes through a single queue, so exactly one
   * request is in flight at a time and a reply can only belong to it.
   */
  requestOnPort(connection, command, timeout = 500) {
    if (!connection || !connection.port) {
      return Promise.reject(new Error('Peripheral has no open port'))
    }

    // One queue per connection, created lazily.
    if (!connection.queue) connection.queue = Promise.resolve()

    const run = () => new Promise((resolve, reject) => {
      const port = connection.port
      let settled = false

      const cleanup = () => {
        clearTimeout(timer)
        port.removeListener('data', onData)
      }
      const onData = (data) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(data)
      }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        // Resolve null rather than throw: callers decide whether a silent device
        // is fatal. They MUST check — a null here used to be treated as success.
        resolve(null)
      }, timeout)

      port.on('data', onData)
      port.write(command, (err) => {
        if (err && !settled) {
          settled = true
          cleanup()
          reject(err)
        }
      })
    })

    // Chain onto the queue so commands never overlap on the same port.
    const result = connection.queue.then(run, run)
    connection.queue = result.then(() => {}, () => {})
    return result
  }

  /**
   * Calculate coin breakdown for change dispensing
   * Returns array of coins to dispense for exact change
   */
  calculateCoinBreakdown(amount, availableCoins = [2.00, 1.00, 0.50, 0.20, 0.10, 0.05]) {
    const result = []
    let remaining = Math.round(amount * 100) / 100 // Round to 2 decimals
    
    // Sort coins descending (largest first)
    const sortedCoins = [...availableCoins].sort((a, b) => b - a)
    
    for (const coin of sortedCoins) {
      const count = Math.floor((remaining / coin) + 0.001) // Add small epsilon for floating point
      if (count > 0) {
        result.push({ denomination: coin, count })
        remaining = Math.round((remaining - (coin * count)) * 100) / 100
      }
    }
    
    // Check if we have exact change
    if (remaining > 0.001) {
      throw new Error(`Cannot provide exact change for €${amount.toFixed(2)}. Remaining: €${remaining.toFixed(2)}`)
    }
    
    return result
  }

  /**
   * Dispense change via hopper
   * Calculates optimal coin breakdown and sends ccTalk commands to hopper
   */
  /**
   * Pay out `amount` in coins.
   *
   * A ccTalk hopper holds ONE denomination and its dispense command carries only
   * a coin count, so multi-denomination change needs one hopper per coin. All of
   * the tenant's enabled hoppers are used together, largest coin first.
   *
   * `peripheralId` selects a starting hopper for compatibility with existing
   * callers; every other enabled hopper is used as well when needed.
   *
   * Never throws for a hardware failure — it returns what was actually paid, so
   * the caller can tell the customer the truth. The old version reported
   * `{success:true}` on a jam and left the shortfall invisible.
   */
  async dispenseChange(peripheralId, amount) {
    const target = roundMoney(amount)
    if (!(target > 0)) return { success: true, dispensed: 0, remaining: 0, breakdown: [] }

    const hoppers = this.getHoppersFor(peripheralId)
    if (hoppers.length === 0) {
      return { success: false, error: 'No hopper connected', dispensed: 0, remaining: target, breakdown: [] }
    }

    const plan = planPayout(target, hoppers)
    const breakdown = []
    let dispensed = 0

    for (const step of plan.steps) {
      try {
        const paid = await this.dispenseFromHopper(step.connection, step.count)
        const value = roundMoney(paid * step.coinValue)
        dispensed = roundMoney(dispensed + value)
        breakdown.push({ denomination: step.coinValue, requested: step.count, dispensed: paid, value })

        if (paid < step.count) {
          console.error(`[HW] Hopper ${step.connection.peripheral.name} paid ${paid}/${step.count} coins`)
          break // stop: it is empty or jammed, do not keep trying
        }
      } catch (err) {
        console.error(`[HW] Hopper ${step.connection.peripheral.name} failed:`, err.message)
        breakdown.push({ denomination: step.coinValue, requested: step.count, dispensed: 0, error: err.message })
        break
      }
    }

    const remaining = roundMoney(target - dispensed)
    const success = remaining <= 0 && plan.unpayable <= 0

    if (success) {
      this.emit('change-dispensed', { amount: dispensed, breakdown })
    } else {
      // Surfacing this is the whole point — the customer is owed money.
      this.emit('change-shortfall', { requested: target, dispensed, remaining, breakdown })
      console.error(`[HW] Change shortfall: asked €${target.toFixed(2)}, paid €${dispensed.toFixed(2)}`)
    }

    return {
      success,
      dispensed,
      remaining: Math.max(0, remaining),
      breakdown,
      error: success ? undefined : (plan.unpayable > 0
        ? `Cannot make €${target.toFixed(2)} from the available coins`
        : 'Hopper did not dispense the full amount'),
    }
  }

  /** Enabled, connected hoppers with a configured coin value, largest coin first. */
  getHoppersFor(preferredId) {
    const hoppers = []
    for (const [id, conn] of this.connections) {
      if (!conn.peripheral || conn.peripheral.type !== 'hopper') continue
      if (conn.peripheral.enabled === false) continue
      const coinValue = Number(conn.peripheral.hopperConfig?.coinValue)
      if (!(coinValue > 0)) {
        console.warn(`[HW] Hopper ${conn.peripheral.name} has no coinValue configured — skipping`)
        continue
      }
      hoppers.push({ id, connection: conn, coinValue, preferred: id === String(preferredId) })
    }
    return hoppers.sort((a, b) => b.coinValue - a.coinValue)
  }

  /**
   * Dispense `count` coins from one hopper and confirm how many actually fell.
   *
   * Enables the hopper, issues the dispense, then polls status until it reports
   * idle and reads back the paid count. The old code fired the command, ignored
   * a null timeout reply, and reported success regardless.
   */
  async dispenseFromHopper(connection, count) {
    const peripheral = connection.peripheral
    const link = this.getCcTalkLink(connection, CC_ADDR.HOPPER)

    const ceiling = Number(peripheral.hopperConfig?.maxDispenseCoins) || MAX_COINS_PER_DISPENSE
    if (count > ceiling) {
      throw new Error(`Refusing to dispense ${count} coins — above the ${ceiling}-coin safety ceiling`)
    }

    await link.request(CC_HEADER.ENABLE_HOPPER, [0xA5])
    await link.request(CC_HEADER.DISPENSE_HOPPER, [count & 0xFF])

    // Poll until the hopper stops paying out. A hopper reports the number of
    // coins remaining to pay; zero means it finished.
    const deadline = Date.now() + HOPPER_DISPENSE_TIMEOUT_MS
    let remainingToPay = count
    while (Date.now() < deadline) {
      await sleep(HOPPER_POLL_INTERVAL_MS)
      const status = await link.request(CC_HEADER.HOPPER_STATUS, [])
      // Reply data: [eventCounter, remaining, paid, unpaid] on the common devices.
      if (status.data.length >= 2) {
        remainingToPay = status.data[1]
        if (remainingToPay === 0) {
          const paid = status.data.length >= 3 ? status.data[2] : count
          await this.decrementHopperStock(peripheral, paid)
          return Math.min(paid, count)
        }
      }
    }

    // Timed out mid-payout: report what the device last said it still owed,
    // rather than assuming the whole request succeeded.
    const paid = Math.max(0, count - remainingToPay)
    await this.decrementHopperStock(peripheral, paid)
    throw new Error(`Hopper timed out after paying ${paid}/${count} coins`)
  }

  /** Keep the stock count honest so the dashboard can warn before it runs dry. */
  async decrementHopperStock(peripheral, coins) {
    if (!coins) return
    try {
      await Peripheral.updateOne(
        { _id: peripheral._id },
        { $inc: { 'hopperConfig.currentCount': -coins } }
      )
      const left = (peripheral.hopperConfig?.currentCount || 0) - coins
      if (left <= HOPPER_LOW_STOCK_COINS) {
        this.emit('hopper-low', { peripheral, remaining: Math.max(0, left) })
      }
    } catch (err) {
      console.error('[HW] Failed to update hopper stock:', err.message)
    }
  }

  /** Lazily create (and cache) the framed ccTalk link for a connection. */
  getCcTalkLink(connection, fallbackAddress) {
    if (connection.link) return connection.link
    if (!connection.port) throw new Error(`${connection.peripheral.name} has no open port`)
    const address = Number(connection.peripheral.deviceAddress) || fallbackAddress
    connection.link = new CcTalkLink(connection.port, address)
    return connection.link
  }

  async print(peripheralId, content) {
    const connection = this.connections.get(peripheralId.toString())
    
    if (!connection || connection.peripheral.type !== 'printer') {
      throw new Error('Printer not available')
    }

    console.log('Printing receipt...')
    
    // Build ESC/POS commands for thermal printer
    const commands = []
    
    // Initialize printer
    commands.push(Buffer.from([0x1B, 0x40])) // ESC @ - Initialize
    
    // Set alignment center
    commands.push(Buffer.from([0x1B, 0x61, 0x01])) // ESC a 1 - Center align
    
    // Print content (split by lines)
    const lines = content.split('\n')
    for (const line of lines) {
      if (line.startsWith('**')) {
        // Bold text
        commands.push(Buffer.from([0x1B, 0x45, 0x01])) // ESC E 1 - Bold on
        commands.push(Buffer.from(line.replace(/\*\*/g, ''), 'utf-8'))
        commands.push(Buffer.from([0x1B, 0x45, 0x00])) // ESC E 0 - Bold off
      } else if (line.startsWith('--')) {
        // Separator line
        commands.push(Buffer.from('--------------------------------\n', 'utf-8'))
      } else {
        commands.push(Buffer.from(line, 'utf-8'))
      }
      commands.push(Buffer.from('\n', 'utf-8'))
    }
    
    // Feed and cut
    commands.push(Buffer.from([0x1B, 0x64, 0x03])) // ESC d 3 - Feed 3 lines
    commands.push(Buffer.from([0x1D, 0x56, 0x00])) // GS V 0 - Cut paper
    
    // The whole write loop used to be wrapped in `if (connection.port)`, with
    // `receipt-printed` and {success:true} emitted regardless — so a printer that
    // was unplugged, unsupported, or out of paper reported a printed receipt.
    this.assertUsable(connection)
    if (!connection.port) {
      throw new Error(`Printer ${connection.peripheral.name} has no open port`)
    }

    for (const cmd of commands) {
      await this.send(peripheralId, cmd)
      await new Promise(resolve => setTimeout(resolve, 10)) // Small delay between commands
    }
    await new Promise((resolve, reject) => {
      connection.port.drain((err) => (err ? reject(err) : resolve()))
    })

    this.emit('receipt-printed', { peripheral: connection.peripheral })
    return { success: true }
  }

  /**
   * Update peripheral status in database
   */
  async updatePeripheralStatus(peripheralId, status) {
    try {
      await Peripheral.findByIdAndUpdate(peripheralId, { status })
    } catch (err) {
      console.error('Failed to update peripheral status:', err)
    }
  }

  /**
   * Disconnect from peripheral
   */
  async disconnect(peripheralId) {
    const key = peripheralId.toString()
    const connection = this.connections.get(key)

    // Stop the retry loop first, or it races the shutdown and reopens the port.
    const retry = this.reconnectTimers.get(key)
    if (retry) { clearTimeout(retry); this.reconnectTimers.delete(key) }

    if (connection) {
      if (connection.pollTimer) clearInterval(connection.pollTimer)
      if (connection.link) connection.link.destroy('peripheral disconnected')
      if (connection.port && connection.port.isOpen) {
        await new Promise((resolve) => connection.port.close(() => resolve()))
      }
    }

    this.connections.delete(key)
  }

  /**
   * Disconnect all peripherals
   */
  async disconnectAll() {
    for (const id of [...this.connections.keys()]) {
      await this.disconnect(id)
    }

    // Interfaces were never iterated here, so their serial ports stayed open
    // across a shutdown and the next start hit a busy port.
    for (const [id, conn] of [...this.interfaces.entries()]) {
      try {
        if (conn.serialPort && conn.serialPort.isOpen) {
          await new Promise((resolve) => conn.serialPort.close(() => resolve()))
        }
      } catch (err) {
        console.error(`[HW] Error closing interface ${id}:`, err.message)
      }
      this.interfaces.delete(id)
    }

    for (const timer of this.reconnectTimers.values()) clearTimeout(timer)
    this.reconnectTimers.clear()
  }

  /**
   * Subscribe to middleware events
   */
  subscribe(event, callback) {
    this.on(event, callback)
    const sub = { unsubscribe: () => this.off(event, callback) }
    this.subscriptions.push(sub)
    return sub
  }

  /**
   * Get package stream (for compatibility with old coin-machine API)
   */
  getPkg() {
    return {
      subscribe: (cb) => {
        const handler = (data) => cb(data)
        this.on('package', handler)
        return { unsubscribe: () => this.off('package', handler) }
      }
    }
  }

  /**
   * Activate a machine (send command to low-level device)
   * Based on old code: { op: 'activate-machine', data: [{id, chn, impulses}] }
   */
  async activateMachine(machineData) {
    const pkg = {
      op: 'activate-machine',
      data: Array.isArray(machineData) ? machineData : [machineData]
    }

    // Send through websocket if available
    this.send(pkg)
    
    // Also emit local event
    this.emit('machine-activated', pkg.data)
    
    console.log('Machine activation command sent:', JSON.stringify(pkg.data))
    return true
  }

  /**
   * Send machine activation pulse through Interface hardware
   * Uses interface address, port, tOn/tOff timing for pulse control
   */
  async sendMachineActivation(machine, iface) {
    if (!iface) {
      throw new Error('Interface not configured for this machine')
    }

    const { address, tOn, tOff } = iface
    const { port, activation, impulses } = machine

    console.log(`Activating machine via Interface: addr=${address}, port=${port}, impulses=${impulses || '1'}, tOn=${tOn}ms, tOff=${tOff}ms, level=${activation}`)

    // Build activation command based on your Interface protocol
    // This is a generic example - adjust to your specific hardware protocol
    const command = {
      address: address,
      port: port,
      impulses: parseInt(impulses) || 1,
      tOn: tOn,
      tOff: tOff,
      activation: activation || 'high'
    }

    // Format: [STX][ADDR][PORT][IMPULSES][T_ON_H][T_ON_L][T_OFF_H][T_OFF_L][LEVEL][ETX][CHK]
    const buffer = this.buildInterfaceCommand(command)

    // ACTUALLY WRITE IT. The old version built this buffer, logged
    // "Activation pulse sent", and returned — without ever touching the serial
    // port. `coinMachine` then marked the machine `working` and saved: the
    // customer paid, credits were deducted, the UI showed a running machine, and
    // the washer never started.
    const conn = this.interfaces.get(iface._id.toString())
    if (!conn || !conn.serialPort || !conn.serialPort.isOpen) {
      throw new Error(`Interface ${iface.name} is not connected — cannot activate machine ${machine.name || machine._id}`)
    }

    await new Promise((resolve, reject) => {
      conn.serialPort.write(buffer, (err) => (err ? reject(err) : resolve()))
    })
    await new Promise((resolve, reject) => {
      conn.serialPort.drain((err) => (err ? reject(err) : resolve()))
    })

    this.emit('interface-activation', { machine: machine._id, interface: iface._id, command })
    console.log(`Activation pulse written to Interface addr=${address}, port=${port} (${buffer.length} bytes)`)
    return buffer
  }

  /**
   * Build interface activation command buffer
   * Protocol-specific implementation for KITSEC or similar interface
   */
  buildInterfaceCommand(cmd) {
    // Example protocol format (adjust to your actual interface protocol):
    // STX (0x02) + Address + Port + Impulses + tOn_High + tOn_Low + tOff_High + tOff_Low + Level + ETX (0x03) + Checksum
    
    const STX = 0x02
    const ETX = 0x03

    // Every field must be coerced to a number. `cmd.address` arrives as the
    // interface's address which may be a string, and `Buffer.from` turns a
    // non-numeric string into 0 — silently addressing device 0. Undefined
    // tOn/tOff became 0 the same way, producing a zero-length pulse that no
    // machine responds to.
    const toByte = (v, fallback = 0) => {
      const n = Number(v)
      return Number.isFinite(n) ? (n & 0xFF) : fallback
    }
    const toU16 = (v, fallback) => {
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? Math.min(n, 0xFFFF) : fallback
    }

    const tOn = toU16(cmd.tOn, 100)
    const tOff = toU16(cmd.tOff, 100)

    // Little-endian, as the comment always claimed: low byte first. The code
    // wrote the high byte first, so a 250ms pulse went out as 64000ms.
    const tOnLow = tOn & 0xFF
    const tOnHigh = (tOn >> 8) & 0xFF
    const tOffLow = tOff & 0xFF
    const tOffHigh = (tOff >> 8) & 0xFF

    const level = cmd.activation === 'high' ? 0x01 : 0x00

    const buffer = Buffer.from([
      STX,
      toByte(cmd.address),
      toByte(cmd.port),
      toByte(cmd.impulses, 1) || 1,
      tOnLow,
      tOnHigh,
      tOffLow,
      tOffHigh,
      level,
      ETX
    ])
    
    // Calculate checksum (XOR of all bytes except STX and checksum itself)
    let checksum = 0
    for (let i = 1; i < buffer.length; i++) {
      checksum ^= buffer[i]
    }
    
    // Append checksum
    return Buffer.concat([buffer, Buffer.from([checksum])])
  }

  /**
   * Send package to connected clients/low-level device
   * Wraps payload with framing for low-level: { cl: length, c: payload }
   */
  /**
   * Wrap a package in the legacy JSON frame and emit it to websocket clients.
   *
   * Renamed from `send`: it was the SECOND method of that name in this class, so
   * it silently replaced the serial `send(peripheralId, command)` above. Every
   * caller expecting to write bytes to a port — `dispenseCard`'s generic branch
   * and every `print()` — hit this instead and wrote nothing to any device,
   * while still reporting success.
   */
  sendPackage(pkg) {
    // Calculate frame length (same logic as old middleware)
    const dataStr = JSON.stringify(pkg)
    const dataLength = dataStr.length
    const pkgLength = dataLength + dataLength.toString().length + 14
    
    const newPkg = {
      cl: pkgLength.toString(),
      c: pkg
    }

    // Emit to connected clients via websocket
    this.emit('send', newPkg)
    
    // If we have a TCP connection to low-level device, write to it
    // (This would require extending Middleware to support TCP connections)
    
    console.log('Package sent:', JSON.stringify(newPkg))
  }

  /**
   * Handle incoming package from low-level device or websocket
   * Processes machine-related events
   */
  handlePackage(pkg) {
    if (!pkg || !pkg.op) return

    this.emit('package', pkg)

    switch (pkg.op) {
      case 'machine-started':
        this.emit('machine-started', pkg.data)
        break
      case 'machine-reserved':
        this.emit('machine-reserved', pkg.data)
        break
      case 'machine-res-canceled':
        this.emit('machine-res-canceled', pkg.data)
        break
      case 'machine-issue':
        this.emit('machine-issue', pkg.data)
        break
      case 'status_int':
        this.emit('status_int', pkg.data)
        break
      case 'remote-credits':
        this.emit('remote-credits', pkg.data)
        break
      case 'card-removed':
        this.emit('card-removed', pkg.data)
        break
      default:
        console.log('Unhandled package:', pkg.op)
    }
  }
}

// Create singleton instance
const middleware = new Middleware()

// Exported for tests that need an isolated instance (pure protocol logic, no
// DB or real hardware involved) rather than the shared singleton.
export { Middleware }
export default middleware

/**
 * Hardware Agent - Runs locally on POS machine
 *
 * This service runs on the POS machine and handles all physical hardware communication:
 * - Coin acceptor (serial, ccTalk)
 * - Bill acceptor (serial, ccTalk)
 * - Interface/Machines (serial - INT 6 KITSEC)
 * - Hopper (serial - ccTalk)
 * - Card dispenser (serial - ccTalk/pulse)
 * - Printer (serial - ESC/POS)
 * - RFID reader (serial)
 *
 * Communicates with remote backend server via WebSocket:
 * - Receives commands from server (dispense coins, activate machine, print receipt, etc.)
 * - Sends events to server (coin inserted, card detected, machine status, etc.)
 *
 * Coin/bill/hopper wire protocol mirrors pos-client/electron/hardware-agent.cjs's
 * ccTalk implementation — see that file's header comment for the reasoning
 * (real ccTalk is poll-based; a device never pushes data unsolicited).
 */

import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'
import { WebSocket } from 'ws'
import EventEmitter from 'events'

// ─── ccTalk framing (see https://cctalk.org — Part 1, section 4) ───────────
const CC_HOST = 1
const CC_HEADER = {
  SIMPLE_POLL: 0xFE,
  READ_BUFFERED_CREDIT: 0x9F,
  ROUTE_BILL: 0x9A,
  ENABLE_HOPPER: 0xA4,
  HOPPER_STATUS: 0xA6,
  DISPENSE_HOPPER: 0xA7,
  DISPENSE_CARD: 0xC0,
}
const ROUTE = { RETURN: 0x00, STACK: 0x01 }

function ccChecksum(bytes) {
  return (256 - (bytes.reduce((a, b) => a + b, 0) & 0xFF)) & 0xFF
}
function ccFrame(dest, src, header, data = []) {
  const head = [dest, data.length, src, header, ...data]
  return Buffer.from([...head, ccChecksum(head)])
}
function readCcFrame(buf) {
  if (buf.length < 5) return null
  const len = buf[1]
  const total = len + 5
  if (buf.length < total) return null
  return { dest: buf[0], len, src: buf[2], header: buf[3], data: buf.slice(4, 4 + len), total }
}

/** Minimal ccTalk master: one request in flight at a time. */
class CcTalkLink {
  constructor(serialPort, address) {
    this.serialPort = serialPort
    this.address = address
    this.buffer = Buffer.alloc(0)
    this.waiter = null
    serialPort.on('data', (chunk) => this._onData(chunk))
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
      this.serialPort.write(ccFrame(this.address, CC_HOST, header, data))
    })
  }
}

class HardwareAgent extends EventEmitter {
  constructor(config) {
    super()
    this.config = {
      serverUrl: config.serverUrl || 'ws://localhost:3000',
      apiKey: config.apiKey || process.env.HARDWARE_AGENT_API_KEY,
      reconnectInterval: config.reconnectInterval || 5000,
      peripherals: config.peripherals || {},
    }

    this.ws = null
    this.wsConnected = false
    this.peripherals = new Map() // port -> { type, serialPort, parser, config, link? }
    this.pollTimers = new Map()  // port -> interval handle
    this.machineInterfaces = new Map() // interfaceId -> { serialPort, config }
    this.reconnectTimer = null
  }

  async start() {
    console.log('[HardwareAgent] Starting...')
    await this.initializePeripherals()
    this.connectToServer()
    console.log('[HardwareAgent] Started successfully')
  }

  async initializePeripherals() {
    console.log('[HardwareAgent] Initializing peripherals...')
    for (const [port, config] of Object.entries(this.config.peripherals)) {
      try {
        await this.connectPeripheral(port, config)
      } catch (err) {
        console.error(`[HardwareAgent] Failed to connect peripheral on ${port}:`, err.message)
      }
    }
  }

  async connectPeripheral(port, config) {
    const { type, baudRate = 9600, dataBits = 8, stopBits = 1, parity = 'none' } = config

    console.log(`[HardwareAgent] Connecting ${type} on ${port}...`)

    const serialPort = new SerialPort({
      path: port,
      baudRate,
      dataBits,
      stopBits,
      parity,
      autoOpen: false,
    })

    await new Promise((resolve, reject) => {
      serialPort.open((err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    const peripheral = { type, serialPort, config }

    switch (type) {
      case 'coin_acceptor':
      case 'bill_acceptor': {
        const address = config.address || 40
        peripheral.link = new CcTalkLink(serialPort, address)
        this.peripherals.set(port, peripheral)
        this.startBillPolling(port)
        break
      }
      case 'interface':
        this.setupInterfaceHandler(peripheral)
        this.peripherals.set(port, peripheral)
        break
      case 'hopper': {
        const address = config.address || 3
        peripheral.link = new CcTalkLink(serialPort, address)
        this.peripherals.set(port, peripheral)
        break
      }
      case 'card_dispenser':
        if (config.protocol === 'cctalk') {
          peripheral.link = new CcTalkLink(serialPort, config.address || 4)
        }
        this.peripherals.set(port, peripheral)
        break
      case 'printer':
        this.setupPrinterHandler(peripheral)
        this.peripherals.set(port, peripheral)
        break
      case 'rfid_reader': {
        const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }))
        parser.on('data', (data) => this.handleRfidData(port, data))
        peripheral.parser = parser
        this.peripherals.set(port, peripheral)
        break
      }
      default:
        console.warn(`[HardwareAgent] Unknown peripheral type: ${type}`)
        this.peripherals.set(port, peripheral)
    }

    console.log(`[HardwareAgent] ${type} connected on ${port}`)
  }

  /** Standard ccTalk host loop: the device never pushes data unsolicited, so
   *  the host must poll for buffered credit events. */
  startBillPolling(port) {
    const peripheral = this.peripherals.get(port)
    const intervalMs = 300
    const timer = setInterval(async () => {
      try {
        const frame = await peripheral.link.request(CC_HEADER.READ_BUFFERED_CREDIT)
        for (let i = 0; i + 1 < frame.data.length; i += 2) {
          await this.handleBillEvent(port, peripheral, frame.data[i], frame.data[i + 1])
        }
      } catch (err) {
        // A poll timeout just means nothing happened this tick.
      }
    }, intervalMs)
    this.pollTimers.set(port, timer)
  }

  /** eventCode/billType pairs follow the same basic ccTalk "credit" event
   *  class most bill/coin acceptors expose: 0x10 inserted, 0x11 stacked
   *  (committed — safe to credit), 0x12 rejected by the device itself. */
  async handleBillEvent(port, peripheral, eventCode, billType) {
    if (eventCode === 0x10) {
      try { await peripheral.link.request(CC_HEADER.ROUTE_BILL, [ROUTE.STACK]) }
      catch (err) { console.error(`[HardwareAgent] Failed to route bill on ${port}:`, err.message) }
      return
    }
    if (eventCode === 0x11) {
      // `amount` is the raw device type code (hex string), not a euro value —
      // the backend's configurable coinEqTable/billEqTable maps it (see
      // services/coinMachine.js).
      const amount = `0x${String(billType).padStart(2, '0')}`
      this.sendToServer('peripheral:credit', { port: peripheral.config.port || port, type: peripheral.type, amount })
      return
    }
    if (eventCode === 0x12) {
      this.sendToServer('peripheral:rejected', { port: peripheral.config.port || port, type: peripheral.type, reason: 'device_rejected' })
    }
  }

  setupInterfaceHandler(peripheral) {
    peripheral.buffer = Buffer.alloc(0)
    peripheral.serialPort.on('data', (chunk) => {
      peripheral.buffer = Buffer.concat([peripheral.buffer, chunk])

      // KITSEC protocol: STX (0x02) ... ETX (0x03)
      while (true) {
        const stxIdx = peripheral.buffer.indexOf(0x02)
        if (stxIdx === -1) break

        const etxIdx = peripheral.buffer.indexOf(0x03, stxIdx + 1)
        if (etxIdx === -1) break

        const packet = peripheral.buffer.slice(stxIdx + 1, etxIdx)
        peripheral.buffer = peripheral.buffer.slice(etxIdx + 1)

        if (packet.length >= 2) {
          const cmd = packet[0]
          const data = packet.slice(1)

          if (cmd === 0x53) { // Status command
            const status = data[0]
            this.sendToServer('interface:status', {
              interfaceId: peripheral.config.interfaceId,
              door: (status & 0x01) === 0x01,
              occupied: (status & 0x02) === 0x02,
              fault: (status & 0x04) === 0x04,
            })
          } else if (cmd === 0x45) { // Error command
            this.sendToServer('interface:error', {
              interfaceId: peripheral.config.interfaceId,
              errorCode: data[0],
            })
          }
        }
      }
    })
  }

  setupPrinterHandler(peripheral) {
    // ESC/POS printers don't typically send data back
    peripheral.serialPort.on('error', (err) => {
      this.sendToServer('printer:error', {
        port: peripheral.config.port,
        error: err.message,
      })
    })
  }

  handleRfidData(port, cardCode) {
    console.log(`[HardwareAgent] RFID card detected: ${cardCode}`)
    this.sendToServer('rfid:card_detected', {
      port,
      cardCode: cardCode.trim(),
    })
  }

  connectToServer() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    console.log(`[HardwareAgent] Connecting to server: ${this.config.serverUrl}`)

    this.ws = new WebSocket(this.config.serverUrl, {
      headers: {
        'Authorization': `ApiKey ${this.config.apiKey}`,
        'X-Hardware-Agent': 'true',
      },
    })

    this.ws.on('open', () => {
      console.log('[HardwareAgent] Connected to server')
      this.wsConnected = true

      this.sendToServer('agent:connected', {
        peripherals: Array.from(this.peripherals.entries()).map(([port, p]) => ({
          port,
          type: p.type,
        })),
      })

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
    })

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        this.handleServerCommand(msg)
      } catch (err) {
        console.error('[HardwareAgent] Failed to parse server message:', err)
      }
    })

    this.ws.on('close', () => {
      console.log('[HardwareAgent] Disconnected from server')
      this.wsConnected = false

      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.connectToServer()
        }, this.config.reconnectInterval)
      }
    })

    this.ws.on('error', (err) => {
      console.error('[HardwareAgent] WebSocket error:', err.message)
    })
  }

  handleServerCommand(msg) {
    const { type, payload } = msg

    console.log(`[HardwareAgent] Received command: ${type}`, payload)

    switch (type) {
      case 'machine:activate':
        this.activateMachine(payload)
        break
      case 'hopper:dispense':
        this.dispenseChange(payload)
        break
      case 'card_dispenser:dispense':
        this.dispenseCard(payload)
        break
      case 'printer:print':
        this.printReceipt(payload)
        break
      default:
        console.warn(`[HardwareAgent] Unknown command type: ${type}`)
    }
  }

  async activateMachine(payload) {
    const { interfaceId, port, channel, impulses, tOn, tOff } = payload

    const peripheral = Array.from(this.peripherals.values()).find(
      (p) => p.type === 'interface' && p.config.interfaceId === interfaceId
    )

    if (!peripheral) {
      console.error(`[HardwareAgent] Interface not found: ${interfaceId}`)
      return
    }

    const cmd = 0x41 // Activate command
    const data = Buffer.from([port, channel, impulses, tOn, tOff])

    let sum = cmd
    for (const byte of data) sum += byte
    const checksum = (256 - (sum % 256)) % 256

    const packet = Buffer.from([0x02, cmd, ...data, checksum, 0x03])

    peripheral.serialPort.write(packet, (err) => {
      if (err) {
        console.error('[HardwareAgent] Failed to activate machine:', err)
        this.sendToServer('machine:activation_failed', { interfaceId, error: err.message })
      } else {
        console.log('[HardwareAgent] Machine activation sent')
        this.sendToServer('machine:activation_sent', { interfaceId })
      }
    })
  }

  /** Dispense change from the hopper. `coins` is a denomination breakdown
   *  computed server-side (coinMachine.js); each entry targets the hopper
   *  peripheral at `port` — in practice a single physical hopper holds one
   *  denomination, so `coins` will typically have one entry.
   *
   *  ccTalk dispense (167) only ACKs that the command was *accepted* — coins
   *  physically drop out over the next several hundred ms, so completion is
   *  only knowable by polling status (166) afterwards until the hopper stops
   *  reporting "paying". */
  async dispenseChange(payload) {
    const { port, coins } = payload

    const peripheral = this.peripherals.get(port)
    if (!peripheral || peripheral.type !== 'hopper' || !peripheral.link) {
      console.error(`[HardwareAgent] Hopper not found on port: ${port}`)
      this.sendToServer('hopper:fault', { port, reason: 'not_connected' })
      return
    }

    // Safety ceiling: catches a calculation bug (euros vs cents, a misplaced
    // decimal) before it drains the hopper, rather than trying to dispense
    // hundreds of coins for what should have been a normal change amount.
    const MAX_COINS_PER_DISPENSE = 50
    const totalRequested = coins.reduce((s, c) => s + (Number(c.quantity) || 0), 0)
    if (totalRequested > MAX_COINS_PER_DISPENSE) {
      console.error(`[HardwareAgent] Refusing to dispense ${totalRequested} coins (>${MAX_COINS_PER_DISPENSE}) on ${port} — looks like a calculation error, not real change`)
      this.sendToServer('hopper:dispensed', { port, success: false })
      this.sendToServer('hopper:fault', { port, reason: 'dispense_amount_too_large', requested: totalRequested })
      return
    }

    for (const { quantity } of coins) {
      const count = Number(quantity) || 0
      if (count <= 0) continue

      try {
        const ack = await peripheral.link.request(CC_HEADER.DISPENSE_HOPPER, [count], 3000)
        if (ack.header !== 0x00) throw new Error('dispense command NAK\'d by hopper')
      } catch (err) {
        console.error('[HardwareAgent] Hopper dispense command failed:', err.message)
        this.sendToServer('hopper:dispensed', { port, success: false })
        this.sendToServer('hopper:fault', { port, reason: 'fault' })
        return
      }

      const deadline = Date.now() + count * 500 + 2000
      let done = false
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250))
        try {
          const status = await peripheral.link.request(CC_HEADER.HOPPER_STATUS)
          if (status.data[0] !== 0x01) { done = true; break }
        } catch { /* keep polling until deadline */ }
      }

      if (!done) {
        console.error('[HardwareAgent] Hopper dispense timed out waiting for completion')
        this.sendToServer('hopper:dispensed', { port, success: false })
        this.sendToServer('hopper:fault', { port, reason: 'jam' })
        return
      }
    }

    this.sendToServer('hopper:dispensed', { port, success: true })
  }

  async dispenseCard(payload) {
    const { port } = payload

    const peripheral = this.peripherals.get(port)
    if (!peripheral || peripheral.type !== 'card_dispenser') {
      console.error(`[HardwareAgent] Card dispenser not found on port: ${port}`)
      return
    }

    if (peripheral.link) {
      try {
        await peripheral.link.request(CC_HEADER.DISPENSE_CARD, [], 3000)
        this.sendToServer('card_dispenser:dispensed', { port, success: true })
      } catch (err) {
        this.sendToServer('card_dispenser:dispensed', { port, success: false, error: err.message })
      }
      return
    }

    // Pulse-based dispenser
    const pulseWidth = peripheral.config.pulseWidth || 500
    peripheral.serialPort.set({ rts: true })
    setTimeout(() => {
      peripheral.serialPort.set({ rts: false })
      this.sendToServer('card_dispenser:dispensed', { port, success: true })
    }, pulseWidth)
  }

  async printReceipt(payload) {
    const { port, lines } = payload

    const peripheral = this.peripherals.get(port)
    if (!peripheral || peripheral.type !== 'printer') {
      console.error(`[HardwareAgent] Printer not found on port: ${port}`)
      return
    }

    const ESC = 0x1B
    const GS = 0x1D

    const commands = []
    commands.push(Buffer.from([ESC, 0x40]))

    for (const line of lines) {
      if (line.align === 'center') {
        commands.push(Buffer.from([ESC, 0x61, 0x01]))
      }
      if (line.bold) {
        commands.push(Buffer.from([ESC, 0x45, 0x01]))
      }

      commands.push(Buffer.from(line.text + '\n'))

      if (line.bold) {
        commands.push(Buffer.from([ESC, 0x45, 0x00]))
      }
    }

    commands.push(Buffer.from([ESC, 0x64, 0x03]))
    commands.push(Buffer.from([GS, 0x56, 0x00]))

    const fullCommand = Buffer.concat(commands)
    peripheral.serialPort.write(fullCommand)
  }

  sendToServer(type, payload) {
    if (!this.wsConnected || !this.ws) {
      console.warn('[HardwareAgent] Not connected to server, cannot send:', type)
      return
    }

    const msg = JSON.stringify({ type, payload })
    this.ws.send(msg)
  }

  async stop() {
    console.log('[HardwareAgent] Stopping...')

    for (const timer of this.pollTimers.values()) clearInterval(timer)
    this.pollTimers.clear()

    for (const [port, peripheral] of this.peripherals.entries()) {
      try {
        if (peripheral.serialPort.isOpen) {
          await new Promise((resolve) => {
            peripheral.serialPort.close(resolve)
          })
        }
      } catch (err) {
        console.error(`[HardwareAgent] Error closing ${port}:`, err.message)
      }
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    console.log('[HardwareAgent] Stopped')
  }
}

export default HardwareAgent

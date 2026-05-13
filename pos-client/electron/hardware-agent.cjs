/**
 * WashBubbles Embedded Hardware Agent
 * Runs inside Electron main process - no separate process or WebSocket needed
 * Communicates directly with serial ports and writes to local SQLite
 */
const EventEmitter = require('events')
const fs = require('fs')
const path = require('path')

let SerialPort, ReadlineParser
try {
  const sp = require('serialport')
  SerialPort = sp.SerialPort
  const parsers = require('@serialport/parser-readline')
  ReadlineParser = parsers.ReadlineParser
} catch (e) {
  console.warn('[HWAgent] serialport not installed — hardware disabled')
}

class EmbeddedHardwareAgent extends EventEmitter {
  constructor(config, database) {
    super()
    this.config = {
      peripherals: config.peripherals || {},
      ...config
    }
    this.db = database
    this.peripherals = new Map()
    this.running = false
  }

  async start() {
    if (!SerialPort) {
      console.warn('[HWAgent] SerialPort not available — running in simulated mode')
      this.running = true
      return
    }
    console.log('[HWAgent] Starting embedded hardware agent...')
    await this.initializePeripherals()
    this.running = true
    console.log('[HWAgent] Started successfully')
  }

  async initializePeripherals() {
    for (const [type, config] of Object.entries(this.config.peripherals)) {
      if (!config.enabled) continue
      try {
        await this.connectPeripheral(type, config)
      } catch (err) {
        console.error(`[HWAgent] Failed to connect ${type}:`, err.message)
      }
    }
  }

  async connectPeripheral(type, config) {
    const { port, baudRate = 9600 } = config
    console.log(`[HWAgent] Connecting ${type} on ${port}...`)

    const serialPort = new SerialPort({ path: port, baudRate, autoOpen: false })

    await new Promise((resolve, reject) => {
      serialPort.open((err) => { if (err) reject(err); else resolve() })
    })

    const peripheral = { type, serialPort, config }
    this.peripherals.set(type, peripheral)
    this.setupPeripheralHandler(peripheral)
    console.log(`[HWAgent] ${type} connected on ${port}`)
  }

  setupPeripheralHandler(peripheral) {
    const { type, serialPort } = peripheral

    if (type === 'coin_acceptor' || type === 'bill_acceptor') {
      peripheral._buf = Buffer.alloc(0)
      serialPort.on('data', (chunk) => {
        peripheral._buf = Buffer.concat([peripheral._buf, chunk])
        while (peripheral._buf.length >= 5) {
          const len = peripheral._buf[1]
          const totalLen = len + 5
          if (peripheral._buf.length < totalLen) break
          const packet = peripheral._buf.slice(0, totalLen)
          peripheral._buf = peripheral._buf.slice(totalLen)
          let sum = 0
          for (let i = 0; i < totalLen - 1; i++) sum += packet[i]
          const expected = (256 - (sum & 0xff)) & 0xff
          if (packet[totalLen - 1] !== expected) {
            peripheral._buf = Buffer.concat([packet.slice(1), peripheral._buf])
            continue
          }
          this._handleCurrencyPacket(type, packet[3], packet.slice(4, 4 + len))
        }
      })
    } else if (type === 'hopper') {
      peripheral._buf = Buffer.alloc(0)
      serialPort.on('data', (chunk) => {
        peripheral._buf = Buffer.concat([peripheral._buf, chunk])
        while (peripheral._buf.length >= 5) {
          const len = peripheral._buf[1]
          const totalLen = len + 5
          if (peripheral._buf.length < totalLen) break
          const packet = peripheral._buf.slice(0, totalLen)
          peripheral._buf = peripheral._buf.slice(totalLen)
          let sum = 0
          for (let i = 0; i < totalLen - 1; i++) sum += packet[i]
          const expected = (256 - (sum & 0xff)) & 0xff
          if (packet[totalLen - 1] !== expected) {
            peripheral._buf = Buffer.concat([packet.slice(1), peripheral._buf])
            continue
          }
          this._handleHopperPacket(packet[3], packet.slice(4, 4 + len))
        }
      })
    } else if (type === 'rfid_reader') {
      const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }))
      parser.on('data', (line) => {
        const cardCode = line.trim()
        if (cardCode) {
          console.log(`[HWAgent] RFID card detected: ${cardCode}`)
          this.emit('rfid:card_detected', { cardCode })
        }
      })
    } else if (type === 'interface') {
      peripheral._buf = Buffer.alloc(0)
      serialPort.on('data', (chunk) => {
        peripheral._buf = Buffer.concat([peripheral._buf, chunk])
        let stx
        while ((stx = peripheral._buf.indexOf(0x02)) !== -1) {
          const etx = peripheral._buf.indexOf(0x03, stx + 1)
          if (etx === -1) break
          const frame = peripheral._buf.slice(stx + 1, etx)
          peripheral._buf = peripheral._buf.slice(etx + 1)
          const cmd = frame[0]
          const status = frame.length > 1 ? frame[1] : 0
          this.emit('interface:status', { cmd, status, raw: frame.toString('hex') })
        }
        const nextStx = peripheral._buf.indexOf(0x02)
        if (nextStx > 0) peripheral._buf = peripheral._buf.slice(nextStx)
      })
    } else {
      const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }))
      parser.on('data', (line) => {
        this.emit('peripheral:data', { type, data: line.toString() })
      })
    }

    serialPort.on('error', (err) => {
      console.error(`[HWAgent] ${type} error:`, err.message)
      this.emit('peripheral:fault', { type, reason: 'serial_error', message: err.message })
    })
  }

  _handleCurrencyPacket(type, header, data) {
    if (header === 0x02 && data.length >= 3) {
      const creditCode = data[1]
      const errorCode = data[2]
      if (errorCode === 0 && creditCode > 0) {
        const coinValues = { 1: 0.05, 2: 0.10, 3: 0.20, 4: 0.50, 5: 1.00, 6: 2.00 }
        const billValues = { 1: 5, 2: 10, 3: 20, 4: 50 }
        const valueMap = type === 'coin_acceptor' ? coinValues : billValues
        const amount = valueMap[creditCode] || 0
        if (amount > 0) {
          console.log(`[HWAgent] ${type} credit: €${amount}`)
          this.emit('credit', { type, amount })
        }
      } else if (errorCode !== 0) {
        const errorMap = { 1: 'rejected', 2: 'fraud', 3: 'stacker_full', 4: 'jam', 5: 'calibration_error' }
        const reason = errorMap[errorCode] || `error_${errorCode}`
        this.emit(errorCode === 2 ? 'fraud' : 'rejected', { type, reason })
      }
    }
  }

  _handleHopperPacket(header, data) {
    if (header === 0xA7) {
      const success = data[0] === 0x00
      this.emit('hopper:dispensed', { success })
      if (!success) {
        const reason = data[0] === 0x01 ? 'empty' : data[0] === 0x02 ? 'jam' : 'fault'
        this.emit(reason === 'empty' ? 'hopper:empty' : 'hopper:fault', { reason })
      }
    } else if (header === 0xA1) {
      if (data[0] === 1) this.emit('hopper:empty', {})
      else if (data[0] === 2) this.emit('hopper:fault', { reason: 'status_fault' })
    }
  }

  // ─── Commands ───

  activateMachine(machineRow, interfaceRow) {
    const iface = this.peripherals.get('interface')
    if (!iface) {
      console.error('[HWAgent] Interface not connected')
      return false
    }
    const portNum = machineRow.port || 1
    const channel = machineRow.channel || 1
    const impulses = parseInt(machineRow.impulses) || 1
    const tOn = interfaceRow.t_on || 5
    const tOff = interfaceRow.t_off || 5
    const cmd = 0x41
    const body = [portNum, channel, impulses, tOn, tOff]
    let sum = cmd
    for (const b of body) sum += b
    const checksum = (256 - (sum & 0xff)) & 0xff
    const packet = Buffer.from([0x02, cmd, ...body, checksum, 0x03])

    iface.serialPort.write(packet, (err) => {
      if (err) {
        console.error('[HWAgent] Machine activation failed:', err.message)
        this.emit('machine:activation_failed', { error: err.message })
      } else {
        console.log(`[HWAgent] Machine activation sent: port=${portNum} ch=${channel}`)
        this.emit('machine:activation_sent', { port: portNum, channel })
      }
    })
    return true
  }

  dispenseCoins(amount) {
    const hopper = this.peripherals.get('hopper')
    if (!hopper) {
      this.emit('hopper:fault', { reason: 'not_connected' })
      return false
    }
    const address = hopper.config.address || 3
    const coinValue = hopper.config.coinValue || 0.05
    const coinsToDispense = Math.round(amount / coinValue)
    if (coinsToDispense < 1) return false

    const dest = address
    const src = 0
    const cmd = 0xA7
    const dataBytes = [coinsToDispense]
    let sum = dest + dataBytes.length + src + cmd
    for (const b of dataBytes) sum += b
    const checksum = (256 - (sum & 0xff)) & 0xff
    const packet = Buffer.from([dest, dataBytes.length, src, cmd, ...dataBytes, checksum])

    hopper.serialPort.write(packet, (err) => {
      if (err) {
        this.emit('hopper:fault', { reason: 'write_error', message: err.message })
      } else {
        console.log(`[HWAgent] Dispensing €${amount} (${coinsToDispense} coins)`)
      }
    })
    return true
  }

  printReceipt(payload) {
    const printer = this.peripherals.get('printer')
    if (!printer) return false
    const ESC = '\x1B'
    const commands = [
      `${ESC}@`, `${ESC}a\x01`, payload.header || 'WashBubbles', '\n',
      `${ESC}a\x00`, payload.body || '', '\n\n\n', `${ESC}d\x03`, `${ESC}m`
    ].join('')
    printer.serialPort.write(commands)
    return true
  }

  dispenseCard() {
    const dispenser = this.peripherals.get('card_dispenser')
    if (!dispenser) return false
    if (dispenser.config.protocol === 'pulse') {
      const pulseWidth = dispenser.config.pulseWidth || 500
      dispenser.serialPort.set({ rts: true }, () => {
        setTimeout(() => dispenser.serialPort.set({ rts: false }), pulseWidth)
      })
    } else {
      const address = dispenser.config.address || 4
      const cmd = 0xC0
      const checksum = (256 - ((address + cmd) & 0xff)) & 0xff
      const packet = Buffer.from([address, 0, 0, cmd, checksum])
      dispenser.serialPort.write(packet)
    }
    return true
  }

  getStatus() {
    const status = {}
    for (const [type, p] of this.peripherals) {
      status[type] = { connected: p.serialPort.isOpen, port: p.config.port }
    }
    return { running: this.running, peripherals: status }
  }

  async stop() {
    console.log('[HWAgent] Stopping...')
    for (const [type, peripheral] of this.peripherals) {
      try { peripheral.serialPort.close(); console.log(`[HWAgent] Closed ${type}`) }
      catch (err) { console.error(`[HWAgent] Failed to close ${type}:`, err.message) }
    }
    this.peripherals.clear()
    this.running = false
    console.log('[HWAgent] Stopped')
  }
}

module.exports = { EmbeddedHardwareAgent }

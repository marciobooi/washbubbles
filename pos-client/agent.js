/**
 * WashBubbles POS Hardware Agent
 * Runs on local POS machine, connects to remote server via WebSocket
 * Handles all physical hardware communication (coin/bill acceptors, interfaces, printer, etc.)
 */

import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'
import { WebSocket } from 'ws'
import EventEmitter from 'events'
import fs from 'fs'

class HardwareAgent extends EventEmitter {
  constructor(config) {
    super()
    this.config = {
      serverUrl: config.serverUrl || 'ws://localhost:3000/hardware-agent',
      apiKey: config.apiKey,
      reconnectInterval: config.reconnectInterval || 5000,
      peripherals: config.peripherals || {},
    }
    
    this.ws = null
    this.wsConnected = false
    this.peripherals = new Map()
    this.reconnectTimer = null
  }

  async start() {
    console.log('[Agent] Starting hardware agent...')
    console.log('[Agent] Server:', this.config.serverUrl)
    
    // Initialize peripherals
    await this.initializePeripherals()
    
    // Connect to server
    this.connectToServer()
    
    console.log('[Agent] Started successfully')
  }

  async initializePeripherals() {
    console.log('[Agent] Initializing peripherals...')
    
    for (const [type, config] of Object.entries(this.config.peripherals)) {
      if (!config.enabled) continue
      
      try {
        await this.connectPeripheral(type, config)
      } catch (err) {
        console.error(`[Agent] Failed to connect ${type}:`, err.message)
      }
    }
  }

  async connectPeripheral(type, config) {
    const { port, baudRate = 9600 } = config
    
    console.log(`[Agent] Connecting ${type} on ${port}...`)
    
    const serialPort = new SerialPort({
      path: port,
      baudRate,
      autoOpen: false,
    })

    await new Promise((resolve, reject) => {
      serialPort.open((err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    const peripheral = { type, serialPort, config }
    this.peripherals.set(type, peripheral)
    
    // Setup data handler based on peripheral type
    this.setupPeripheralHandler(peripheral)
    
    console.log(`[Agent] ${type} connected on ${port}`)
  }

  setupPeripheralHandler(peripheral) {
    const { type, serialPort } = peripheral

    if (type === 'coin_acceptor' || type === 'bill_acceptor') {
      // ccTalk binary protocol — variable-length framed packets
      peripheral._buf = Buffer.alloc(0)
      serialPort.on('data', (chunk) => {
        peripheral._buf = Buffer.concat([peripheral._buf, chunk])
        while (peripheral._buf.length >= 5) {
          const len = peripheral._buf[1]
          const totalLen = len + 5
          if (peripheral._buf.length < totalLen) break
          const packet = peripheral._buf.slice(0, totalLen)
          peripheral._buf = peripheral._buf.slice(totalLen)
          // Verify checksum
          let sum = 0
          for (let i = 0; i < totalLen - 1; i++) sum += packet[i]
          const expected = (256 - (sum & 0xff)) & 0xff
          if (packet[totalLen - 1] !== expected) {
            console.warn(`[Agent] ${type}: checksum mismatch, dropping byte`)
            peripheral._buf = Buffer.concat([packet.slice(1), peripheral._buf])
            continue
          }
          this._handleCurrencyPacket(type, packet[3], packet.slice(4, 4 + len))
        }
      })
    } else if (type === 'hopper') {
      // ccTalk binary protocol for hopper
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
      // Line-delimited card codes
      const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }))
      parser.on('data', (line) => {
        const cardCode = line.trim()
        if (cardCode) {
          console.log(`[Agent] RFID card detected: ${cardCode}`)
          this.sendToServer('rfid:card_detected', { type, cardCode })
        }
      })
    } else if (type === 'interface') {
      // KITSEC STX/ETX framed protocol (STX=0x02, ETX=0x03)
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
          console.log(`[Agent] Interface cmd=0x${cmd.toString(16)} status=0x${status.toString(16)}`)
          this.sendToServer('interface:status', { cmd, status, raw: frame.toString('hex') })
        }
        // Drop bytes before the next potential STX
        const nextStx = peripheral._buf.indexOf(0x02)
        if (nextStx > 0) peripheral._buf = peripheral._buf.slice(nextStx)
      })
    } else {
      // Generic line-based parser (printer, card_dispenser, etc.)
      const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }))
      parser.on('data', (line) => {
        console.log(`[Agent] ${type} data:`, line)
        this.sendToServer('peripheral:data', { type, data: line.toString(), timestamp: new Date().toISOString() })
      })
    }

    serialPort.on('error', (err) => {
      console.error(`[Agent] ${type} error:`, err.message)
      this.sendToServer('peripheral:fault', { type, reason: 'serial_error', message: err.message })
    })
  }

  // ccTalk header 0x02 = Read Buffered Credit Or Error Codes response
  // data[0] = event counter, data[1] = credit code, data[2] = error code
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
          console.log(`[Agent] ${type} credit: ${amount}`)
          this.sendToServer('peripheral:credit', { type, amount })
        }
      } else if (errorCode !== 0) {
        // 1=reject, 2=fraud/inhibited, 3=stacker_full, 4=jam, 5=calibration_error
        const errorMap = { 1: 'rejected', 2: 'fraud', 3: 'stacker_full', 4: 'jam', 5: 'calibration_error' }
        const reason = errorMap[errorCode] || `error_${errorCode}`
        const isFraud = errorCode === 2
        console.warn(`[Agent] ${type} ${reason}`)
        this.sendToServer(isFraud ? 'peripheral:fraud' : 'peripheral:rejected', { type, reason })
      }
    }
  }

  _handleHopperPacket(header, data) {
    // 0xA7 = Dispense Coins response
    if (header === 0xA7) {
      const success = data[0] === 0x00
      this.sendToServer('hopper:dispensed', { success })
      if (!success) {
        const reason = data[0] === 0x01 ? 'empty' : data[0] === 0x02 ? 'jam' : 'fault'
        if (reason === 'empty') this.sendToServer('hopper:empty', {})
        else this.sendToServer('hopper:fault', { reason })
      }
    } else if (header === 0xA1) {
      // Status response
      if (data[0] === 1) this.sendToServer('hopper:empty', {})
      else if (data[0] === 2) this.sendToServer('hopper:fault', { reason: 'status_fault' })
    }
  }

  connectToServer() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    console.log(`[Agent] Connecting to server: ${this.config.serverUrl}`)
    
    this.ws = new WebSocket(this.config.serverUrl, {
      headers: {
        'Authorization': `ApiKey ${this.config.apiKey}`,
      },
    })

    this.ws.on('open', () => {
      console.log('[Agent] Connected to server!')
      this.wsConnected = true
      
      // Send connected event with peripheral list
      this.sendToServer('agent:connected', {
        peripherals: Array.from(this.peripherals.entries()).map(([type, p]) => ({
          type,
          port: p.config.port,
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
        console.error('[Agent] Failed to parse server message:', err)
      }
    })

    this.ws.on('close', () => {
      console.log('[Agent] Disconnected from server')
      this.wsConnected = false
      
      // Reconnect
      if (!this.reconnectTimer) {
        console.log(`[Agent] Reconnecting in ${this.config.reconnectInterval}ms...`)
        this.reconnectTimer = setTimeout(() => {
          this.connectToServer()
        }, this.config.reconnectInterval)
      }
    })

    this.ws.on('error', (err) => {
      console.error('[Agent] WebSocket error:', err.message)
    })
  }

  handleServerCommand(msg) {
    const { type, payload } = msg
    console.log(`[Agent] Received command: ${type}`)
    
    switch (type) {
      case 'peripheral:send':
        this.sendToPeripheral(payload.peripheral, payload.data)
        break
      case 'printer:print':
        this.printReceipt(payload)
        break
      case 'hopper:dispense':
        this.dispenseCoins(payload)
        break
      case 'machine:activate':
        this.activateMachine(payload)
        break
      case 'card_dispenser:dispense':
        this.dispenseCard(payload)
        break
      default:
        console.log(`[Agent] Unknown command: ${type}`)
    }
  }

  sendToPeripheral(peripheralType, data) {
    const peripheral = this.peripherals.get(peripheralType)
    if (!peripheral) {
      console.error(`[Agent] Peripheral not found: ${peripheralType}`)
      return
    }
    
    peripheral.serialPort.write(data + '\r\n', (err) => {
      if (err) {
        console.error(`[Agent] Failed to send to ${peripheralType}:`, err.message)
      }
    })
  }

  printReceipt(payload) {
    const printer = this.peripherals.get('printer')
    if (!printer) {
      console.error('[Agent] Printer not connected')
      return
    }
    
    // ESC/POS commands
    const ESC = '\x1B'
    const commands = [
      `${ESC}@`,           // Initialize
      `${ESC}a\x01`,       // Center align
      payload.header || 'WashBubbles',
      '\n',
      `${ESC}a\x00`,       // Left align
      payload.body || '',
      '\n\n\n',
      `${ESC}d\x03`,       // Feed 3 lines
      `${ESC}m`,           // Cut
    ].join('')
    
    printer.serialPort.write(commands)
  }

  dispenseCoins(payload) {
    const hopper = this.peripherals.get('hopper')
    if (!hopper) {
      console.error('[Agent] Hopper not connected')
      this.sendToServer('hopper:fault', { reason: 'not_connected' })
      return
    }

    const { amount } = payload
    const address = hopper.config.address || 3
    // Assume coin unit from config (default 5¢); compute how many coins to dispense
    const coinValue = hopper.config.coinValue || 0.05
    const coinsToDispense = Math.round(amount / coinValue)
    if (coinsToDispense < 1) return

    // ccTalk Dispense Coins: [dest, len, src, 0xA7, count, checksum]
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
        console.error('[Agent] Failed to dispense coins:', err.message)
        this.sendToServer('hopper:fault', { reason: 'write_error', message: err.message })
      } else {
        console.log(`[Agent] Dispensing ${amount}€ (${coinsToDispense} × ${coinValue * 100}¢ coins)`)
      }
    })
  }

  activateMachine(payload) {
    const iface = this.peripherals.get('interface')
    if (!iface) {
      console.error('[Agent] Interface not connected')
      this.sendToServer('machine:activation_failed', { error: 'Interface not connected' })
      return
    }

    const { port = 1, channel = 1, impulses = 1, tOn = 5, tOff = 5 } = payload
    // KITSEC: STX 0x41 port channel impulses tOn tOff checksum ETX
    const cmd = 0x41
    const body = [port, channel, impulses, tOn, tOff]
    let sum = cmd
    for (const b of body) sum += b
    const checksum = (256 - (sum & 0xff)) & 0xff
    const packet = Buffer.from([0x02, cmd, ...body, checksum, 0x03])

    iface.serialPort.write(packet, (err) => {
      if (err) {
        console.error('[Agent] Machine activation failed:', err.message)
        this.sendToServer('machine:activation_failed', { error: err.message })
      } else {
        console.log(`[Agent] Machine activation sent: port=${port} ch=${channel}`)
        this.sendToServer('machine:activation_sent', { port, channel })
      }
    })
  }

  dispenseCard(payload) {
    const dispenser = this.peripherals.get('card_dispenser')
    if (!dispenser) {
      console.error('[Agent] Card dispenser not connected')
      return
    }

    if (dispenser.config.protocol === 'pulse') {
      // Pulse RTS line to trigger dispense
      const pulseWidth = dispenser.config.pulseWidth || 500
      dispenser.serialPort.set({ rts: true }, () => {
        setTimeout(() => dispenser.serialPort.set({ rts: false }), pulseWidth)
      })
    } else {
      // ccTalk dispense card: [dest, 0, 0, 0xC0, checksum]
      const address = dispenser.config.address || 4
      const cmd = 0xC0
      const checksum = (256 - ((address + cmd) & 0xff)) & 0xff
      const packet = Buffer.from([address, 0, 0, cmd, checksum])
      dispenser.serialPort.write(packet, (err) => {
        if (err) console.error('[Agent] Card dispense failed:', err.message)
        else console.log('[Agent] Card dispense command sent')
      })
    }
  }

  sendToServer(type, payload) {
    if (!this.wsConnected || !this.ws) {
      console.warn('[Agent] Not connected to server, queuing message')
      return
    }
    
    try {
      this.ws.send(JSON.stringify({ type, payload }))
    } catch (err) {
      console.error('[Agent] Failed to send to server:', err.message)
    }
  }

  async stop() {
    console.log('[Agent] Stopping...')
    
    // Close all serial ports
    for (const [type, peripheral] of this.peripherals) {
      try {
        peripheral.serialPort.close()
        console.log(`[Agent] Closed ${type}`)
      } catch (err) {
        console.error(`[Agent] Failed to close ${type}:`, err.message)
      }
    }
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close()
    }
    
    console.log('[Agent] Stopped')
  }
}

// Load configuration
let config = {
  serverUrl: 'ws://localhost:3000/hardware-agent',
  apiKey: null,
  peripherals: {},
}

const configPath = process.argv[2] || 'config.json'
if (fs.existsSync(configPath)) {
  console.log(`[Agent] Loading config from ${configPath}`)
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  config = { ...config, ...fileConfig }
} else {
  console.warn(`[Agent] Config file not found: ${configPath}`)
  console.warn('[Agent] Using default configuration')
}

if (!config.apiKey) {
  console.error('[Agent] ERROR: No API key configured!')
  console.error('[Agent] Edit config.json and set your KIOSK API key')
  process.exit(1)
}

// Start agent
const agent = new HardwareAgent(config)
agent.start().catch((err) => {
  console.error('[Agent] Failed to start:', err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Agent] Shutting down...')
  await agent.stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await agent.stop()
  process.exit(0)
})

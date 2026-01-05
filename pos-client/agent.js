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
    
    // Generic line-based parser for most peripherals
    const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }))
    
    parser.on('data', (data) => {
      console.log(`[Agent] ${type} data:`, data)
      
      // Send to server
      this.sendToServer(`peripheral:data`, {
        type,
        data: data.toString(),
        timestamp: new Date().toISOString(),
      })
    })
    
    serialPort.on('error', (err) => {
      console.error(`[Agent] ${type} error:`, err.message)
    })
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
      return
    }
    
    // ccTalk dispense command (simplified)
    console.log(`[Agent] Dispensing ${payload.amount} coins`)
    // Implementation depends on hopper protocol
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

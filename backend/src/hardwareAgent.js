/**
 * Hardware Agent - Runs locally on POS machine
 * 
 * This service runs on the POS machine and handles all physical hardware communication:
 * - Coin acceptor (serial)
 * - Bill acceptor (serial)
 * - Interface/Machines (serial - INT 6 KITSEC)
 * - Hopper (serial - ccTalk)
 * - Card dispenser (serial - ccTalk/pulse)
 * - Printer (serial - ESC/POS)
 * - RFID reader (serial)
 * 
 * Communicates with remote backend server via WebSocket:
 * - Receives commands from server (dispense coins, activate machine, print receipt, etc.)
 * - Sends events to server (coin inserted, card detected, machine status, etc.)
 */

import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'
import { WebSocket } from 'ws'
import EventEmitter from 'events'

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
    this.peripherals = new Map() // port -> { type, serialPort, parser, config }
    this.machineInterfaces = new Map() // interfaceId -> { serialPort, config }
    this.reconnectTimer = null
  }

  async start() {
    console.log('[HardwareAgent] Starting...')
    
    // Initialize peripherals from config
    await this.initializePeripherals()
    
    // Connect to remote server
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

    let parser = null
    const peripheral = { type, serialPort, config, buffer: Buffer.alloc(0) }

    // Setup parser based on peripheral type
    switch (type) {
      case 'coin_acceptor':
      case 'bill_acceptor':
        this.setupCoinBillHandler(peripheral)
        break
      case 'interface':
        this.setupInterfaceHandler(peripheral)
        break
      case 'hopper':
        this.setupHopperHandler(peripheral)
        break
      case 'card_dispenser':
        this.setupCardDispenserHandler(peripheral)
        break
      case 'printer':
        this.setupPrinterHandler(peripheral)
        break
      case 'rfid_reader':
        parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }))
        parser.on('data', (data) => this.handleRfidData(port, data))
        peripheral.parser = parser
        break
      default:
        console.warn(`[HardwareAgent] Unknown peripheral type: ${type}`)
    }

    this.peripherals.set(port, peripheral)
    console.log(`[HardwareAgent] ${type} connected on ${port}`)
  }

  setupCoinBillHandler(peripheral) {
    peripheral.serialPort.on('data', (chunk) => {
      peripheral.buffer = Buffer.concat([peripheral.buffer, chunk])
      
      // ccTalk/MDB protocol parsing
      while (peripheral.buffer.length >= 5) {
        const dest = peripheral.buffer[0]
        const len = peripheral.buffer[1]
        const totalLen = len + 5 // dest + len + src + cmd + data + checksum
        
        if (peripheral.buffer.length < totalLen) break
        
        const packet = peripheral.buffer.slice(0, totalLen)
        peripheral.buffer = peripheral.buffer.slice(totalLen)
        
        // Parse packet
        const src = packet[2]
        const cmd = packet[3]
        const data = packet.slice(4, 4 + len)
        const checksum = packet[totalLen - 1]
        
        // Verify checksum
        let sum = 0
        for (let i = 0; i < totalLen - 1; i++) sum += packet[i]
        const expectedChecksum = (256 - (sum % 256)) % 256
        
        if (checksum !== expectedChecksum) {
          console.warn('[HardwareAgent] Invalid checksum')
          continue
        }
        
        // Handle coin/bill events
        if (cmd === 0x01 || cmd === 0x02) { // Coin/Bill credit
          const amount = this.parseCoinBillAmount(data, peripheral.type)
          this.sendToServer('peripheral:credit', {
            port: peripheral.config.port,
            type: peripheral.type,
            amount,
          })
        } else if (cmd === 0x03) { // Fraud attempt (fake coin/bill detected)
          console.warn(`[HardwareAgent] Fraud detected on ${peripheral.type} at ${peripheral.config.port}`)
          this.sendToServer('peripheral:rejected', {
            port: peripheral.config.port,
            type: peripheral.type,
            reason: 'fraud',
            fraud: true,
          })
        } else if (cmd === 0x04) { // Stacker full
          console.warn(`[HardwareAgent] Stacker full on ${peripheral.type} at ${peripheral.config.port}`)
          this.sendToServer('peripheral:fault', {
            port: peripheral.config.port,
            type: peripheral.type,
            reason: 'stacker_full',
          })
        } else if (cmd === 0x05) { // Jam detected
          console.error(`[HardwareAgent] Jam detected on ${peripheral.type} at ${peripheral.config.port}`)
          this.sendToServer('peripheral:fault', {
            port: peripheral.config.port,
            type: peripheral.type,
            reason: 'jam',
          })
        } else if (cmd === 0x06) { // Coin/Bill inhibited (currency not enabled)
          this.sendToServer('peripheral:rejected', {
            port: peripheral.config.port,
            type: peripheral.type,
            reason: 'inhibited',
          })
        } else if (cmd === 0x08) { // Generic reject (unrecognised denomination)
          this.sendToServer('peripheral:rejected', {
            port: peripheral.config.port,
            type: peripheral.type,
            reason: 'unrecognised',
          })
        }
      }
    })
  }

  setupInterfaceHandler(peripheral) {
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
        
        // Parse Interface status packet
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

  setupHopperHandler(peripheral) {
    peripheral.serialPort.on('data', (chunk) => {
      peripheral.buffer = Buffer.concat([peripheral.buffer, chunk])
      
      // ccTalk response parsing
      while (peripheral.buffer.length >= 5) {
        const dest = peripheral.buffer[0]
        const len = peripheral.buffer[1]
        const totalLen = len + 5
        
        if (peripheral.buffer.length < totalLen) break
        
        const packet = peripheral.buffer.slice(0, totalLen)
        peripheral.buffer = peripheral.buffer.slice(totalLen)
        
        const cmd = packet[3]
        const data = packet.slice(4, 4 + len)
        
        // ACK/NACK for dispense commands
        if (cmd === 0xA7) { // Dispense coins response
          const success = data[0] === 0x00
          this.sendToServer('hopper:dispensed', {
            port: peripheral.config.port,
            success,
          })
          if (!success) {
            const reason = data[0] === 0x01 ? 'empty' : data[0] === 0x02 ? 'jam' : 'fault'
            console.error(`[HardwareAgent] Hopper dispense failed (${reason}) on port ${peripheral.config.port}`)
            this.sendToServer('hopper:fault', {
              port: peripheral.config.port,
              reason,
            })
          }
        } else if (cmd === 0xA1) { // Hopper status / empty
          const isEmpty = data[0] === 0x01
          if (isEmpty) {
            console.warn(`[HardwareAgent] Hopper empty on port ${peripheral.config.port}`)
            this.sendToServer('hopper:empty', { port: peripheral.config.port })
          }
        }
      }
    })
  }

  setupCardDispenserHandler(peripheral) {
    peripheral.serialPort.on('data', (chunk) => {
      peripheral.buffer = Buffer.concat([peripheral.buffer, chunk])
      
      // ccTalk or pulse acknowledgment
      this.sendToServer('card_dispenser:dispensed', {
        port: peripheral.config.port,
        success: true,
      })
      peripheral.buffer = Buffer.alloc(0)
    })
  }

  setupPrinterHandler(peripheral) {
    // ESC/POS printers don't typically send data back
    // Just listen for errors
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

  parseCoinBillAmount(data, type) {
    // Parse euro denomination from ccTalk/MDB data
    // This is a simplified version - adjust based on your hardware
    if (data.length === 0) return 0
    
    const code = data[0]
    
    if (type === 'coin_acceptor') {
      const coinMap = { 1: 0.05, 2: 0.10, 3: 0.20, 4: 0.50, 5: 1.00, 6: 2.00 }
      return coinMap[code] || 0
    } else if (type === 'bill_acceptor') {
      const billMap = { 1: 5, 2: 10, 3: 20 }
      return billMap[code] || 0
    }
    
    return 0
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
      
      // Send initial handshake with peripheral configuration
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
      
      // Reconnect after interval
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
    
    // Build KITSEC activation command
    const cmd = 0x41 // Activate command
    const data = Buffer.from([port, channel, impulses, tOn, tOff])
    
    // Calculate checksum
    let sum = cmd
    for (const byte of data) sum += byte
    const checksum = (256 - (sum % 256)) % 256
    
    // Build packet: STX + CMD + DATA + CHECKSUM + ETX
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

  async dispenseChange(payload) {
    const { port, coins } = payload
    
    const peripheral = this.peripherals.get(port)
    if (!peripheral || peripheral.type !== 'hopper') {
      console.error(`[HardwareAgent] Hopper not found on port: ${port}`)
      return
    }
    
    // ccTalk dispense command (0xA7)
    const address = peripheral.config.address || 3
    
    for (const { denomination, quantity } of coins) {
      const cmd = 0xA7
      const data = Buffer.from([quantity])
      
      let sum = address + 1 + 0 + cmd + data[0]
      const checksum = (256 - (sum % 256)) % 256
      
      const packet = Buffer.from([address, 1, 0, cmd, data[0], checksum])
      
      await new Promise((resolve) => {
        peripheral.serialPort.write(packet, resolve)
      })
      
      await new Promise((resolve) => setTimeout(resolve, 200)) // Wait between dispenses
    }
  }

  async dispenseCard(payload) {
    const { port } = payload
    
    const peripheral = this.peripherals.get(port)
    if (!peripheral || peripheral.type !== 'card_dispenser') {
      console.error(`[HardwareAgent] Card dispenser not found on port: ${port}`)
      return
    }
    
    if (peripheral.config.protocol === 'cctalk') {
      // ccTalk dispense card command (0xC0)
      const address = peripheral.config.address || 4
      const cmd = 0xC0
      let sum = address + 0 + 0 + cmd
      const checksum = (256 - (sum % 256)) % 256
      const packet = Buffer.from([address, 0, 0, cmd, checksum])
      
      peripheral.serialPort.write(packet)
    } else {
      // Pulse-based dispenser
      const pulseWidth = peripheral.config.pulseWidth || 500
      peripheral.serialPort.set({ rts: true })
      setTimeout(() => {
        peripheral.serialPort.set({ rts: false })
      }, pulseWidth)
    }
  }

  async printReceipt(payload) {
    const { port, lines } = payload
    
    const peripheral = this.peripherals.get(port)
    if (!peripheral || peripheral.type !== 'printer') {
      console.error(`[HardwareAgent] Printer not found on port: ${port}`)
      return
    }
    
    // ESC/POS commands
    const ESC = 0x1B
    const GS = 0x1D
    
    const commands = []
    
    // Initialize printer
    commands.push(Buffer.from([ESC, 0x40]))
    
    // Print lines
    for (const line of lines) {
      if (line.align === 'center') {
        commands.push(Buffer.from([ESC, 0x61, 0x01])) // Center align
      }
      if (line.bold) {
        commands.push(Buffer.from([ESC, 0x45, 0x01])) // Bold on
      }
      
      commands.push(Buffer.from(line.text + '\n'))
      
      if (line.bold) {
        commands.push(Buffer.from([ESC, 0x45, 0x00])) // Bold off
      }
    }
    
    // Feed and cut
    commands.push(Buffer.from([ESC, 0x64, 0x03])) // Feed 3 lines
    commands.push(Buffer.from([GS, 0x56, 0x00])) // Cut paper
    
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
    
    // Close all peripherals
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
    
    // Close WebSocket
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

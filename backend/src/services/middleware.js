import EventEmitter from 'events'
import { SerialPort } from 'serialport'
import Peripheral from '../models/peripheral.js'

/**
 * Middleware service for communicating with peripherals via serial/other protocols
 * Handles coin acceptors, bill acceptors, card dispensers, hoppers, printers, RFID readers
 */
class Middleware extends EventEmitter {
  constructor() {
    super()
    this.connections = new Map() // peripheral._id -> connection instance
    this.subscriptions = []
  }

  /**
   * Initialize connections to all enabled peripherals
   */
  async initialize() {
    try {
      const peripherals = await Peripheral.find({ enabled: true })
      
      for (const peripheral of peripherals) {
        await this.connect(peripheral)
      }

      console.log(`Middleware initialized with ${this.connections.size} peripheral(s)`)
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
      console.error(`Failed to connect to ${peripheral.name}:`, err)
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
      })

      await new Promise((resolve, reject) => {
        port.open((err) => {
          if (err) reject(err)
          else resolve()
        })
      })

      this.connections.set(peripheral._id.toString(), { port, peripheral })
    } catch (err) {
      throw new Error(`Serial connection failed: ${err.message}`)
    }
  }

  /**
   * Connect to pulse-based peripheral (card dispenser)
   */
  async connectPulse(peripheral) {
    // Pulse connections typically use GPIO or similar
    // This is a placeholder - actual implementation depends on hardware interface
    console.log(`Pulse connection for ${peripheral.name} - implementation pending`)
    this.connections.set(peripheral._id.toString(), { type: 'pulse', peripheral })
    await this.updatePeripheralStatus(peripheral._id, 'ok')
  }

  /**
   * Connect to USB peripheral
   */
  async connectUSB(peripheral) {
    // USB connection implementation
    console.log(`USB connection for ${peripheral.name} - implementation pending`)
    this.connections.set(peripheral._id.toString(), { type: 'usb', peripheral })
    await this.updatePeripheralStatus(peripheral._id, 'ok')
  }

  /**
   * Connect to ethernet peripheral
   */
  async connectEthernet(peripheral) {
    // Ethernet connection implementation
    console.log(`Ethernet connection for ${peripheral.name} - implementation pending`)
    this.connections.set(peripheral._id.toString(), { type: 'ethernet', peripheral })
    await this.updatePeripheralStatus(peripheral._id, 'ok')
  }

  /**
   * Handle incoming data from peripheral
   */
  handleData(peripheral, data) {
    // Parse data based on peripheral type
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
      case 'rfid_reader':
        this.handleRFIDData(peripheral, data)
        break
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
    // Parse coin signals - this depends on the specific protocol (ccTalk/MDB)
    // Example: data might be a byte indicating coin value
    const coinValue = this.parseCoinValue(data)
    
    if (coinValue > 0) {
      this.emit('coin-inserted', { peripheral, value: coinValue })
      console.log(`Coin accepted: €${coinValue.toFixed(2)} from ${peripheral.name}`)
    } else if (data[0] !== 0) {
      // Coin was detected but not accepted
      this.emit('coin-rejected', { peripheral, signal: data[0] })
      console.log(`Coin rejected: signal 0x${data[0].toString(16).toUpperCase()} from ${peripheral.name}`)
    }
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
      // Bill was detected but not accepted
      this.emit('bill-rejected', { peripheral, signal: data[0] })
      console.log(`Bill rejected: signal 0x${data[0].toString(16).toUpperCase()} from ${peripheral.name}`)
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
   * Handle RFID reader data
   */
  handleRFIDData(peripheral, data) {
    const cardNumber = data.toString('utf-8').trim()
    this.emit('card-read', { peripheral, cardNumber })
    console.log(`Card read: ${cardNumber} from ${peripheral.name}`)
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
   */
  async dispenseCard(peripheralId) {
    const connection = this.connections.get(peripheralId.toString())
    
    if (!connection || connection.peripheral.type !== 'card_dispenser') {
      throw new Error('Card dispenser not available')
    }

    // Send pulse or command to dispense card
    console.log('Dispensing card...')
    this.emit('card-dispensed', { peripheral: connection.peripheral })
  }

  /**
   * Dispense change via hopper
   */
  async dispenseChange(peripheralId, amount) {
    const connection = this.connections.get(peripheralId.toString())
    
    if (!connection || connection.peripheral.type !== 'hopper') {
      throw new Error('Hopper not available')
    }

    console.log(`Dispensing €${amount.toFixed(2)} change...`)
    // Send commands to hopper to dispense coins
    this.emit('change-dispensed', { peripheral: connection.peripheral, amount })
  }

  /**
   * Print receipt
   */
  async print(peripheralId, content) {
    const connection = this.connections.get(peripheralId.toString())
    
    if (!connection || connection.peripheral.type !== 'printer') {
      throw new Error('Printer not available')
    }

    console.log('Printing receipt...')
    // Send print commands
    if (connection.port) {
      await this.send(peripheralId, Buffer.from(content))
    }
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
    const connection = this.connections.get(peripheralId.toString())
    
    if (connection && connection.port) {
      await new Promise((resolve) => {
        connection.port.close(() => resolve())
      })
    }

    this.connections.delete(peripheralId.toString())
  }

  /**
   * Disconnect all peripherals
   */
  async disconnectAll() {
    for (const [id] of this.connections) {
      await this.disconnect(id)
    }
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
}

// Create singleton instance
const middleware = new Middleware()

export default middleware

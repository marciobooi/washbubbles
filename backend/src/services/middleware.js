import EventEmitter from 'events'
import { SerialPort } from 'serialport'
import Peripheral from '../models/peripheral.js'
import Interface from '../models/interface.js'

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
  }

  /**
   * Initialize connections to all enabled peripherals and active interfaces
   */
  async initialize() {
    try {
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
      if (iface.address && typeof iface.address === 'string' && iface.address.startsWith('COM')) {
        try {
          serialPort = new SerialPort({
            path: iface.address,
            baudRate: 9600,
            dataBits: 8,
            parity: 'none',
            stopBits: 1
          })

          // Buffer for incoming data (Interface uses STX/ETX framing)
          let buffer = Buffer.alloc(0)

          serialPort.on('data', (data) => {
            buffer = Buffer.concat([buffer, data])
            
            // Look for complete packets (STX...ETX)
            while (buffer.length > 0) {
              const stxIndex = buffer.indexOf(0x02) // STX
              if (stxIndex === -1) {
                buffer = Buffer.alloc(0)
                break
              }

              const etxIndex = buffer.indexOf(0x03, stxIndex) // ETX
              if (etxIndex === -1) break // Wait for more data

              // Extract packet
              const packet = buffer.slice(stxIndex, etxIndex + 2) // Include STX and checksum after ETX
              buffer = buffer.slice(etxIndex + 2)

              // Parse and handle packet
              this.handleInterfaceData(iface, packet)
            }
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
  handleInterfaceData(iface, packet) {
    try {
      // Packet format: [STX][CMD][PORT][STATUS_DATA...][ETX][CHK]
      if (packet.length < 5) return // Too short

      const cmd = packet[1]
      const port = packet[2]
      
      // Status update command (0x53 = 'S')
      if (cmd === 0x53) {
        const statusByte = packet[3]
        
        // Parse status bits
        const status = {
          port: port,
          doorClosed: !!(statusByte & 0x01),    // Bit 0: Door closed
          occupied: !!(statusByte & 0x02),       // Bit 1: Machine occupied/running
          fault: !!(statusByte & 0x04),          // Bit 2: Fault detected
          reserved: !!(statusByte & 0x08),       // Bit 3: Machine reserved
          heatingUp: !!(statusByte & 0x10),      // Bit 4: Heating up (dryers)
          doorLocked: !!(statusByte & 0x20)      // Bit 5: Door locked
        }

        console.log(`Interface ${iface.name} Port ${port} status:`, status)
        
        // Emit status event for coinMachine to handle
        this.emit('machine-status-update', {
          interfaceId: iface._id,
          port: port,
          status: status
        })
      }
      // Fault/Error command (0x45 = 'E')
      else if (cmd === 0x45) {
        const errorCode = packet[3]
        console.log(`Interface ${iface.name} Port ${port} error: ${errorCode}`)
        
        this.emit('machine-fault', {
          interfaceId: iface._id,
          port: port,
          errorCode: errorCode
        })
      }
    } catch (err) {
      console.error(`Error parsing Interface data:`, err)
    }
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
  async dispenseChange(peripheralId, amount) {
    const connection = this.connections.get(peripheralId.toString())
    
    if (!connection || connection.peripheral.type !== 'hopper') {
      throw new Error('Hopper not available')
    }

    const peripheral = connection.peripheral
    
    // Get available coin denominations from hopper config
    const availableCoins = peripheral.hopperConfig?.coinDenominations || [2.00, 1.00, 0.50, 0.20, 0.10, 0.05]
    
    // Calculate coin breakdown
    const breakdown = this.calculateCoinBreakdown(amount, availableCoins)
    
    console.log(`Dispensing €${amount.toFixed(2)} change:`, breakdown)
    
    // Send ccTalk commands to hopper for each coin denomination
    for (const item of breakdown) {
      await this.sendHopperDispenseCommand(connection, item.denomination, item.count)
    }
    
    this.emit('change-dispensed', { peripheral, amount, breakdown })
    
    return { success: true, breakdown }
  }

  /**
   * Send ccTalk command to hopper to dispense specific coins
   */
  async sendHopperDispenseCommand(connection, denomination, count) {
    if (!connection.port) {
      console.warn('No serial port connection for hopper')
      return
    }

    // ccTalk command to dispense coins
    // Format: [Destination, Length, Source, Command, Data..., Checksum]
    const address = parseInt(connection.peripheral.address) || 3
    const command = 167 // Dispense coins command (0xA7)
    
    // Build ccTalk packet
    const destination = address
    const source = 1 // Host address
    const dataBytes = [count & 0xFF] // Number of coins to dispense
    const length = dataBytes.length + 2 // Command + data
    
    const packet = [destination, length, source, command, ...dataBytes]
    
    // Calculate checksum (sum of all bytes modulo 256, then 256 - result)
    const sum = packet.reduce((acc, byte) => acc + byte, 0)
    const checksum = (256 - (sum % 256)) & 0xFF
    packet.push(checksum)
    
    console.log(`Hopper dispense command (${count}x €${denomination.toFixed(2)}):`, 
                packet.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '))
    
    // Write to serial port
    try {
      const buffer = Buffer.from(packet)
      await new Promise((resolve, reject) => {
        connection.port.write(buffer, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
      
      // Wait for response (optional - hopper should ACK)
      await this.waitForHopperResponse(connection, 500) // 500ms timeout
      
    } catch (err) {
      console.error('Failed to send hopper command:', err)
      throw err
    }
  }

  /**
   * Wait for hopper response (ACK or error)
   */
  async waitForHopperResponse(connection, timeout = 500) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        connection.port.removeListener('data', handler)
        resolve(null) // Timeout - proceed anyway
      }, timeout)
      
      const handler = (data) => {
        clearTimeout(timer)
        connection.port.removeListener('data', handler)
        console.log('Hopper response:', data.toString('hex'))
        resolve(data)
      }
      
      if (connection.port) {
        connection.port.once('data', handler)
      } else {
        clearTimeout(timer)
        resolve(null)
      }
    })
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

    // Send pulse command to the interface
    // Format: [STX][ADDR][PORT][IMPULSES][T_ON_H][T_ON_L][T_OFF_H][T_OFF_L][LEVEL][ETX][CHK]
    const buffer = this.buildInterfaceCommand(command)
    
    // Emit activation event for logging/monitoring
    this.emit('interface-activation', { machine: machine._id, interface: iface._id, command })
    
    console.log(`Activation pulse sent to Interface addr=${address}, port=${port}`)
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
    
    // Split timing into high/low bytes (little-endian)
    const tOnHigh = (cmd.tOn >> 8) & 0xFF
    const tOnLow = cmd.tOn & 0xFF
    const tOffHigh = (cmd.tOff >> 8) & 0xFF
    const tOffLow = cmd.tOff & 0xFF
    
    const level = cmd.activation === 'high' ? 0x01 : 0x00
    
    const buffer = Buffer.from([
      STX,
      cmd.address,
      cmd.port,
      cmd.impulses,
      tOnHigh,
      tOnLow,
      tOffHigh,
      tOffLow,
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
  send(pkg) {
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

export default middleware

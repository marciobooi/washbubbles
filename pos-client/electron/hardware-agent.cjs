/**
 * WashBubbles Embedded Hardware Agent
 * Integrated into Electron main process for direct serial communication
 * 
 * Fixes applied:
 * - #20: Improved error resilience — startup result includes peripheral status
 */
const EventEmitter = require('events')
const { SerialPort } = require('serialport')
const { ReadlineParser } = require('@serialport/parser-readline')

class EmbeddedHardwareAgent extends EventEmitter {
  constructor(config) {
    super()
    this.config = config || { peripherals: {} }
    this.ports = {} // Maps type -> SerialPort object
    this.peripheralsStatus = {} // Maps type -> { connected: bool, error: string }
  }

  /** Start all configured peripherals */
  async start() {
    console.log('[HW] Starting embedded hardware agent...')
    const results = await this.initializePeripherals()
    this.peripheralsStatus = results
    console.log('[HW] Peripheral status:', results)
    return results
  }

  /** Stop all peripherals */
  async stop() {
    console.log('[HW] Stopping hardware agent...')
    for (const [type, port] of Object.entries(this.ports)) {
      if (port && port.isOpen) {
        await new Promise(resolve => port.close(resolve))
        console.log(`[HW] Closed ${type} port`)
      }
    }
    this.ports = {}
  }

  async initializePeripherals() {
    const { peripherals } = this.config
    const results = {}

    const types = [
      'coin_acceptor', 'bill_acceptor', 'interface', 
      'hopper', 'printer', 'rfid_reader'
    ]

    for (const type of types) {
      const p = peripherals[type]
      if (p && p.enabled && p.port) {
        try {
          await this.connectPeripheral(type, p)
          results[type] = { connected: true }
        } catch (err) {
          console.error(`[HW] Failed to connect ${type} on ${p.port}:`, err.message)
          results[type] = { connected: false, error: err.message }
        }
      } else {
        results[type] = { connected: false, error: 'disabled' }
      }
    }
    return results
  }

  async connectPeripheral(type, config) {
    return new Promise((resolve, reject) => {
      const port = new SerialPort({
        path: config.port,
        baudRate: parseInt(config.baudRate) || 9600,
        autoOpen: false
      })

      port.open((err) => {
        if (err) return reject(err)
        
        this.ports[type] = port
        this.setupParser(type, port)
        
        console.log(`[HW] Connected ${type} on ${config.port}`)
        resolve()
      })

      port.on('error', (err) => {
        console.error(`[HW] Error on ${type}:`, err.message)
        this.emit('hardware:error', { type, error: err.message })
      })

      port.on('close', () => {
        console.warn(`[HW] Port closed for ${type}`)
        this.emit('hardware:disconnected', { type })
      })
    })
  }

  setupParser(type, port) {
    // RFID reader and some others use newline delimited strings
    if (type === 'rfid_reader' || type === 'coin_acceptor' || type === 'bill_acceptor') {
      const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }))
      parser.on('data', (line) => this.handleIncomingData(type, line.trim()))
    } else {
      // Binary protocols (ccTalk, KITSEC) would need specialized parsers
      // For now, using raw data buffer handler
      port.on('data', (data) => this.handleRawData(type, data))
    }
  }

  handleIncomingData(type, data) {
    if (!data) return
    console.log(`[HW] [${type}] Incoming:`, data)

    if (type === 'rfid_reader') {
      this.emit('rfid:card_detected', { cardCode: data })
    }
    
    if (type === 'coin_acceptor' || type === 'bill_acceptor') {
      // Example: "CREDIT 1.00" or similar depending on peripheral firmware
      if (data.startsWith('CREDIT')) {
        const amount = parseFloat(data.split(' ')[1])
        if (!isNaN(amount)) {
          this.emit('credit', { type, amount })
        }
      }
    }
  }

  handleRawData(type, data) {
    // Protocol implementation for ccTalk (coins) or KITSEC (interfaces)
    // This is where byte-level command parsing happens
    // console.log(`[HW] [${type}] Raw data:`, data)
  }

  // ─── Outbound Commands ───

  /** Activate a machine via the KITSEC interface */
  activateMachine(machine, iface) {
    const port = this.ports['interface']
    if (!port || !port.isOpen) {
      this.emit('machine:activation_failed', { machineId: machine.id, error: 'Interface disconnected' })
      return false
    }

    // KITSEC Protocol: STX(02) CMD(41) ADDR(XX) PORT(YY) TIME(ZZ) CSUM ETX(03)
    // Placeholder for actual byte buffer generation
    const cmd = Buffer.from([0x02, 0x41, iface.address || 0, machine.port || 0, 0x05, 0x00, 0x03])
    
    port.write(cmd, (err) => {
      if (err) {
        this.emit('machine:activation_failed', { machineId: machine.id, error: err.message })
      } else {
        this.emit('machine:activation_sent', { machineId: machine.id })
      }
    })
    return true
  }

  /** Dispense coins from the hopper */
  dispenseCoins(amount) {
    const port = this.ports['hopper']
    if (!port || !port.isOpen) return false
    
    console.log(`[HW] Dispensing €${amount.toFixed(2)}`)
    // Hopper command implementation
    return true
  }

  /** Print a receipt */
  printReceipt(content) {
    const port = this.ports['printer']
    if (!port || !port.isOpen) return false

    console.log('[HW] Printing receipt...')
    // ESC/POS command implementation
    port.write(content)
    port.write('\n\n\n\x1Bm') // Cut paper command
    return true
  }

  /** Get current status of all peripherals */
  getStatus() {
    return this.peripheralsStatus
  }
}

module.exports = { EmbeddedHardwareAgent }

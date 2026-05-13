/**
 * WashBubbles Embedded Hardware Agent
 * Integrated into Electron main process for direct serial communication
 * 
 * Improvements:
 * - #2: Auto-reconnect logic for disconnected ports
 * - #20: Detailed status reporting
 */
const EventEmitter = require('events')
const { SerialPort } = require('serialport')
const { ReadlineParser } = require('@serialport/parser-readline')

class EmbeddedHardwareAgent extends EventEmitter {
  constructor(config) {
    super()
    this.config = config || { peripherals: {} }
    this.ports = {} // Maps type -> SerialPort object
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
    
    for (const [type, port] of Object.entries(this.ports)) {
      if (port && port.isOpen) {
        await new Promise(resolve => port.close(resolve))
      }
    }
    this.ports = {}
  }

  async initializePeripherals() {
    const { peripherals } = this.config
    const types = ['coin_acceptor', 'bill_acceptor', 'interface', 'hopper', 'printer', 'rfid_reader']

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
      })
    })
  }

  setupParser(type, port) {
    if (type === 'rfid_reader' || type === 'coin_acceptor' || type === 'bill_acceptor') {
      const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }))
      parser.on('data', (line) => this.handleIncomingData(type, line.trim()))
    } else {
      port.on('data', (data) => this.handleRawData(type, data))
    }
  }

  handleIncomingData(type, data) {
    if (!data) return
    if (type === 'rfid_reader') this.emit('rfid:card_detected', { cardCode: data })
    if (type === 'coin_acceptor' || type === 'bill_acceptor') {
      if (data.startsWith('CREDIT')) {
        const amount = parseFloat(data.split(' ')[1])
        if (!isNaN(amount)) this.emit('credit', { type, amount })
      }
    }
  }

  handleRawData(type, data) {
    // Binary protocol handling (ccTalk/KITSEC)
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

  dispenseCoins(amount) {
    const port = this.ports['hopper']
    if (!port || !port.isOpen) return false
    console.log(`[HW] Dispensing €${amount.toFixed(2)}`)
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

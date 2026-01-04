import EventEmitter from 'events'
import middleware from './middleware.js'
import Client from './client.js'
import Setting from '../models/setting.js'
import Machine from '../models/machine.js'
import Interface from '../models/interface.js'
import { broadcastMachine } from '../wsServer.js'

/**
 * CoinMachine coordinator - integrates middleware, client state, and backend API
 * Based on the coin-machine module from the old program
 */
class CoinMachine extends EventEmitter {
  constructor(options = {}) {
    super()
    
    this.middleware = options.middleware || middleware
    this.client = new Client()
    this.settings = null
    this.running = false
    this.subscriptions = []
    this.machines = new Map() // Track machine states
  }

  /**
   * Start the coin machine system
   */
  async start() {
    if (this.running) {
      console.log('CoinMachine already running')
      return
    }

    try {
      console.log('Starting CoinMachine...')
      
      // Load settings
      await this.loadSettings()
      
      // Initialize middleware connections
      await this.middleware.initialize()
      
      // Set up event handlers
      this.setupEventHandlers()
      
      this.running = true
      this.emit('started')
      
      console.log('CoinMachine started successfully')
    } catch (err) {
      console.error('Failed to start CoinMachine:', err)
      throw err
    }
  }

  /**
   * Stop the coin machine system
   */
  async stop() {
    if (!this.running) {
      return
    }

    console.log('Stopping CoinMachine...')
    
    // Save any pending card data
    await this.client.saveCardBalance()
    
    // Disconnect all peripherals
    await this.middleware.disconnectAll()
    
    // Clean up subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe())
    this.subscriptions = []
    
    this.running = false
    this.emit('stopped')
    
    console.log('CoinMachine stopped')
  }

  /**
   * Load app settings (coin/bill equivalence tables, bonuses, auto-charge)
   */
  async loadSettings() {
    try {
      const coinEqSetting = await Setting.findOne({ key: 'coinEqTable' })
      const billEqSetting = await Setting.findOne({ key: 'billEqTable' })
      const rechargeCoinBonus = await Setting.findOne({ key: 'rechargeCoinBonus' })
      const rechargeBillBonus = await Setting.findOne({ key: 'rechargeBillBonus' })
      const autoCharge = await Setting.findOne({ key: 'autoCharge' })
      
      this.settings = {
        coinEqTable: coinEqSetting?.value || [],
        billEqTable: billEqSetting?.value || [],
        rechargeCoinBonus: rechargeCoinBonus?.value || 0,
        rechargeBillBonus: rechargeBillBonus?.value || 0,
        autoCharge: autoCharge?.value || false
      }
      
      console.log('Loaded coin/bill equivalence tables')
    } catch (err) {
      console.warn('Failed to load settings, using defaults:', err)
      this.settings = {
        coinEqTable: [],
        billEqTable: [],
        rechargeCoinBonus: 0,
        rechargeBillBonus: 0,
        autoCharge: false
      }
    }
  }

  /**
   * Set up event handlers for middleware events
   */
  setupEventHandlers() {
    // Coin inserted
    const coinSub = this.middleware.subscribe('coin-inserted', (data) => {
      this.handleCoinInserted(data)
    })
    this.subscriptions.push(coinSub)

    // Bill inserted
    const billSub = this.middleware.subscribe('bill-inserted', (data) => {
      this.handleBillInserted(data)
    })
    this.subscriptions.push(billSub)

    // Card read
    const cardSub = this.middleware.subscribe('card-read', (data) => {
      this.handleCardRead(data)
    })
    this.subscriptions.push(cardSub)

    // Card dispensed
    const dispenseSub = this.middleware.subscribe('card-dispensed', (data) => {
      this.handleCardDispensed(data)
    })
    this.subscriptions.push(dispenseSub)

    // Remote credits
    const remoteSub = this.middleware.subscribe('remote-credits', (data) => {
      this.handleRemoteCredits(data)
    })
    this.subscriptions.push(remoteSub)

    // Card removed
    const cardRemoveSub = this.middleware.subscribe('card-removed', () => {
      this.handleCardRemoved()
    })
    this.subscriptions.push(cardRemoveSub)

    // Machine events
    const machineStartedSub = this.middleware.subscribe('machine-started', (data) => {
      this.handleMachineStarted(data)
    })
    this.subscriptions.push(machineStartedSub)

    const machineReservedSub = this.middleware.subscribe('machine-reserved', (data) => {
      this.handleMachineReserved(data)
    })
    this.subscriptions.push(machineReservedSub)

    const machineIssueSub = this.middleware.subscribe('machine-issue', (data) => {
      this.handleMachineIssue(data)
    })
    this.subscriptions.push(machineIssueSub)

    const statusIntSub = this.middleware.subscribe('status_int', (data) => {
      this.handleStatusInt(data)
    })
    this.subscriptions.push(statusIntSub)

    // Interface machine status updates (door, occupied, fault, etc.)
    const machineStatusSub = this.middleware.subscribe('machine-status-update', (data) => {
      this.handleMachineStatusUpdate(data)
    })
    this.subscriptions.push(machineStatusSub)

    const machineFaultSub = this.middleware.subscribe('machine-fault', (data) => {
      this.handleMachineFault(data)
    })
    this.subscriptions.push(machineFaultSub)
  }

  /**
   * Handle coin insertion
   */
  handleCoinInserted(data) {
    const { value } = data
    
    // Apply equivalence table mapping if configured
    const mappedValue = this.applyCoinEquivalence(value)
    
    // Calculate bonus
    let bonusValue = 0
    if (this.settings.rechargeCoinBonus > 0) {
      bonusValue = (mappedValue * this.settings.rechargeCoinBonus) / 100
      this.client.client.bonusArr.push(bonusValue)
      this.client.client.bonus += bonusValue
    }

    // Auto-charge logic
    if (this.settings.autoCharge && this.client.client.hasCard) {
      this.client.client.moneyArr.push(mappedValue)
      this.client.client.chargedArr.push(mappedValue + bonusValue)
    }
    
    this.client.addToBalance(mappedValue)
    this.emit('coin-inserted', { 
      value: mappedValue, 
      bonus: bonusValue,
      balance: this.client.getState().balance 
    })
    
    console.log(`Coin inserted: €${mappedValue.toFixed(2)}${bonusValue > 0 ? ` + €${bonusValue.toFixed(2)} bonus` : ''}, Total: €${this.client.getState().credits.toFixed(2)}`)
  }

  /**
   * Handle bill insertion
   */
  handleBillInserted(data) {
    const { value } = data
    
    // Apply equivalence table mapping if configured
    const mappedValue = this.applyBillEquivalence(value)
    
    // Calculate bonus
    let bonusValue = 0
    if (this.settings.rechargeBillBonus > 0) {
      bonusValue = (mappedValue * this.settings.rechargeBillBonus) / 100
      this.client.client.bonusArr.push(bonusValue)
      this.client.client.bonus += bonusValue
    }

    // Auto-charge logic
    if (this.settings.autoCharge && this.client.client.hasCard) {
      this.client.client.moneyArr.push(mappedValue)
      this.client.client.chargedArr.push(mappedValue + bonusValue)
    }
    
    this.client.addToBalance(mappedValue)
    this.emit('bill-inserted', { 
      value: mappedValue,
      bonus: bonusValue, 
      balance: this.client.getState().balance 
    })
    
    console.log(`Bill inserted: €${mappedValue.toFixed(2)}${bonusValue > 0 ? ` + €${bonusValue.toFixed(2)} bonus` : ''}, Total: €${this.client.getState().credits.toFixed(2)}`)
  }

  /**
   * Handle remote credits from backend/admin
   */
  handleRemoteCredits(data) {
    // Remote credits data is in cents, convert to euros
    const value = data.value ? Math.round(Number(data.value)) / 100 : 0
    
    this.client.client.credits = value
    this.client.addToBalance(value)
    
    // Send acknowledgment back to middleware
    this.middleware.send({ op: 'remote-credits-res', data: value.toString() })
    
    this.emit('remote-credits', { value, balance: this.client.getState().balance })
    console.log(`Remote credits received: €${value.toFixed(2)}`)
  }

  /**
   * Handle card removed event
   */
  async handleCardRemoved() {
    await this.client.resetCardInfo()
    this.emit('card-removed')
    console.log('Card removed')
  }

  /**
   * Handle card read
   */
  async handleCardRead(data) {
    
    // Apply equivalence table mapping if configured
    const mappedValue = this.applyBillEquivalence(value)
    
    this.client.addToBalance(mappedValue)
    this.emit('bill-inserted', { value: mappedValue, balance: this.client.getState().balance })
    
    console.log(`Bill inserted: €${mappedValue.toFixed(2)}, Total: €${this.client.getState().credits.toFixed(2)}`)
  }

  /**
   * Handle card read
   */
  async handleCardRead(data) {
    const { cardNumber } = data
    
    const loaded = await this.client.setClientInfoByCard(cardNumber)
    
    if (loaded) {
      this.emit('card-loaded', { client: this.client.getState() })
      console.log(`Card loaded: ${cardNumber}, Balance: €${this.client.getState().balanceCard.toFixed(2)}`)
    } else {
      this.emit('card-invalid', { cardNumber })
      console.warn(`Invalid card: ${cardNumber}`)
    }
  }

  /**
   * Handle card dispensed
   */
  handleCardDispensed(data) {
    this.emit('card-dispensed', data)
    console.log('Card dispensed successfully')
  }

  /**
   * Apply coin equivalence table
   */
  applyCoinEquivalence(value) {
    if (!this.settings.coinEqTable || this.settings.coinEqTable.length === 0) {
      return value
    }

    const mapping = this.settings.coinEqTable.find(entry => entry.key === value.toString())
    return mapping ? mapping.value : value
  }

  /**
   * Apply bill equivalence table
   */
  applyBillEquivalence(value) {
    if (!this.settings.billEqTable || this.settings.billEqTable.length === 0) {
      return value
    }

    const mapping = this.settings.billEqTable.find(entry => entry.key === value.toString())
    return mapping ? mapping.value : value
  }

  /**
   * Process payment for a machine
   */
  async processPayment(machineId, amount, paymentType = 'auto') {
    try {
      const clientState = this.client.getState()

      // Determine payment source
      let useCard = false
      if (paymentType === 'card') {
        useCard = true
      } else if (paymentType === 'cash') {
        useCard = false
      } else {
        // Auto: prefer card if available
        useCard = clientState.hasCard && clientState.balanceCard >= amount
      }

      // Check if sufficient funds
      if (clientState.credits < amount) {
        throw new Error('Insufficient credits')
      }

      // Deduct credits
      this.client.deductCredits(amount)

      // Save card balance if card was used
      if (useCard && clientState.hasCard) {
        await this.client.saveCardBalance()
      }

      this.emit('payment-processed', {
        machineId,
        amount,
        paymentType: useCard ? 'card' : 'cash',
        remainingBalance: this.client.getState().credits
      })

      return {
        success: true,
        paymentType: useCard ? 'card' : 'cash',
        remainingBalance: this.client.getState().credits
      }
    } catch (err) {
      console.error('Payment processing failed:', err)
      throw err
    }
  }

  /**
   * Dispense card with initial balance
   */
  async dispenseNewCard(cardDispenserId, initialBalance = 0) {
    try {
      await this.middleware.dispenseCard(cardDispenserId)
      
      // TODO: Write initial balance to card via RFID
      
      this.emit('new-card-dispensed', { initialBalance })
      
      return { success: true }
    } catch (err) {
      console.error('Failed to dispense card:', err)
      throw err
    }
  }

  /**
   * Dispense change
   */
  async dispenseChange(hopperId, amount) {
    try {
      await this.middleware.dispenseChange(hopperId, amount)
      
      this.emit('change-dispensed', { amount })
      
      return { success: true }
    } catch (err) {
      console.error('Failed to dispense change:', err)
      throw err
    }
  }

  /**
   * Print receipt
   */
  async printReceipt(printerId, content) {
    try {
      await this.middleware.print(printerId, content)
      
      this.emit('receipt-printed')
      
      return { success: true }
    } catch (err) {
      console.error('Failed to print receipt:', err)
      throw err
    }
  }

  /**
   * Activate machine(s) with specified configuration
   * Based on old code: [{id: intId, chn: channel, impulses: '1'}]
   * Now integrates with Interface hardware for actual pulse control
   */
  async activateMachine(activationData) {
    try {
      const dataArray = Array.isArray(activationData) ? activationData : [activationData]
      
      // Process each machine activation
      for (const act of dataArray) {
        let machine
        
        // Find machine by intId (from old code) or MongoDB _id
        if (act.id) {
          machine = await Machine.findOne({ intId: act.id }).populate('interfaceId')
        } else if (act.machineId) {
          machine = await Machine.findById(act.machineId).populate('interfaceId')
        }
        
        if (!machine) {
          console.warn(`Machine not found: ${act.id || act.machineId}`)
          continue
        }

        // VALIDATION: Machine must have a program selected
        if (!machine.currentProgram) {
          throw new Error(`Machine ${machine.name} has no program selected. Please select a program first.`)
        }

        // VALIDATION: Machine must be reserved (payment successful)
        if (machine.status !== 'reserved') {
          throw new Error(`Machine ${machine.name} is not reserved. Status: ${machine.status}. Payment must be completed before activation.`)
        }

        // VALIDATION: Machine must have been paid for
        if (!machine.reserved || !machine.reservedBy) {
          throw new Error(`Machine ${machine.name} payment not verified. Please complete payment first.`)
        }

        // Check if machine has interface configured
        if (!machine.interfaceId || !machine.port) {
          console.warn(`Machine ${machine.name} has no interface/port configured`)
          // Fall back to old-style activation
          await this.middleware.activateMachine(act)
          continue
        }

        // Load interface if not populated
        const machineInterface = machine.interfaceId._id ? machine.interfaceId : await Interface.findById(machine.interfaceId)
        
        if (!machineInterface) {
          console.warn(`Interface not found for machine ${machine.name}`)
          continue
        }

        // Check if interface is active
        if (machineInterface.status !== 'active') {
          throw new Error(`Interface ${machineInterface.name} is not active (status: ${machineInterface.status})`)
        }

        // Send activation through interface hardware
        await this.middleware.sendMachineActivation(machine, machineInterface)
        
        // Update machine status in database
        machine.status = 'working'
        machine.startedAt = new Date()
        await machine.save()
        
        this.machines.set(machine.intId || machine._id, {
          ...machine.toObject(),
          activatedAt: new Date()
        })

        console.log(`Machine ${machine.name} activated via Interface ${machineInterface.name} (addr=${machineInterface.address}, port=${machine.port})`)
      }
      
      this.emit('machines-activated', activationData)
      return { success: true }
    } catch (err) {
      console.error('Failed to activate machine:', err)
      throw err
    }
  }

  /**
   * Handle machine-started event from low-level device
   */
  async handleMachineStarted(data) {
    const { id, chn } = data
    console.log(`Machine started: id=${id}, channel=${chn}`)
    
    try {
      const machine = await Machine.findOne({ intId: id })
      if (machine) {
        machine.status = 'working'
        machine.reserved = false
        machine.startedAt = new Date()
        await machine.save()
        
        this.machines.set(id, machine.toObject())
        this.emit('machine-started', { machine: machine.toObject() })
        
        // Broadcast to WebSocket clients
        await broadcastMachine(machine)
      }
    } catch (err) {
      console.error('Error handling machine-started:', err)
    }
  }

  /**
   * Handle machine-reserved event
   */
  async handleMachineReserved(data) {
    const { id, duration } = data
    console.log(`Machine reserved: id=${id}, duration=${duration}`)
    
    try {
      const machine = await Machine.findOne({ intId: id })
      if (machine) {
        machine.status = 'reserved'
        machine.reserved = true
        machine.reservedAt = new Date()
        machine.reservationDuration = duration || 5
        await machine.save()
        
        this.machines.set(id, machine.toObject())
        this.emit('machine-reserved', { machine: machine.toObject() })
        
        // Broadcast to WebSocket clients
        await broadcastMachine(machine)
      }
    } catch (err) {
      console.error('Error handling machine-reserved:', err)
    }
  }

  /**
   * Handle machine-issue event (fault detected)
   */
  async handleMachineIssue(data) {
    const { id, issue } = data
    console.log(`Machine issue: id=${id}, issue=${issue}`)
    
    try {
      const machine = await Machine.findOne({ intId: id })
      if (machine) {
        machine.status = 'fault'
        machine.statusText = issue || 'Unknown fault'
        await machine.save()
        
        this.machines.set(id, machine.toObject())
        this.emit('machine-issue', { machine: machine.toObject(), issue })
        
        // Broadcast to WebSocket clients
        await broadcastMachine(machine)
      }
    } catch (err) {
      console.error('Error handling machine-issue:', err)
    }
  }

  /**
   * Handle status_int event (status update from low-level)
   */
  async handleStatusInt(data) {
    // data contains machine status updates
    console.log('Status update:', data)
    this.emit('status-update', data)
    
    // Update machine statuses in database
    try {
      if (Array.isArray(data.machines)) {
        for (const machineData of data.machines) {
          const machine = await Machine.findOne({ intId: machineData.id })
          if (machine && machineData.status) {
            // Map low-level status to our status enum
            const statusMap = {
              'idle': 'free',
              'running': 'working',
              'reserved': 'reserved',
              'fault': 'fault',
              'offline': 'offline'
            }
            
            machine.status = statusMap[machineData.status] || 'offline'
            await machine.save()
            
            this.machines.set(machineData.id, machine.toObject())
            
            // Broadcast individual machine update
            await broadcastMachine(machine)
          }
        }
      }
    } catch (err) {
      console.error('Error handling status_int:', err)
    }
  }

  /**
   * Get machine states
   */
  getMachineStates() {
    return Array.from(this.machines.values())
  }

  /**
   * Get specific machine state
   */
  getMachineState(machineId) {
    return this.machines.get(machineId)
  }

  /**
   * Get current client state
   */
  getClientState() {
    return this.client.getState()
  }

  /**
   * Reset client session
   */
  resetClient() {
    this.client.reset()
    this.emit('client-reset')
  }

  /**
   * Remove card but keep cash balance
   */
  removeCard() {
    this.client.resetCardInfo()
    this.emit('card-removed')
  }

  /**
   * Handle machine status update from Interface hardware
   * Receives door status, occupied status, etc.
   */
  async handleMachineStatusUpdate(data) {
    const { interfaceId, port, status } = data
    
    try {
      // Find machine by interface and port
      const machine = await Machine.findOne({
        interfaceId: interfaceId,
        port: port
      })

      if (!machine) {
        console.warn(`No machine found for Interface ${interfaceId} Port ${port}`)
        return
      }

      console.log(`Machine ${machine.name} status update:`, status)

      // Update machine status based on hardware signals
      let machineStatus = machine.status
      let statusText = ''

      if (status.fault) {
        machineStatus = 'fault'
        statusText = 'Hardware fault detected'
      } else if (status.occupied || status.doorLocked) {
        machineStatus = 'working'
        statusText = status.doorClosed ? 'Running - Door closed' : 'Running - Door open'
      } else if (!status.doorClosed) {
        statusText = 'Door open'
        // Don't change status, just update text
      } else if (status.doorClosed && machineStatus === 'working') {
        // Machine finished - door closed and not occupied
        machineStatus = 'free'
        statusText = 'Available'
        machine.currentProgram = null
        machine.reserved = false
        machine.reservedBy = null
        machine.startedAt = null
      }

      // Update machine
      machine.status = machineStatus
      machine.statusText = statusText
      await machine.save()

      // Update cache
      this.machines.set(machine.intId || machine._id, machine.toObject())

      // Broadcast update via WebSocket
      await broadcastMachine(machine)

      this.emit('machine-status-changed', {
        machine: machine.toObject(),
        hardwareStatus: status
      })
    } catch (err) {
      console.error('Error handling machine status update:', err)
    }
  }

  /**
   * Handle machine fault from Interface hardware
   */
  async handleMachineFault(data) {
    const { interfaceId, port, errorCode } = data
    
    try {
      // Find machine by interface and port
      const machine = await Machine.findOne({
        interfaceId: interfaceId,
        port: port
      })

      if (!machine) {
        console.warn(`No machine found for Interface ${interfaceId} Port ${port}`)
        return
      }

      console.error(`Machine ${machine.name} fault - Error code: ${errorCode}`)

      // Update machine status to fault
      machine.status = 'fault'
      machine.statusText = `Error ${errorCode}`
      await machine.save()

      // Update cache
      this.machines.set(machine.intId || machine._id, machine.toObject())

      // Broadcast update via WebSocket
      await broadcastMachine(machine)

      this.emit('machine-fault-detected', {
        machine: machine.toObject(),
        errorCode: errorCode
      })
    } catch (err) {
      console.error('Error handling machine fault:', err)
    }
  }
}

// Create singleton instance
const coinMachine = new CoinMachine()

export { CoinMachine }
export default coinMachine

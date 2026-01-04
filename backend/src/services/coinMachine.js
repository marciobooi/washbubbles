import EventEmitter from 'events'
import middleware from './middleware.js'
import Client from './client.js'
import Setting from '../models/setting.js'

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
   * Load app settings (coin/bill equivalence tables)
   */
  async loadSettings() {
    try {
      const coinEqSetting = await Setting.findOne({ key: 'coinEqTable' })
      const billEqSetting = await Setting.findOne({ key: 'billEqTable' })
      
      this.settings = {
        coinEqTable: coinEqSetting?.value || [],
        billEqTable: billEqSetting?.value || []
      }
      
      console.log('Loaded coin/bill equivalence tables')
    } catch (err) {
      console.warn('Failed to load settings, using defaults:', err)
      this.settings = {
        coinEqTable: [],
        billEqTable: []
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
  }

  /**
   * Handle coin insertion
   */
  handleCoinInserted(data) {
    const { value } = data
    
    // Apply equivalence table mapping if configured
    const mappedValue = this.applyCoinEquivalence(value)
    
    this.client.addToBalance(mappedValue)
    this.emit('coin-inserted', { value: mappedValue, balance: this.client.getState().balance })
    
    console.log(`Coin inserted: €${mappedValue.toFixed(2)}, Total: €${this.client.getState().credits.toFixed(2)}`)
  }

  /**
   * Handle bill insertion
   */
  handleBillInserted(data) {
    const { value } = data
    
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
}

// Create singleton instance
const coinMachine = new CoinMachine()

export { CoinMachine }
export default coinMachine

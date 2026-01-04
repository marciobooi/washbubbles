import EventEmitter from 'events'
import Card from '../models/card.js'

/**
 * Client state manager - handles user/card balance, credits, and bonus points
 * Based on the coin-machine Client class
 */
class Client extends EventEmitter {
  constructor() {
    super()
    
    this.client = {
      name: null,
      addr: null,
      cardNumber: null,
      nif: null,
      balance: 0,           // Cash balance (coins/bills inserted)
      balanceCard: 0,       // Card balance
      bonus: 0,             // Bonus points
      credits: 0,           // Total credits available
      admin: false,
      hasCard: false,
      initBalance: 0
    }

    this.clientStream = []
  }

  /**
   * Reset all client data
   */
  reset() {
    this.client = {
      name: null,
      addr: null,
      cardNumber: null,
      nif: null,
      balance: 0,
      balanceCard: 0,
      bonus: 0,
      credits: 0,
      admin: false,
      hasCard: false,
      initBalance: 0
    }
    
    this.notifySubscribers()
    this.emit('reset')
  }

  /**
   * Reset card-specific info but keep cash balance
   */
  resetCardInfo() {
    this.client.name = null
    this.client.addr = null
    this.client.cardNumber = null
    this.client.nif = null
    this.client.balanceCard = 0
    this.client.bonus = 0
    this.client.admin = false
    this.client.hasCard = false
    
    this.updateCredits()
    this.notifySubscribers()
    this.emit('card-removed')
  }

  /**
   * Add cash to balance
   */
  addToBalance(value) {
    this.client.balance += value
    this.updateCredits()
    this.notifySubscribers()
    this.emit('balance-updated', { balance: this.client.balance, credits: this.client.credits })
  }

  /**
   * Set client info from card data
   */
  async setClientInfoByCard(cardNumber) {
    try {
      const card = await Card.findOne({ code: cardNumber })
      
      if (!card) {
        console.warn(`Card ${cardNumber} not found`)
        return false
      }

      this.client.cardNumber = cardNumber
      this.client.name = card.ownerName || null
      this.client.balanceCard = card.balance || 0
      this.client.bonus = card.bonus || 0
      this.client.hasCard = true
      this.client.initBalance = card.balance || 0
      
      this.updateCredits()
      this.notifySubscribers()
      this.emit('card-loaded', { card: this.client })
      
      return true
    } catch (err) {
      console.error('Failed to load card info:', err)
      return false
    }
  }

  /**
   * Deduct credits for a purchase
   */
  deductCredits(amount) {
    if (this.client.credits < amount) {
      throw new Error('Insufficient credits')
    }

    // Deduct from card balance first, then cash balance
    if (this.client.balanceCard >= amount) {
      this.client.balanceCard -= amount
    } else {
      const remainingAfterCard = amount - this.client.balanceCard
      this.client.balanceCard = 0
      this.client.balance -= remainingAfterCard
    }

    this.updateCredits()
    this.notifySubscribers()
    this.emit('credits-deducted', { amount, remaining: this.client.credits })
  }

  /**
   * Add bonus points
   */
  addBonus(points) {
    this.client.bonus += points
    this.notifySubscribers()
    this.emit('bonus-added', { bonus: this.client.bonus })
  }

  /**
   * Save card balance back to database
   */
  async saveCardBalance() {
    if (!this.client.hasCard || !this.client.cardNumber) {
      return
    }

    try {
      await Card.findOneAndUpdate(
        { code: this.client.cardNumber },
        { 
          balance: this.client.balanceCard,
          bonus: this.client.bonus
        }
      )
      
      this.emit('card-saved')
    } catch (err) {
      console.error('Failed to save card balance:', err)
    }
  }

  /**
   * Calculate total credits available
   */
  updateCredits() {
    this.client.credits = this.client.balance + this.client.balanceCard
  }

  /**
   * Subscribe to client state changes
   */
  subscribe(callback) {
    this.clientStream.push(callback)
    
    // Immediately notify with current state
    callback(this.client)
    
    return {
      unsubscribe: () => {
        const index = this.clientStream.indexOf(callback)
        if (index > -1) {
          this.clientStream.splice(index, 1)
        }
      }
    }
  }

  /**
   * Notify all subscribers of state changes
   */
  notifySubscribers() {
    this.clientStream.forEach(callback => {
      callback(this.client)
    })
  }

  /**
   * Get current client state
   */
  getState() {
    return { ...this.client }
  }

  /**
   * Get balance summary
   */
  getBalanceSummary() {
    return {
      cash: this.client.balance,
      card: this.client.balanceCard,
      bonus: this.client.bonus,
      total: this.client.credits
    }
  }
}

export default Client

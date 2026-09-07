import EventEmitter from 'events'
import Card from '../models/card.js'
import { roundMoney } from '../utils/money.js'

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
      initBalance: 0,
      // Auto-charge tracking arrays
      bonusArr: [],         // Bonus values accumulated
      chargedArr: [],       // Charges to be recorded
      moneyArr: []          // Money values accumulated
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
      initBalance: 0,
      bonusArr: [],
      chargedArr: [],
      moneyArr: []
    }
    
    this.notifySubscribers()
    this.emit('reset')
  }

  /**
   * Reset card-specific info but keep cash balance
   */
  async resetCardInfo() {
    const cardNumber = this.client.cardNumber

    // Persist whatever is left on the card BEFORE wiping the in-memory copy.
    // `deductCredits` always drains balanceCard first, but the save was skipped
    // on cash-mode payments — so this method zeroed a spent-down balance that had
    // never been written back, and the card kept its original DB value. That is
    // unlimited free washes: pay by "cash", card balance never actually drops.
    await this.saveCardBalance()

    this.client.name = null
    this.client.addr = null
    this.client.cardNumber = null
    this.client.nif = null
    this.client.balanceCard = 0
    this.client.admin = false
    this.client.hasCard = false

    // Send charge request before clearing arrays
    await this.sendChargeRequest(cardNumber)

    this.client.bonus = 0
    this.updateCredits()
    this.notifySubscribers()
    this.emit('card-removed')
  }

  /**
   * Send charge request for accumulated charges (auto-charge)
   */
  async sendChargeRequest(cardNumber) {
    // Transfer only what the customer did NOT spend.
    //
    // Previously every coin was pushed into `chargedArr` at insertion time AND
    // made immediately spendable by `addToBalance`. Insert €5 → €5 to spend now
    // *and* €5 added to the card on removal. The house lost the difference on
    // every single insertion. Cash goes to the session; the leftover follows the
    // customer onto their card — the same rule the kiosk already applies in
    // `pos-engine.removeCard`.
    const unspent = roundMoney((this.client.balance || 0) + (this.client.bonus || 0))

    if (!cardNumber || unspent <= 0) {
      this.client.bonusArr = []
      this.client.chargedArr = []
      this.client.moneyArr = []
      return
    }

    try {
      // Atomic: a concurrent operation on this card must not be overwritten.
      const card = await Card.findOneAndUpdate(
        { code: cardNumber },
        { $inc: { balance: unspent }, $set: { updatedAt: new Date() } },
        { new: true }
      )
      if (card) {
        // The cash has moved onto the card, so it is no longer session cash.
        this.client.balance = 0
        this.client.bonus = 0
        this.updateCredits()
        console.log(`Auto-charge: Added €${unspent.toFixed(2)} to card ${cardNumber}`)
        this.emit('auto-charge', { cardNumber, amount: unspent, balance: card.balance })
      } else {
        console.error(`Auto-charge failed: card ${cardNumber} not found — €${unspent.toFixed(2)} still in session`)
      }
    } catch (err) {
      console.error('Failed to send charge request:', err)
    } finally {
      this.client.bonusArr = []
      this.client.chargedArr = []
      this.client.moneyArr = []
    }
  }

  /**
   * Add cash to balance
   */
  addToBalance(value) {
    this.client.balance = roundMoney(this.client.balance + Number(value))
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
      this.client.name = card.name || null
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
  deductCredits(rawAmount) {
    const amount = roundMoney(rawAmount)
    if (roundMoney(this.client.credits) + 0.005 < amount) {
      throw new Error('Insufficient credits')
    }

    // Coins and card balance are ONE pot: a customer with €3 on the card who
    // feeds in €2 can buy a €5 wash. `credits` is the sum of both, and a purchase
    // draws on whatever it needs.
    //
    // Session cash is spent FIRST, card balance second. The end state is the same
    // either way, but taking the cash first means fewer writes to the card — and
    // every card write is a chance to fail, and an offline sync delta to reconcile
    // later. Cash already sitting in the machine needs no such round trip.
    const fromCash = Math.min(roundMoney(this.client.balance), amount)
    const fromCard = roundMoney(amount - fromCash)

    this.client.balance = roundMoney(this.client.balance - fromCash)
    this.client.balanceCard = roundMoney(this.client.balanceCard - fromCard)

    // Never let float drift leave a fractional negative behind.
    if (this.client.balance < 0 && this.client.balance > -0.005) this.client.balance = 0
    if (this.client.balanceCard < 0 && this.client.balanceCard > -0.005) this.client.balanceCard = 0

    this.updateCredits()
    this.notifySubscribers()
    this.emit('credits-deducted', { amount, fromCash, fromCard, remaining: this.client.credits })

    // The caller needs the split to know whether the card must be persisted.
    return { amount, fromCash, fromCard }
  }

  /** Restore a snapshot taken before a failed payment. */
  restoreBalances(snapshot) {
    this.client.balance = snapshot.balance
    this.client.balanceCard = snapshot.balanceCard
    this.updateCredits()
    this.notifySubscribers()
  }

  /** Snapshot the spendable balances so a failed payment can be undone. */
  snapshotBalances() {
    return { balance: this.client.balance, balanceCard: this.client.balanceCard }
  }

  /**
   * Add bonus points
   */
  addBonus(points) {
    this.client.bonus = roundMoney(this.client.bonus + Number(points))
    this.notifySubscribers()
    this.emit('bonus-added', { bonus: this.client.bonus })
  }

  /**
   * Save card balance back to database
   */
  /**
   * Write the in-memory card balance back to the database.
   *
   * Throws on failure. It used to swallow the error and return, so a failed write
   * was indistinguishable from a successful one — the customer's card kept its old
   * balance while the session behaved as though they had paid.
   */
  async saveCardBalance() {
    if (!this.client.hasCard || !this.client.cardNumber) {
      return null
    }

    const card = await Card.findOneAndUpdate(
      { code: this.client.cardNumber },
      { $set: { balance: roundMoney(this.client.balanceCard), bonus: roundMoney(this.client.bonus), updatedAt: new Date() } },
      { new: true }
    )
    if (!card) {
      throw new Error(`Card ${this.client.cardNumber} no longer exists — balance not saved`)
    }

    this.emit('card-saved', { code: card.code, balance: card.balance })
    return card
  }

  /**
   * Calculate total credits available
   */
  updateCredits() {
    this.client.credits = roundMoney(this.client.balance + this.client.balanceCard)
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

/**
 * Card <-> database balance sync ("Option C").
 *
 * In the shop the customer's card carries its balance (the legacy system's
 * design), and this database carries it too. Keeping BOTH current means either can
 * be lost — a wiped PC, a restored backup, a lost card — and the other restores it,
 * so a client never loses their money.
 *
 *  - Card meets an unknown database  -> ADOPT it: create the record from the card.
 *  - Balance changes in the database -> WRITE it onto the card (if it is at the reader).
 *  - Card meets a known database     -> RECONCILE if the two disagree.
 *
 * Only active in controller (low-level gateway) mode; `CARD_SYNC=false` turns it off.
 *
 * Reference: docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md §13
 */
import { isBlankCard } from './blankCard.js'
import EventEmitter from 'events'
import mongoose from 'mongoose'
import Card, { onCardChanged } from '../models/card.js'
import AuditLog from '../models/auditLog.js'
import { roundMoney } from '../utils/money.js'

const toCents = (euros) => Math.round(Number(euros) * 100)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Largest balance we will believe from a card. A card is trusted (as the legacy
 * kiosk trusts it), but a corrupt read or a forged value far beyond any real top-up
 * must not become money. Same ceiling as a single kiosk sync delta.
 */
export const MAX_CARD_BALANCE = Number(process.env.CARD_SYNC_MAX_BALANCE) || 1000

/**
 * The most money a chip alone may bring INTO the database: the balance of a card we have never seen, or how far a known card may
 * be above what we hold for it. A chip can be copied or rewritten, so beyond this it is refused and the staff is told (2026-11 audit).
 */
export const MAX_CHIP_GAIN = Number(process.env.CARD_SYNC_MAX_GAIN) || 100

/**
 * What to do when the card and the database disagree.
 *
 * `syncedBalance` is what we last CONFIRMED the card to hold. It lets us tell
 * apart the two innocent causes of a mismatch:
 *
 *   card === synced  -> the card never got our latest change   -> database is newer
 *   db   === synced  -> the database never saw the card change -> card is newer
 *                       (card used elsewhere, or the database was restored)
 *
 * Anything else — both moved, or we never synced — is a conflict, and we keep the
 * LOWER figure: never create money out of an ambiguity. It is audit-logged.
 */
export function decideReconcile({ dbBalance, cardBalance, syncedBalance }) {
  const d = toCents(dbBalance)
  const c = toCents(cardBalance)
  const s = syncedBalance === null || syncedBalance === undefined ? null : toCents(syncedBalance)

  if (c === d) return { action: 'in-sync', balance: d / 100 }
  if (s !== null && c === s) return { action: 'db-wins', balance: d / 100 }
  if (s !== null && d === s) return { action: 'card-wins', balance: c / 100 }
  return { action: 'conflict', balance: Math.min(c, d) / 100 }
}

export class CardSync extends EventEmitter {
  constructor({
    middleware,
    tenantId,
    CardModel = Card,
    AuditModel = AuditLog,
    retryMs = 1500,
    retries = 3,
    maxBalance = MAX_CARD_BALANCE,
    maxGain = MAX_CHIP_GAIN,
  }) {
    super()
    this.middleware = middleware
    this.tenantId = tenantId
    // The raw collection (used for bookkeeping that must not re-trigger hooks)
    // does not cast, so hold a real ObjectId.
    this.tenantObjectId = new mongoose.Types.ObjectId(String(tenantId))
    this.Card = CardModel
    this.Audit = AuditModel
    this.retryMs = retryMs
    this.retries = retries
    this.maxBalance = maxBalance
    this.maxGain = maxGain
    this.inflight = new Map() // code -> Promise
    this.dirty = new Set()    // codes that changed again while a push was running
    this.locks = new Map()    // code -> tail of the reconcile chain (one at a time per card)
    this.unsubscribe = null
    this.onWritten = null
  }

  /** Only in controller mode, and never if explicitly disabled. */
  get enabled() {
    return Boolean(this.middleware?.lowLevel) && process.env.CARD_SYNC !== 'false'
  }

  start() {
    // Adoption relies on the unique (tenantId, code) index as its last line of
    // defence. Make sure it exists, and say so loudly if it cannot be built
    // (e.g. duplicate cards already in the database).
    this.Card.createIndexes?.().catch((err) =>
      console.error('[CardSync] could not ensure the unique card index — duplicate cards may exist:', err.message))
    // Any balance change anywhere in the app => try to put it on the card.
    this.unsubscribe = onCardChanged((tenantId, code) => {
      if (String(tenantId) !== String(this.tenantId)) return
      this.push(code).catch((err) => console.error('[CardSync] push failed:', err.message))
    })
    // A successful write (including card activation) is a confirmed sync point.
    this.onWritten = ({ cardData }) => {
      if (cardData?.code != null) this.markSynced(String(cardData.code), cardData.balance).catch(() => {})
    }
    this.middleware.on('card-written', this.onWritten)
  }

  stop() {
    this.unsubscribe?.()
    if (this.onWritten) this.middleware.off('card-written', this.onWritten)
    this.unsubscribe = this.onWritten = null
  }

  /** Record what the card now holds. Raw update: must not re-trigger the change hook. */
  async markSynced(code, balance) {
    await this.Card.collection.updateOne(
      { tenantId: this.tenantObjectId, code },
      { $set: { cardSyncedBalance: roundMoney(Number(balance) || 0), cardSyncedAt: new Date() } },
    )
  }

  /** E-mail the shop (never throws, never waited for). */
  alert(subject, message) {
    import('./alerts.js').then(({ sendAlertForTenant }) => sendAlertForTenant(this.tenantId, subject, message)).catch(() => {})
  }

  async audit(action, code, details) {
    try {
      await this.Audit.create({
        tenantId: this.tenantId, actorUsername: 'card-sync', action,
        targetType: 'Card', targetId: String(code), details,
      })
    } catch (err) {
      console.error('[CardSync] audit write failed:', err.message)
    }
  }

  // ---------------------------------------------------------- database -> card

  /**
   * Put the database balance onto the card. Coalesces bursts: if the balance
   * changes again while a write is running, it runs once more afterwards.
   */
  push(code) {
    if (!this.enabled) return Promise.resolve({ status: 'disabled' })
    const running = this.inflight.get(code)
    if (running) { this.dirty.add(code); return running }

    const job = (async () => {
      let result
      do {
        this.dirty.delete(code)
        result = await this.pushOnce(code)
      } while (this.dirty.has(code))
      return result
    })().finally(() => this.inflight.delete(code))
    this.inflight.set(code, job)
    // Said at once (the balance just changed, the payment is about to start a machine): the start order waits for this write.
    this.middleware?.noteCardWrite?.(job)
    return job
  }

  async pushOnce(code) {
    const card = await this.Card.findOne({ tenantId: this.tenantId, code }).lean()
    if (!card) return { status: 'no-card' }
    // pending_write cards are activated by POST /pos/card/write; blocked ones are left alone.
    if (card.status !== 'active') return { status: 'inactive' }
    if (card.cardSyncedBalance != null && toCents(card.cardSyncedBalance) === toCents(card.balance)) {
      return { status: 'up-to-date' }
    }

    for (let attempt = 0; ; attempt++) {
      let res
      try {
        res = await this.middleware.writeCardBalance(card)
      } catch (err) {
        res = { written: false, reason: err.message, error: true }
      }

      if (res.written) {
        await this.markSynced(code, card.balance)
        this.emit('card-updated', { code, balance: card.balance })
        return { status: 'written' }
      }
      // Card not at the reader (or a different one): nothing to retry now. The
      // mismatch is repaired the next time this card is inserted (see reconcile).
      if (!res.error) return { status: 'skipped', reason: res.reason }
      if (attempt >= this.retries) {
        console.error(`[CardSync] could not write card ${code}: ${res.reason}`)
        this.emit('card-write-failed', { code, reason: res.reason })
        return { status: 'failed', reason: res.reason }
      }
      await sleep(this.retryMs)
    }
  }

  // ---------------------------------------------------------- card -> database

  /**
   * A card was presented: adopt it if new, otherwise settle any disagreement.
   * Call with the controller's `card-inserted` data (`balance` in cents).
   */
  reconcile(cardData) {
    // One reconcile at a time per card. The controller can announce the same card
    // twice in quick succession (an echo after a write); handled concurrently, both
    // would see "unknown card" and both would adopt it. In-process, so it holds even
    // if the database's unique index is missing.
    const key = String(cardData?.cardId ?? '')
    const prev = this.locks.get(key) || Promise.resolve()
    const run = prev.then(() => this.reconcileNow(cardData), () => this.reconcileNow(cardData))
    const tail = run.catch(() => {})
    this.locks.set(key, tail)
    tail.then(() => { if (this.locks.get(key) === tail) this.locks.delete(key) })
    return run
  }

  async reconcileNow(cardData) {
    if (!this.enabled) return { status: 'disabled' }
    // Admin cards are keys, not wallets.
    if (String(cardData?.admin) === 'true') return { status: 'skipped', reason: 'admin-card' }

    const code = cardData?.cardId != null ? String(cardData.cardId).trim() : ''
    // A blank card (no id yet) is the card-purchase flow's business, not ours. The controller reports a
    // blank card with new:"true" and a made-up id; adopting that id created a second, empty card and the
    // purchased balance was never written.
    if (!code || isBlankCard(cardData)) return { status: 'skipped', reason: 'blank-card' }
    const rawCents = Number(cardData?.balance)
    if (!Number.isFinite(rawCents) || rawCents < 0) {
      return { status: 'invalid', reason: 'unreadable card data' }
    }
    // The chip counts in cents. Older software wrote them with float dust ("79.9999999999980" for 80 cents), so the
    // cents are rounded to the whole number first: 79.999… is 80 cents, EUR 0.80.
    const cardBalance = roundMoney(Math.round(rawCents) / 100)
    if (cardBalance > this.maxBalance) {
      await this.audit('card.reject', code, { reason: 'balance above ceiling', cardBalance, ceiling: this.maxBalance })
      return { status: 'invalid', reason: `card balance €${cardBalance.toFixed(2)} exceeds the €${this.maxBalance} limit` }
    }

    let existing = await this.Card.findOne({ tenantId: this.tenantId, code })

    if (!existing) {
      if (cardBalance > this.maxGain) {
        await this.audit('card.reject', code, { reason: 'unknown card above the adoption limit', cardBalance, limit: this.maxGain })
        this.alert('Cartão desconhecido recusado', `Um cartão que não existe na base (${code}) trazia ${cardBalance.toFixed(2)} € no chip, acima do limite de ${this.maxGain} € para cartões desconhecidos. Não foi aceite. Se for um cartão verdadeiro, crie-o no admin com o saldo certo.`)
        return { status: 'invalid', reason: `unknown card with €${cardBalance.toFixed(2)} exceeds the €${this.maxGain} adoption limit` }
      }
      try {
        // The unique (tenantId, code) index makes adoption race-safe: of two
        // simultaneous adopters exactly one wins, the other falls through below.
        const created = await this.Card.create({
          tenantId: this.tenantId,
          code,
          balance: cardBalance,
          name: cardData.name || '',
          contribuinte: cardData.nif || '',
          status: 'active',
          cardSyncedBalance: cardBalance,
          cardSyncedAt: new Date(),
          metadata: { adopted: { at: new Date(), from: 'controller-card', balance: cardBalance, ownerId: cardData.ownerId ?? null } },
        })
        await this.audit('card.adopt', code, { balance: cardBalance })
        if (cardBalance > 0) this.alert('Cartão desconhecido aceite com saldo', `O cartão ${code} não existia na base e foi aceite com os ${cardBalance.toFixed(2)} € que trazia no chip. Confirme que é um cartão da loja.`)
        this.emit('adopted', { code, balance: cardBalance })
        return { status: 'adopted', balance: cardBalance, card: created }
      } catch (err) {
        if (err?.code !== 11000) throw err
        existing = await this.Card.findOne({ tenantId: this.tenantId, code })
      }
    }

    if (existing.status !== 'active') return { status: 'skipped', reason: existing.status }

    // The card also carries the customer's name and tax id. Use them to FILL
    // BLANKS in our record — never to overwrite what we already hold.
    const fill = {}
    if (!existing.name && cardData.name) fill.name = String(cardData.name)
    if (!existing.contribuinte && cardData.nif) fill.contribuinte = String(cardData.nif)
    if (Object.keys(fill).length) {
      await this.Card.collection.updateOne({ tenantId: this.tenantObjectId, code }, { $set: fill })
    }

    const decision = decideReconcile({
      dbBalance: existing.balance, cardBalance, syncedBalance: existing.cardSyncedBalance,
    })
    const now = new Date()

    switch (decision.action) {
      case 'in-sync':
        if (existing.cardSyncedBalance == null || toCents(existing.cardSyncedBalance) !== toCents(cardBalance)) {
          await this.markSynced(code, cardBalance)
        }
        return { status: 'in-sync', balance: cardBalance }

      case 'db-wins': {
        // The card missed a change (e.g. cash moved onto it after it was removed,
        // or power was lost mid-write). Bring it up to date.
        const write = await this.push(code)
        return { status: 'db-wins', balance: decision.balance, write }
      }

      case 'card-wins':
        if (cardBalance - Number(existing.balance || 0) > this.maxGain) {
          await this.audit('card.reject', code, { reason: 'chip far above the database', db: existing.balance, card: cardBalance, limit: this.maxGain })
          this.alert('Cartão com saldo a mais no chip', `O cartão ${code} tem ${Number(existing.balance || 0).toFixed(2)} € na base e trazia ${cardBalance.toFixed(2)} € no chip. A diferença passa o limite de ${this.maxGain} € e não foi aceite; o saldo da base não mudou.`)
          return { status: 'invalid', reason: `chip €${cardBalance.toFixed(2)} is more than €${this.maxGain} above the database` }
        }
        // The card was used elsewhere, or this database was restored from a backup.
        await this.Card.collection.updateOne(
          { tenantId: this.tenantObjectId, code },
          { $set: { balance: cardBalance, cardSyncedBalance: cardBalance, cardSyncedAt: now, updatedAt: now } },
        )
        await this.audit('card.reconcile', code, { action: 'card-wins', db: existing.balance, card: cardBalance })
        this.emit('reconciled', { code, action: 'card-wins', balance: cardBalance })
        return { status: 'card-wins', balance: cardBalance }

      default: { // conflict: keep the lower figure
        const keep = decision.balance
        await this.Card.collection.updateOne(
          { tenantId: this.tenantObjectId, code },
          { $set: { balance: keep, updatedAt: now } },
        )
        await this.audit('card.reconcile', code, {
          action: 'conflict', db: existing.balance, card: cardBalance, synced: existing.cardSyncedBalance, kept: keep,
        })
        this.emit('reconciled', { code, action: 'conflict', balance: keep })
        // Make the card match whatever we kept.
        const write = toCents(keep) === toCents(cardBalance)
          ? (await this.markSynced(code, keep), { status: 'up-to-date' })
          : await this.push(code)
        return { status: 'conflict', balance: keep, write }
      }
    }
  }
}

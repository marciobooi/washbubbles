/**
 * Persisted cash session — coins and bills a customer has already fed in survive a
 * crash or power cut.
 *
 * The accepted money is physically in the machine. Until now the credit lived only
 * in memory, so a restart erased it and the customer simply lost their money. The
 * Electron POS client always persisted this ("Recovered €x of inserted cash");
 * this gives the backend the same guarantee.
 *
 * Kept in a small local file, NOT the database, on purpose: it must work when the
 * database is the thing that is down, and a synchronous atomic write means a
 * credit is on disk before the customer is shown it.
 *
 * Restore rule: cash is given back only if the session is recent
 * (CASH_SESSION_RESTORE_MINUTES, default 30). After a long gap the customer has
 * gone, and crediting a stranger's next visit would be handing them free money;
 * older cash is recorded (audit log) for the operator instead of restored.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { roundMoney } from '../utils/money.js'

const DEFAULT_DIR = process.env.DATA_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data')

export class CashSessionStore {
  constructor({ file = path.join(DEFAULT_DIR, 'cash-session.json'), tenantId, maxAgeMinutes } = {}) {
    this.file = file
    this.tenantId = String(tenantId)
    this.maxAgeMs = (Number(maxAgeMinutes ?? process.env.CASH_SESSION_RESTORE_MINUTES) || 30) * 60_000
    this.last = null // last serialised state, to skip no-op writes
  }

  /** Persist the current cash. Synchronous + atomic (temp file, then rename). */
  save({ balance, bonus }) {
    const state = { balance: roundMoney(balance || 0), bonus: roundMoney(bonus || 0) }
    const key = `${state.balance}|${state.bonus}`
    if (key === this.last) return
    this.last = key

    try {
      if (state.balance <= 0 && state.bonus <= 0) {
        fs.rmSync(this.file, { force: true })
        return
      }
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      const fd = fs.openSync(tmp, 'w')
      try {
        fs.writeSync(fd, JSON.stringify({ tenantId: this.tenantId, ...state, savedAt: Date.now() }))
        fs.fsyncSync(fd) // on disk before we return, not just in the OS cache
      } finally {
        fs.closeSync(fd)
      }
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error('[CashSession] could not persist:', err.message)
    }
  }

  /**
   * Read what was left. Returns `{ balance, bonus, ageMs }` when it should be
   * restored, `{ expired: {...} }` when it is too old, or null. Clears the file
   * either way — a restored session is re-saved by the next change.
   */
  take() {
    let raw
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { return null }
    fs.rmSync(this.file, { force: true })
    this.last = null

    if (!raw || raw.tenantId !== this.tenantId) return null
    const balance = roundMoney(Number(raw.balance) || 0)
    const bonus = roundMoney(Number(raw.bonus) || 0)
    if (balance <= 0 && bonus <= 0) return null

    const ageMs = Date.now() - (Number(raw.savedAt) || 0)
    if (ageMs > this.maxAgeMs) return { expired: { balance, bonus, ageMs } }
    return { balance, bonus, ageMs }
  }
}

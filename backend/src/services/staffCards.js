/**
 * Master cards: cards the admin chose (Definições > Quiosque, PIN e cartões) that open the staff area on the kiosk with no PIN, just
 * by being put in the reader. The reader is on the shop PC, so the card id never travels from a client: the shop PC recognises the card
 * and gives THAT kiosk screen a short-lived token, which stands in for the PIN (`card:<token>`) on every staff action.
 * Setting `staffCards`: { enabled: boolean, cards: [{ code, label }] }.
 */
import crypto from 'crypto'
import Setting from '../models/setting.js'

export const STAFF_CARD_TOKEN_MS = 15 * 60_000
const MAX_CARDS = 10
const tokens = new Map() // token -> { tenantId, until }

/** What the admin may save: at most 10 cards, each a code and a label, no repeats. */
export function cleanStaffCards(v) {
  const cards = []
  const seen = new Set()
  for (const c of Array.isArray(v?.cards) ? v.cards : []) {
    const code = String(c?.code ?? '').trim().slice(0, 64)
    if (!code || seen.has(code)) continue
    seen.add(code)
    cards.push({ code, label: String(c?.label ?? '').trim().slice(0, 40) })
    if (cards.length >= MAX_CARDS) break
  }
  return { enabled: v?.enabled === true, cards }
}

/** The master card with this id at the reader, or null (also null while the feature is off). */
export async function staffCardFor(tenantId, cardNumber) {
  if (!tenantId || cardNumber == null || cardNumber === '') return null
  const row = await Setting.findOne({ tenantId, key: 'staffCards' }).lean()
  const cfg = cleanStaffCards(row?.value)
  if (!cfg.enabled) return null
  return cfg.cards.find((c) => c.code === String(cardNumber)) || null
}

export function issueStaffToken(tenantId) {
  const now = Date.now()
  for (const [t, v] of tokens) if (v.until < now) tokens.delete(t)
  const token = crypto.randomBytes(24).toString('hex')
  tokens.set(token, { tenantId: String(tenantId), until: now + STAFF_CARD_TOKEN_MS })
  return token
}

/** Is this `card:<token>` a live token of this shop? */
export function checkStaffToken(tenantId, pin) {
  if (typeof pin !== 'string' || !pin.startsWith('card:')) return false
  const v = tokens.get(pin.slice(5))
  return Boolean(v && v.tenantId === String(tenantId) && v.until >= Date.now())
}

export function _resetStaffTokens() { tokens.clear() }

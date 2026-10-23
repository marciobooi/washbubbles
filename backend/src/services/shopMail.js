/**
 * A shop's own e-mail identity, set by the shop in Definições → "Email da loja":
 *   support.email     the shop's support address: gets the shop's alerts, is where customers' replies go, and is the contact on its e-mails
 *   shopmail.account  OPTIONAL outgoing mailbox of the shop (e.g. geral@marcioinc.pt at Amen or Google): host, port, user, password
 *                     (stored encrypted, never sent back, never synced to a shop PC) and the from address.
 * With an account the shop's e-mails are sent THROUGH its own mailbox (so they come from its own address and domain);
 * without one they go through the platform's mailbox under the shop's name, with replies to the support address.
 */
import mongoose from 'mongoose'
import Setting from '../models/setting.js'
import { encrypt, decrypt } from './platformSettings.js'

export const SUPPORT_KEY = 'support.email'
export const ACCOUNT_KEY = 'shopmail.account'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const cache = new Map() // tenantId -> { at, value }
export function resetShopMailCache() { cache.clear() }

/** @returns {{ supportEmail:string, account:null|{host,port,user,pass,from} }} */
export async function getShopMail(tenantId) {
  const key = String(tenantId || '')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30_000) return hit.value
  let value = { supportEmail: '', account: null }
  if (tenantId && mongoose.connection.readyState === 1) {
    try {
      const rows = await Setting.find({ tenantId, key: { $in: [SUPPORT_KEY, ACCOUNT_KEY] } }).lean()
      const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
      const a = m[ACCOUNT_KEY]
      const pass = a && a.pass ? decrypt(a.pass) : ''
      value = { supportEmail: typeof m[SUPPORT_KEY] === 'string' ? m[SUPPORT_KEY] : '', account: a && a.host && a.port && pass ? { host: a.host, port: a.port, user: a.user || '', pass, from: a.from || a.user || '' } : null }
    } catch { /* the platform's mailbox is the fallback */ }
  }
  cache.set(key, { at: Date.now(), value })
  return value
}

/** For the screen: the password is replaced by a flag. */
export async function getShopMailPublic(tenantId) {
  resetShopMailCache()
  const rows = await Setting.find({ tenantId, key: { $in: [SUPPORT_KEY, ACCOUNT_KEY] } }).lean()
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const a = m[ACCOUNT_KEY] || {}
  return { supportEmail: typeof m[SUPPORT_KEY] === 'string' ? m[SUPPORT_KEY] : '', account: { host: a.host || '', port: a.port || '', user: a.user || '', from: a.from || '', hasPassword: !!a.pass } }
}

export async function saveShopMail(tenantId, { supportEmail, account }) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 })
  if (supportEmail !== undefined) {
    const v = String(supportEmail || '').trim()
    if (v && !EMAIL_RE.test(v)) throw bad('Email de suporte inválido')
    await Setting.updateOne({ tenantId, key: SUPPORT_KEY }, { $set: { value: v } }, { upsert: true })
  }
  if (account) {
    const cur = (await Setting.findOne({ tenantId, key: ACCOUNT_KEY }).lean())?.value || {}
    const next = { ...cur }
    for (const k of ['host', 'port', 'user', 'from']) if (account[k] !== undefined) next[k] = String(account[k]).trim()
    if (next.port && !/^\d{2,5}$/.test(String(next.port))) throw bad('Porta inválida')
    if (next.from && !EMAIL_RE.test(next.from)) throw bad('Endereço de envio inválido')
    if (account.pass) next.pass = encrypt(String(account.pass))
    if (account.clear) await Setting.deleteOne({ tenantId, key: ACCOUNT_KEY })
    else await Setting.updateOne({ tenantId, key: ACCOUNT_KEY }, { $set: { value: next } }, { upsert: true })
  }
  resetShopMailCache()
}

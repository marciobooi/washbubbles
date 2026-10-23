/**
 * Platform settings kept in the database (editable by the superadmin in Lojas → Plataforma), with the environment as fallback:
 *   support.email   who gets a copy of the customer e-mails and is named in the installer as the support contact
 *   mail            the outgoing mail account (host, port, user, password, from address and name)
 * The mail password is stored ENCRYPTED (AES-256-GCM, key derived from JWT_SECRET) and never sent back to the browser.
 */
import crypto from 'crypto'
import mongoose from 'mongoose'
import PlatformSetting from '../models/platformSetting.js'

const DEFAULT_SUPPORT = 'marcacoes@freshbubbles.pt'
const key32 = () => crypto.createHash('sha256').update(String(process.env.JWT_SECRET || 'dev-secret')).digest()

export function encrypt(text) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key32(), iv)
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()])
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}
export function decrypt(blob) {
  try {
    const [v, iv, tag, enc] = String(blob).split(':')
    if (v !== 'v1') return ''
    const d = crypto.createDecipheriv('aes-256-gcm', key32(), Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8')
  } catch { return '' }
}

let cache = null // the database rows only: the environment is read fresh every time
export function resetPlatformCache() { cache = null }

/** @returns {{ supportEmail:string, mail:{host,port,user,pass,from,fromName,fromDb:boolean} }} */
export async function getPlatform() {
  const env = { host: process.env.MAIL_HOST || '', port: process.env.MAIL_PORT || '', user: process.env.MAIL_USER || '', pass: process.env.MAIL_PASS || '', from: process.env.MAIL_FROM || '', fromName: process.env.MAIL_FROM_NAME || '' }
  let rows = []
  if (cache && Date.now() - cache.at < 30_000) rows = cache.rows
  else if (mongoose.connection.readyState === 1) {
    try { rows = await PlatformSetting.find({ key: { $in: ['support.email', 'mail'] } }).lean(); cache = { at: Date.now(), rows } } catch { /* the environment is the fallback */ }
  }
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const db = m.mail || {}
  const pick = (a, b) => (a !== undefined && a !== null && String(a).trim() !== '' ? String(a).trim() : b)
  const value = {
    supportEmail: pick(m['support.email'], pick(process.env.SUPPORT_EMAIL, DEFAULT_SUPPORT)),
    mail: {
      host: pick(db.host, env.host), port: pick(db.port, env.port), user: pick(db.user, env.user),
      pass: db.pass ? decrypt(db.pass) : env.pass, from: pick(db.from, env.from), fromName: pick(db.fromName, env.fromName),
      fromDb: !!db.host,
    },
  }
  return value
}

export const getSupportEmail = async () => (await getPlatform()).supportEmail

/** For the superadmin's screen: same shape, the password replaced by a flag. */
export async function getPlatformPublic() {
  resetPlatformCache()
  const p = await getPlatform()
  return { supportEmail: p.supportEmail, mail: { host: p.mail.host, port: p.mail.port, user: p.mail.user, from: p.mail.from, fromName: p.mail.fromName, hasPassword: !!p.mail.pass, fromDb: p.mail.fromDb } }
}

export async function savePlatform({ supportEmail, mail }) {
  if (supportEmail !== undefined) {
    const v = String(supportEmail).trim()
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw Object.assign(new Error('Email de suporte inválido'), { status: 400 })
    await PlatformSetting.updateOne({ key: 'support.email' }, { $set: { value: v, updatedAt: new Date() } }, { upsert: true })
  }
  if (mail) {
    const cur = (await PlatformSetting.findOne({ key: 'mail' }).lean())?.value || {}
    const next = { ...cur }
    for (const k of ['host', 'port', 'user', 'from', 'fromName']) if (mail[k] !== undefined) next[k] = String(mail[k]).trim()
    if (next.port && !/^\d{2,5}$/.test(String(next.port))) throw Object.assign(new Error('Porta inválida'), { status: 400 })
    if (mail.pass) next.pass = encrypt(String(mail.pass)) // empty / missing = keep the stored one
    await PlatformSetting.updateOne({ key: 'mail' }, { $set: { value: next, updatedAt: new Date() } }, { upsert: true })
  }
  resetPlatformCache()
}

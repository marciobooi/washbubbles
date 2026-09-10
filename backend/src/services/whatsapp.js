/**
 * Customer WhatsApp notifications via Baileys — an unofficial library that
 * logs in as a real WhatsApp number over a QR-code pairing (same mechanism
 * as WhatsApp Web), no Meta Business approval needed. $0 cost, but it is
 * NOT the official API: a number can occasionally be flagged/rate-limited
 * for automated traffic. Chosen deliberately over the official Cloud API
 * for this reason's tradeoff — see the settings UI for the pairing flow.
 *
 * One socket per tenant, started lazily only once that tenant enables the
 * `whatsapp.enabled` setting — most tenants will never touch this, so there
 * is no reason to hold an idle WhatsApp session open for them.
 *
 * Mirrors alerts.js's shape everywhere it can: look up a per-tenant Setting,
 * no-op if unset/disconnected, swallow every failure so a WhatsApp problem
 * can never surface as a failure of whatever triggered it (a hardware event
 * handler, in this case coinMachine.js's cycle-complete hook).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import Setting from '../models/setting.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_ROOT = path.join(__dirname, '..', '..', '.baileys-auth')

// tenantId -> { sock, qr (data URL or null), connected, starting (promise) }
const sessions = new Map()

function authDir(tenantId) {
  return path.join(AUTH_ROOT, String(tenantId))
}

async function isEnabled(tenantId) {
  const row = await Setting.findOne({ tenantId, key: 'whatsapp.enabled' })
  return Boolean(row?.value)
}

async function startConnection(tenantId) {
  const key = String(tenantId)
  let session = sessions.get(key)
  if (session?.sock) return session

  session = session || { sock: null, qr: null, connected: false, starting: null }
  sessions.set(key, session)

  fs.mkdirSync(authDir(key), { recursive: true })
  const { state, saveCreds } = await useMultiFileAuthState(authDir(key))

  const sock = makeWASocket({ auth: state, printQRInTerminal: false })
  session.sock = sock

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      try { session.qr = await QRCode.toDataURL(qr) } catch { session.qr = null }
    }
    if (connection === 'open') {
      session.connected = true
      session.qr = null
    }
    if (connection === 'close') {
      session.connected = false
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut
      session.sock = null
      if (!loggedOut) {
        // Transient drop (network blip, restart) — reconnect. A real logout
        // (unpaired from the phone) must NOT auto-reconnect, or the QR
        // pairing screen would never come back.
        startConnection(key).catch((err) => console.error('[WhatsApp] Reconnect failed:', err.message))
      }
    }
  })

  return session
}

/** Ensures a connection attempt has started (if enabled) and returns current status. */
export async function getStatus(tenantId) {
  try {
    if (!(await isEnabled(tenantId))) return { connected: false, qr: null, enabled: false }
    const session = await startConnection(tenantId)
    return { connected: session.connected, qr: session.qr, enabled: true }
  } catch (err) {
    console.error('[WhatsApp] getStatus failed:', err.message)
    return { connected: false, qr: null, enabled: false }
  }
}

/** Logs out and clears local auth state so the operator can pair a different number. */
export async function disconnect(tenantId) {
  const key = String(tenantId)
  const session = sessions.get(key)
  try {
    await session?.sock?.logout()
  } catch { /* already gone — fine */ }
  sessions.delete(key)
  try { fs.rmSync(authDir(key), { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
}

/** Best-effort normalization for Portuguese numbers stored without a country code. */
function toJid(phone) {
  let digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 9) digits = '351' + digits // bare PT mobile number
  return `${digits}@s.whatsapp.net`
}

export async function sendCycleCompleteMessage(tenantId, phone, machineName) {
  try {
    if (!(await isEnabled(tenantId))) return
    const session = sessions.get(String(tenantId))
    if (!session?.connected || !session.sock) return
    const jid = toJid(phone)
    if (!jid) return
    await session.sock.sendMessage(jid, {
      text: `A sua lavagem/secagem na máquina "${machineName}" terminou. Obrigado por escolher a WashBubbles!`
    })
  } catch (err) {
    console.error('[WhatsApp] Failed to send cycle-complete message:', err.message)
  }
}

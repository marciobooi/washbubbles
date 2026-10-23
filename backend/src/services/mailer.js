import nodemailer from 'nodemailer'

// Simple wrapper around nodemailer. Configure via env vars:
//  MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM, MAIL_FROM_NAME (optional)
// If no SMTP config is provided, `send` will just log the message to console.
//
// Shop mailbox is hosted at amen.pt (marcacoes@freshbubbles.pt). Default is port
// 587 (STARTTLS submission) — NOT amen.pt's own documented 465/SSL option: a live
// test against the Hetzner-hosted deployment found port 465 (and 25) silently
// black-holed by the host's outbound anti-abuse filtering, while 587 works. A
// blocked port doesn't error, it just never connects, so without the timeouts
// below a single receipt/reset email would hang the request (and, behind nginx,
// eventually surface as a 504) instead of failing fast. See
// docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md §15.
const CONNECT_TIMEOUT_MS = Number(process.env.MAIL_TIMEOUT_MS) || 10_000

let transporter = null
// Re-create the transporter if host/port change (e.g. a test overriding env
// vars between runs) rather than caching the first, possibly wrong, config.
let transporterKey = null

// `cfg` = the platform's mail account (database, then environment: services/platformSettings.js); with none, the environment alone.
function initTransporter(cfg = null) {
  const MAIL_HOST = cfg ? cfg.host : process.env.MAIL_HOST
  const MAIL_PORT = cfg ? cfg.port : process.env.MAIL_PORT
  const MAIL_USER = cfg ? cfg.user : process.env.MAIL_USER
  const MAIL_PASS = cfg ? cfg.pass : process.env.MAIL_PASS
  if (!MAIL_HOST || !MAIL_PORT) { transporter = null; transporterKey = null; return null }
  const key = `${MAIL_HOST}:${MAIL_PORT}:${MAIL_USER}:${MAIL_PASS}`
  if (transporter && transporterKey === key) return transporter

  const port = parseInt(MAIL_PORT, 10)
  transporter = nodemailer.createTransport({
    host: MAIL_HOST.trim(),
    port,
    // 465 = implicit TLS. Anything else (587, 25) starts in plaintext and
    // upgrades via STARTTLS if the server offers it, which is what nodemailer's
    // `secure: false` already does — no extra flag needed.
    secure: port === 465,
    auth: MAIL_USER ? { user: MAIL_USER.trim(), pass: MAIL_PASS } : undefined,
    // Without these, a port that's open-but-silently-dropped (a firewall that
    // doesn't send a TCP reset, exactly what a blocked port looks like) hangs
    // nodemailer forever — there's no default. Same idea for a server that
    // accepts the connection but never greets, or a send that stalls mid-DATA.
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: CONNECT_TIMEOUT_MS * 2,
  })
  transporterKey = key
  return transporter
}

/**
 * @param tenantId  the shop this mail is on behalf of: the sender's display name is the SHOP's name and replies go to the SHOP's
 *                  e-mail (the sending mailbox itself is shared for now; per-shop domains with SPF/DKIM are a later step)
 */
export async function sendMail({ to, bcc, subject, text, html, tenantId = null, relayed = false }) {
  // A shop PC has no mailbox password of its own: when it is linked to the central server it hands the message over (the server
  // sends it with the shop's mailbox). If the server cannot be reached, the PC's own MAIL_* settings (if any) are the fallback.
  const central = process.env.SYNC_SERVER_URL && process.env.SYNC_API_KEY
  if (central && !relayed && process.env.MAIL_RELAY !== 'off') {
    try {
      const r = await fetch(`${String(process.env.SYNC_SERVER_URL).replace(/\/+$/, '')}/sync/mail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${process.env.SYNC_API_KEY}` },
        body: JSON.stringify({ to, subject, text, html }), signal: AbortSignal.timeout(20_000),
      })
      if (r.ok) { console.log(`mailer: "${subject}" handed to the central server`); return }
      if (r.status < 500 && r.status !== 429) throw new Error(`o servidor recusou o email (${r.status})`)
    } catch (err) {
      if (!process.env.MAIL_HOST) throw err // nothing local to fall back to
    }
  }
  let cfg = null
  try { cfg = (await (await import('./platformSettings.js')).getPlatform()).mail } catch { /* environment only */ }
  let shopName = ''; let replyTo = ''; let own = false
  if (tenantId) {
    try {
      const { getEmailBrand } = await import('./emailBrand.js'); const b = await getEmailBrand(tenantId); shopName = b.name || ''; replyTo = b.email || ''
      // the shop's own mailbox, when it has set one up: the e-mail then comes from the shop's own address
      const { getShopMail } = await import('./shopMail.js'); const sm = await getShopMail(tenantId)
      if (sm.account) { cfg = sm.account; own = true }
    } catch { /* the default sender is fine */ }
  }
  const t = initTransporter(cfg)
  const address = (cfg && cfg.from) || process.env.MAIL_FROM || 'no-reply@example.com'
  const fromName = shopName || (!own && cfg && cfg.fromName) || process.env.MAIL_FROM_NAME
  const from = fromName ? `"${fromName.replace(/"/g, "'")}" <${address}>` : address
  if (t) {
    const info = await t.sendMail({ from, to, ...(bcc ? { bcc } : {}), ...(replyTo ? { replyTo } : {}), subject, text, html })
    // Say what the mail server answered (the recipient is shown only in part: it is a customer's address).
    const hide = (addr) => String(addr).replace(/^(.).*(@.*)$/, '$1***$2')
    const acc = (info?.accepted || []).map(hide).join(',') || '-'
    const rej = (info?.rejected || []).map(hide).join(',')
    console.log(`mailer: "${subject}" accepted by the mail server for ${acc}${rej ? ` REJECTED ${rej}` : ''} (${info?.response || ''})`)
  } else {
    console.log('mailer: transport not configured, printing message:')
    console.log('to:', to)
    console.log('subject:', subject)
    console.log('text:', text)
    if (html) console.log('html:', html)
  }
}

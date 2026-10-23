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

function initTransporter() {
  const { MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS } = process.env
  if (!MAIL_HOST || !MAIL_PORT) { transporter = null; transporterKey = null; return null }
  const key = `${MAIL_HOST}:${MAIL_PORT}`
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
export async function sendMail({ to, bcc, subject, text, html, tenantId = null }) {
  const t = initTransporter()
  const address = process.env.MAIL_FROM || 'no-reply@example.com'
  let shopName = ''; let replyTo = ''
  if (tenantId) {
    try { const { getEmailBrand } = await import('./emailBrand.js'); const b = await getEmailBrand(tenantId); shopName = b.name || ''; replyTo = b.email || '' } catch { /* the default sender is fine */ }
  }
  const fromName = shopName || process.env.MAIL_FROM_NAME
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

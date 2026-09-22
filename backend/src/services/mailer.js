import nodemailer from 'nodemailer'

// Simple wrapper around nodemailer. Configure via env vars:
//  MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM, MAIL_FROM_NAME (optional)
// If no SMTP config is provided, `send` will just log the message to console.
//
// Shop mailbox is hosted at amen.pt (marcacoes@freshbubbles.pt) — its documented
// settings are host smtp-pt.securemail.pro, port 465, SSL, username = the full
// email address. See .env.example for the exact values.

let transporter = null
// Re-create the transporter if MAIL_HOST changes (e.g. a test overriding env
// vars between runs) rather than caching the first, possibly wrong, config.
let transporterHost = null

function initTransporter() {
  const { MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS } = process.env
  if (!MAIL_HOST || !MAIL_PORT) { transporter = null; transporterHost = null; return null }
  if (transporter && transporterHost === MAIL_HOST) return transporter

  const port = parseInt(MAIL_PORT, 10)
  transporter = nodemailer.createTransport({
    host: MAIL_HOST.trim(),
    port,
    // 465 = implicit TLS (amen.pt's SSL option). Anything else (587, 25) starts
    // in plaintext and upgrades via STARTTLS if the server offers it, which is
    // what nodemailer's `secure: false` already does — no extra flag needed.
    secure: port === 465,
    auth: MAIL_USER ? { user: MAIL_USER.trim(), pass: MAIL_PASS } : undefined,
  })
  transporterHost = MAIL_HOST
  return transporter
}

export async function sendMail({ to, subject, text, html }) {
  const t = initTransporter()
  const address = process.env.MAIL_FROM || 'no-reply@example.com'
  const fromName = process.env.MAIL_FROM_NAME
  const from = fromName ? `"${fromName.replace(/"/g, "'")}" <${address}>` : address
  if (t) {
    await t.sendMail({ from, to, subject, text, html })
  } else {
    console.log('mailer: transport not configured, printing message:')
    console.log('to:', to)
    console.log('subject:', subject)
    console.log('text:', text)
    if (html) console.log('html:', html)
  }
}

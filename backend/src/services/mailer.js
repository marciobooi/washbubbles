import nodemailer from 'nodemailer'

// Simple wrapper around nodemailer. Configure via env vars:
//  MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM
// If no SMTP config is provided, `send` will just log the message to console.

let transporter = null

function initTransporter() {
  if (transporter) return transporter
  const { MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS } = process.env
  if (MAIL_HOST && MAIL_PORT) {
    transporter = nodemailer.createTransport({
      host: MAIL_HOST,
      port: parseInt(MAIL_PORT, 10),
      secure: MAIL_PORT === '465',
      auth: MAIL_USER ? { user: MAIL_USER, pass: MAIL_PASS } : undefined,
    })
  }
  return transporter
}

export async function sendMail({ to, subject, text, html }) {
  const t = initTransporter()
  const from = process.env.MAIL_FROM || 'no-reply@example.com'
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

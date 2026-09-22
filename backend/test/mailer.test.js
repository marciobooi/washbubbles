import { expect } from 'chai'

// The test env sets no MAIL_HOST (see alerts.test.js's own note), so every
// test here sets/clears process.env.MAIL_* itself and restores it afterwards —
// nothing here depends on, or leaks into, other test files' env state.
describe('mailer.sendMail', () => {
  const ENV_KEYS = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM', 'MAIL_FROM_NAME']
  let saved

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    for (const k of ENV_KEYS) delete process.env[k]
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  /** Reload the module fresh so its module-level transporter cache starts empty. */
  async function freshMailer() {
    const mod = await import(`../src/services/mailer.js?t=${Date.now()}-${Math.random()}`)
    return mod
  }

  it('with no MAIL_HOST configured, logs instead of sending (never throws)', async () => {
    const { sendMail } = await freshMailer()
    await sendMail({ to: 'a@b.com', subject: 'hi', text: 'hello' })
    // No assertion beyond "it resolved" — this is exactly today's safe-default
    // dev/test behaviour (see alerts.test.js), just pinned here explicitly.
  })

  it('amen.pt config (465/SSL): builds a transporter with secure=true and the full email as auth user', async () => {
    process.env.MAIL_HOST = 'smtp-pt.securemail.pro'
    process.env.MAIL_PORT = '465'
    process.env.MAIL_USER = 'marcacoes@freshbubbles.pt'
    process.env.MAIL_PASS = 'the-mailbox-password'
    process.env.MAIL_FROM = 'marcacoes@freshbubbles.pt'

    const { sendMail } = await freshMailer()
    const nodemailer = (await import('nodemailer')).default
    let captured = null
    const realCreate = nodemailer.createTransport
    nodemailer.createTransport = (opts) => {
      captured = opts
      return { sendMail: async (msg) => { captured.sentMessage = msg } }
    }
    try {
      await sendMail({ to: 'customer@example.com', subject: 'Fecho de Caixa', text: 'body' })
    } finally {
      nodemailer.createTransport = realCreate
    }

    expect(captured).to.include({ host: 'smtp-pt.securemail.pro', port: 465, secure: true })
    expect(captured.auth).to.deep.equal({ user: 'marcacoes@freshbubbles.pt', pass: 'the-mailbox-password' })
    expect(captured.sentMessage.from).to.equal('marcacoes@freshbubbles.pt')
    expect(captured.sentMessage.to).to.equal('customer@example.com')
  })

  it('port 587 (STARTTLS) is NOT implicit-TLS: secure must be false', async () => {
    process.env.MAIL_HOST = 'smtp.example.com'
    process.env.MAIL_PORT = '587'
    const { sendMail } = await freshMailer()
    const nodemailer = (await import('nodemailer')).default
    let captured = null
    const realCreate = nodemailer.createTransport
    nodemailer.createTransport = (opts) => { captured = opts; return { sendMail: async () => {} } }
    try {
      await sendMail({ to: 'a@b.com', subject: 's', text: 't' })
    } finally {
      nodemailer.createTransport = realCreate
    }
    expect(captured).to.include({ port: 587, secure: false })
  })

  it('MAIL_FROM_NAME wraps the address as a display name, quotes escaped, address untouched', async () => {
    process.env.MAIL_HOST = 'smtp-pt.securemail.pro'
    process.env.MAIL_PORT = '465'
    process.env.MAIL_FROM = 'marcacoes@freshbubbles.pt'
    process.env.MAIL_FROM_NAME = 'Fresh Bubbles "Lavandaria"'

    const { sendMail } = await freshMailer()
    const nodemailer = (await import('nodemailer')).default
    let sent = null
    const realCreate = nodemailer.createTransport
    nodemailer.createTransport = () => ({ sendMail: async (msg) => { sent = msg } })
    try {
      await sendMail({ to: 'a@b.com', subject: 's', text: 't' })
    } finally {
      nodemailer.createTransport = realCreate
    }
    expect(sent.from).to.equal("\"Fresh Bubbles 'Lavandaria'\" <marcacoes@freshbubbles.pt>")
  })

  it('with no MAIL_FROM_NAME, "from" is the bare address (no empty quotes)', async () => {
    process.env.MAIL_HOST = 'smtp-pt.securemail.pro'
    process.env.MAIL_PORT = '465'
    process.env.MAIL_FROM = 'marcacoes@freshbubbles.pt'

    const { sendMail } = await freshMailer()
    const nodemailer = (await import('nodemailer')).default
    let sent = null
    const realCreate = nodemailer.createTransport
    nodemailer.createTransport = () => ({ sendMail: async (msg) => { sent = msg } })
    try {
      await sendMail({ to: 'a@b.com', subject: 's', text: 't' })
    } finally {
      nodemailer.createTransport = realCreate
    }
    expect(sent.from).to.equal('marcacoes@freshbubbles.pt')
  })

  it('rebuilds the transporter when MAIL_HOST changes at runtime, instead of keeping the first (possibly stale/wrong) one', async () => {
    const { sendMail } = await freshMailer()
    const nodemailer = (await import('nodemailer')).default
    const captured = []
    const realCreate = nodemailer.createTransport
    nodemailer.createTransport = (opts) => { captured.push(opts); return { sendMail: async () => {} } }
    try {
      process.env.MAIL_HOST = 'smtp-pt.securemail.pro'
      process.env.MAIL_PORT = '465'
      await sendMail({ to: 'a@b.com', subject: 's', text: 't' })
      await sendMail({ to: 'a@b.com', subject: 's', text: 't' }) // same host: reused, not rebuilt

      process.env.MAIL_HOST = 'smtp.other-provider.example'
      process.env.MAIL_PORT = '587'
      await sendMail({ to: 'a@b.com', subject: 's', text: 't' }) // host changed: must rebuild
    } finally {
      nodemailer.createTransport = realCreate
    }
    expect(captured).to.have.length(2)
    expect(captured.map((c) => c.host)).to.deep.equal(['smtp-pt.securemail.pro', 'smtp.other-provider.example'])
  })

  it('falls back to no-reply@example.com when MAIL_FROM is unset', async () => {
    process.env.MAIL_HOST = 'smtp-pt.securemail.pro'
    process.env.MAIL_PORT = '465'

    const { sendMail } = await freshMailer()
    const nodemailer = (await import('nodemailer')).default
    let sent = null
    const realCreate = nodemailer.createTransport
    nodemailer.createTransport = () => ({ sendMail: async (msg) => { sent = msg } })
    try {
      await sendMail({ to: 'a@b.com', subject: 's', text: 't' })
    } finally {
      nodemailer.createTransport = realCreate
    }
    expect(sent.from).to.equal('no-reply@example.com')
  })
})

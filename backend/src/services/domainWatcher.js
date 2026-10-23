/**
 * Moves a new shop's site address along (central server only):
 *   pending_dns   -> pending_cert   as soon as the customer's DNS points at us (the host service then makes the certificate)
 *   failed        -> pending_dns    again after 30 minutes (until 5 attempts are used)
 *   active        -> e-mails the customer once: "your site is live"
 * The application only reads and writes the database here; creating the certificate is the host's job (scripts/domain-service.sh).
 */
import Tenant from '../models/tenant.js'
import { checkDns } from './storeProvisioning.js'
import { sendMail } from './mailer.js'
import { getSupportEmail } from './platformSettings.js'
import { renderEmailHtml, emailButton, escapeHtml } from './emailTemplate.js'

const EVERY_MS = 2 * 60_000
const RETRY_AFTER_MS = 30 * 60_000
const MAX_ATTEMPTS = 5

export async function tick() {
  // 1. DNS now right?
  for (const t of await Tenant.find({ 'domainState.state': 'pending_dns', 'domains.0': { $exists: true } })) {
    const r = await checkDns(t.domains)
    const bad = r.find((x) => !x.ok)
    t.domainState.checkedAt = new Date()
    if (!bad) { t.domainState.state = 'pending_cert'; t.domainState.message = 'DNS certo: a criar o certificado' }
    else t.domainState.message = `${bad.host}: ${bad.problem}`
    await t.save()
  }
  // 2. a failed attempt is tried again later (not forever: Let's Encrypt has limits)
  for (const t of await Tenant.find({ 'domainState.state': 'failed', 'domainState.attempts': { $lt: MAX_ATTEMPTS }, 'domainState.checkedAt': { $lt: new Date(Date.now() - RETRY_AFTER_MS) } })) {
    t.domainState.state = 'pending_dns'
    await t.save()
  }
  // 2b. out of attempts: the support mailbox is told once (the site cannot be made online without a person looking at it)
  for (const t of await Tenant.find({ 'domainState.state': 'failed', 'domainState.attempts': { $gte: MAX_ATTEMPTS }, 'domainState.failureAlertSentAt': null })) {
    try {
      const to = await getSupportEmail()
      await sendMail({ to, subject: `[Plataforma] O site de ${t.name} não ficou online`, text: `Loja: ${t.name}\nEndereços: ${t.domains.join(', ')}\nÚltimo motivo: ${t.domainState.message}\nAs ${MAX_ATTEMPTS} tentativas automáticas esgotaram-se.` })
      t.domainState.failureAlertSentAt = new Date()
      await t.save()
    } catch (err) { console.warn('[domains] could not send the failure alert:', err.message) }
  }
  // 3. the customer hears when the site is live
  for (const t of await Tenant.find({ 'domainState.state': 'active', 'domainState.activationEmailSentAt': null })) {
    if (!t.customerEmail || !t.domains.length) { t.domainState.activationEmailSentAt = new Date(); await t.save(); continue }
    const host = t.domains.find((d) => !d.startsWith('www.')) || t.domains[0]
    const url = `https://${host}`
    try {
      await sendMail({
        to: t.customerEmail,
        subject: `O site da ${t.name} está ativo`,
        text: `O seu site está ativo: ${url}\nPainel de administração: ${url}/admin/login`,
        html: renderEmailHtml({ title: 'O seu site está ativo', preheader: url, bodyHtml: `<p>O endereço <b>${escapeHtml(host)}</b> já está ligado e com cadeado (https).</p>${emailButton('Abrir o site', url)}<p>Painel de administração: <a href="${escapeHtml(url)}/admin/login">${escapeHtml(url)}/admin/login</a></p>`, brand: { name: process.env.PLATFORM_NAME || 'FreshBubbles' } }),
      })
      t.domainState.activationEmailSentAt = new Date()
      await t.save()
    } catch (err) { console.warn('[domains] could not send the "site is live" e-mail:', err.message) }
  }
}

let timer = null
export function startDomainWatcher() {
  if (timer) return
  const run = () => tick().catch((err) => console.warn('[domains]', err.message))
  timer = setInterval(run, EVERY_MS)
  timer.unref?.()
  setTimeout(run, 20_000).unref?.()
}

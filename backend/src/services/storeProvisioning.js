/**
 * Creating a new shop in one go: the shop itself (EMPTY — nothing is copied from another shop), its administrator, and the
 * e-mail that tells the customer how to point the site address at us and how to set the administrator's password.
 * DNS itself is the customer's step; the domain service on the host (scripts/domain-service.sh) does the rest once it is right.
 */
import crypto from 'crypto'
import dns from 'dns'
import bcrypt from 'bcryptjs'
import Tenant from '../models/tenant.js'
import User from '../models/user.js'
import Setting from '../models/setting.js'
import { sendMail } from './mailer.js'
import { renderEmailHtml, emailButton, escapeHtml } from './emailTemplate.js'
import { usernameTaken } from './ensureIndexes.js'
import { parseDomains, withWww, resetDomainCache } from './tenantDomains.js'
import { resetSoleTenantCache } from '../middleware/tenant.js'
import { DEFAULT_SITE_URL } from '../views/landing.js'
import { getSupportEmail } from './platformSettings.js'

export const serverIp = () => process.env.SERVER_PUBLIC_IP || '128.140.118.209'
const RESET_DAYS = 7
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

async function freeSlug(base) {
  let slug = base || 'loja'
  for (let i = 2; await Tenant.exists({ slug }); i++) slug = `${base || 'loja'}-${i}`
  return slug
}

async function freeUsername(base) {
  let u = base
  for (let i = 2; await usernameTaken(User, u); i++) u = `${base}${i}`
  return u
}

/** What the customer has to create at their registrar. */
export function dnsRecords(domains) {
  const bare = (domains[0] || '').replace(/^www\./, '')
  return [{ type: 'A', name: '@', host: bare, value: serverIp() }, { type: 'A', name: 'www', host: `www.${bare}`, value: serverIp() }]
}

/** Does each address already point to our server? (A records; a leftover AAAA/CNAME is reported because it breaks the site.) */
export async function checkDns(domains) {
  const out = []
  for (const host of domains) {
    const r = { host, a: [], aaaa: [], cname: [], ok: false, problem: '' }
    try { r.a = await dns.promises.resolve4(host) } catch { /* no A record */ }
    try { r.aaaa = await dns.promises.resolve6(host) } catch { /* none */ }
    try { r.cname = await dns.promises.resolveCname(host) } catch { /* none */ }
    r.ok = r.a.includes(serverIp()) && r.a.length === 1 && !r.aaaa.length && !r.cname.length
    if (!r.a.length) r.problem = 'Ainda não aponta para nenhum endereço'
    else if (!r.a.includes(serverIp())) r.problem = `Aponta para ${r.a.join(', ')} em vez de ${serverIp()}`
    else if (r.a.length > 1) r.problem = 'Tem outros endereços além do nosso; apague-os'
    else if (r.aaaa.length) r.problem = 'Tem um registo AAAA (IPv6); apague-o'
    else if (r.cname.length) r.problem = 'Tem um registo CNAME; apague-o'
    out.push(r)
  }
  return out
}

async function newSetPasswordToken(user) {
  const token = crypto.randomBytes(32).toString('hex')
  user.resetPasswordToken = token
  user.resetPasswordExpires = Date.now() + RESET_DAYS * 24 * 3600 * 1000
  await user.save()
  return token
}

export async function sendWelcomeEmail(tenant, adminUser) {
  const token = await newSetPasswordToken(adminUser)
  // The link works from any of our addresses (the token identifies the account), so it does not wait for the customer's DNS.
  const link = `${DEFAULT_SITE_URL}/reset-password?token=${token}`
  const domains = tenant.domains || []
  const recs = dnsRecords(domains)
  const host = recs[0] ? recs[0].host : ''
  const row = (r) => `<tr><td style="padding:6px 10px;border:1px solid #d9f2ee;">${r.type}</td><td style="padding:6px 10px;border:1px solid #d9f2ee;"><b>${escapeHtml(r.name)}</b></td><td style="padding:6px 10px;border:1px solid #d9f2ee;"><b>${escapeHtml(r.value)}</b></td><td style="padding:6px 10px;border:1px solid #d9f2ee;">3600</td></tr>`
  const dnsBlock = domains.length ? `
    <h2 style="font-size:16px;margin:24px 0 8px;">Ligar o seu endereço (${escapeHtml(host)}) — 5 minutos</h2>
    <p>Entre no site onde comprou o domínio (o "registador": por exemplo GoDaddy, Namecheap, OVH, Ex-DNS…), procure <b>DNS</b> ou <b>Gerir DNS</b> e faça isto:</p>
    <ol style="padding-left:18px;">
      <li><b>Apague</b> os registos que já existam para <b>@</b> e <b>www</b> do tipo <b>A</b>, <b>AAAA</b> ou <b>CNAME</b> (podem aparecer com o nome do seu domínio em vez de @).</li>
      <li><b>Crie</b> estes dois registos:</li>
    </ol>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:8px 0 12px;">
      <tr style="background:#f0fdfa;"><td style="padding:6px 10px;border:1px solid #d9f2ee;">Tipo</td><td style="padding:6px 10px;border:1px solid #d9f2ee;">Nome</td><td style="padding:6px 10px;border:1px solid #d9f2ee;">Valor</td><td style="padding:6px 10px;border:1px solid #d9f2ee;">TTL</td></tr>
      ${recs.map(row).join('')}
    </table>
    <p>Grave. Pode demorar de alguns minutos até ao fim do dia a funcionar. <b>Não precisa de fazer mais nada:</b> nós detetamos quando estiver certo, ativamos o site com cadeado (https) e avisamos por email.</p>
    <p style="font-size:13px;color:#3d6a63;">Se não conseguir encontrar estas opções, responda a este email com o nome do site onde comprou o domínio e nós ajudamos.</p>` : ''
  const bodyHtml = `
    <p>Olá,</p>
    <p>A sua loja <b>${escapeHtml(tenant.name)}</b> está criada no nosso sistema (quiosque, painel de administração e site). Falta apenas:</p>
    <h2 style="font-size:16px;margin:16px 0 8px;">1. Definir a sua palavra-passe</h2>
    <p>O seu nome de utilizador é <b>${escapeHtml(adminUser.username)}</b>. Escolha a palavra-passe aqui (a ligação é válida ${RESET_DAYS} dias):</p>
    ${emailButton('Definir palavra-passe', link)}
    ${dnsBlock}
    <p>Obrigado!</p>`
  const text = `A sua loja ${tenant.name} está criada.\n\nUtilizador: ${adminUser.username}\nDefina a palavra-passe (válido ${RESET_DAYS} dias): ${link}\n` +
    (domains.length ? `\nLigar o endereço ${host}: apague os registos A/AAAA/CNAME existentes para @ e www e crie A @ -> ${serverIp()} e A www -> ${serverIp()} (TTL 3600). Detetamos sozinhos quando estiver certo e avisamos.\n` : '')
  const cc = await getSupportEmail()
  await sendMail({ to: tenant.customerEmail, ...(cc ? { bcc: cc } : {}), subject: `A sua loja ${tenant.name} está pronta — falta definir a palavra-passe${domains.length ? ' e ligar o endereço' : ''}`, text, html: renderEmailHtml({ title: `A sua loja ${tenant.name}`, preheader: 'Defina a palavra-passe e ligue o seu endereço.', bodyHtml, brand: { name: process.env.PLATFORM_NAME || 'FreshBubbles' } }) })
  tenant.welcomeEmail = { sentAt: new Date(), error: '' }
  await tenant.save()
}

/**
 * @returns {{ tenant, admin, emailError }}  A thrown error carries `.status` and a message for the superadmin.
 */
export async function createStore({ name, slug, domains, customerEmail, adminUsername }) {
  const fail = (status, message) => Object.assign(new Error(message), { status })
  name = String(name || '').trim()
  if (!name) throw fail(400, 'Falta o nome da loja')
  customerEmail = String(customerEmail || '').trim().toLowerCase()
  if (customerEmail && !EMAIL_RE.test(customerEmail)) throw fail(400, 'Email do cliente inválido')
  const parsed = parseDomains(domains)
  if (parsed.error) throw fail(400, parsed.error)
  const list = parsed.list.length ? [...new Set(parsed.list.flatMap((h) => withWww(h)))] : []
  if (list.length && await Tenant.exists({ domains: { $in: list } })) throw fail(409, 'Um destes endereços já pertence a outra loja')
  const base = slugify(slug || name)
  if (slug && await Tenant.exists({ slug: base })) throw fail(409, 'Já existe uma loja com este identificador')
  const finalSlug = slug ? base : await freeSlug(base)
  const username = await freeUsername(slugify(adminUsername || '') || finalSlug)
  const tenant = await Tenant.create({ name, slug: finalSlug, domains: list, customerEmail, domainState: { state: list.length ? 'pending_dns' : 'none', requestedAt: list.length ? new Date() : null } })
  resetSoleTenantCache(); resetDomainCache()
  // A password nobody knows: the administrator sets their own through the e-mailed link.
  const admin = await User.create({ tenantId: tenant._id, username, email: customerEmail || null, role: 'ADMIN', password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10) })
  // The customer's address is also the shop's support address from day one (alerts and replies reach somebody); the shop can change it.
  if (customerEmail) await Setting.updateOne({ tenantId: tenant._id, key: 'support.email' }, { $set: { value: customerEmail } }, { upsert: true })
  let emailError = ''
  if (customerEmail) {
    try { await sendWelcomeEmail(tenant, admin) } catch (err) {
      emailError = err.message || 'falhou o envio'
      tenant.welcomeEmail = { sentAt: null, error: emailError }
      await tenant.save()
    }
  }
  return { tenant, admin, emailError }
}

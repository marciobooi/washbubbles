/**
 * Operator email alerts — hardware faults, low change, kiosk gone quiet.
 * Reuses the existing mailer; a tenant with no `alerts.email` setting simply
 * gets no alerts, silently, rather than an error surfacing anywhere a
 * customer could see it.
 */
import { getEmailBrand } from './emailBrand.js'
import Setting from '../models/setting.js'
import { sendMail } from './mailer.js'
import { renderEmailHtml, escapeHtmlMultiline, escapeHtml } from './emailTemplate.js'
import { alertTypeOf, effectivePrefs } from './alertTypes.js'

// What the admin chose to receive (setting alerts.prefs: { key: true|false }), read at most every 30 s per shop.
const prefsCache = new Map()
export function resetAlertPrefsCache() { prefsCache.clear() }
async function savedPrefs(tenantId) {
  const k = String(tenantId)
  const hit = prefsCache.get(k)
  if (hit && Date.now() - hit.at < 30_000) return hit.prefs
  let prefs = {}
  try { prefs = (await Setting.findOne({ tenantId, key: 'alerts.prefs' }).lean())?.value || {} } catch { /* the defaults apply */ }
  prefsCache.set(k, { at: Date.now(), prefs })
  return prefs
}

/** Does this shop want this alert (or report)? An alert nobody listed is always sent. */
export async function alertEnabled(tenantId, subjectOrKey, explicit = null) {
  const type = alertTypeOf(subjectOrKey, explicit || subjectOrKey)
  if (!type) return true
  return effectivePrefs(await savedPrefs(tenantId))[type.key]
}

export async function sendAlertForTenant(tenantId, subject, message, type = null) {
  try {
    if (!tenantId) return
    if (!(await alertEnabled(tenantId, subject, type))) { console.log(`[Alerts] "${subject}" not sent: switched off by the admin`); return }
    const rows = await Setting.find({ tenantId, key: { $in: ['alerts.email', 'support.email'] } }).lean()
    const val = (k) => rows.find((r) => r.key === k)?.value
    const to = val('alerts.email') || val('support.email') // the support address is where alerts go unless a separate alerts address is set
    if (!to) return
    const K = await import('./emailKit.js')
    const good = /online outra vez|recuperad|voltou|resolvid/i.test(subject)
    const when = new Date().toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
    const bodyHtml = `<div style="margin-bottom:14px;">${K.badge(good ? 'Resolvido' : 'Atenção', good ? 'green' : 'amber')}<span style="font-size:12px;color:#94a3b8;margin-left:10px;">${escapeHtml(when)}</span></div>
      ${K.note({ tone: good ? 'green' : 'amber', html: `<div style="font-size:14px;line-height:1.7;color:#0f172a;">${escapeHtmlMultiline(message)}</div>` })}`
    await sendMail({
      tenantId,
      to,
      subject: `[WashBubbles] ${subject}`,
      text: message,
      html: renderEmailHtml({ title: subject, bodyHtml, brand: await getEmailBrand(tenantId) }),
    })
  } catch (err) {
    // An alert failing to send must never surface to whatever triggered
    // it (a kiosk push, a customer-facing request) — log and move on.
    console.error('[Alerts] Failed to send:', err.message)
  }
}

/** Convenience for use inside a request handler, where `req.tenantId` is already resolved. */
export async function sendAlert(req, subject, message, type = null) {
  return sendAlertForTenant(req.tenantId, subject, message, type)
}

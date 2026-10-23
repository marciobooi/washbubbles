/**
 * Operator email alerts — hardware faults, low change, kiosk gone quiet.
 * Reuses the existing mailer; a tenant with no `alerts.email` setting simply
 * gets no alerts, silently, rather than an error surfacing anywhere a
 * customer could see it.
 */
import { getEmailBrand } from './emailBrand.js'
import Setting from '../models/setting.js'
import { sendMail } from './mailer.js'
import { renderEmailHtml, escapeHtmlMultiline } from './emailTemplate.js'

export async function sendAlertForTenant(tenantId, subject, message) {
  try {
    if (!tenantId) return
    const row = await Setting.findOne({ tenantId, key: 'alerts.email' })
    const to = row?.value
    if (!to) return
    const bodyHtml = `<p>${escapeHtmlMultiline(message)}</p>`
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
export async function sendAlert(req, subject, message) {
  return sendAlertForTenant(req.tenantId, subject, message)
}

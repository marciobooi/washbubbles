/**
 * Shared branded HTML shell for outbound email (password reset, receipts,
 * day-close reports, operator alerts, marketing broadcasts — see mailer.js's
 * callers). Table-based layout and no CSS custom properties on purpose: this
 * has to render in Outlook desktop (Word's rendering engine — no flexbox,
 * no grid, no var()) as well as Gmail/Apple Mail, so it deliberately does
 * not reuse anything from views/landing.js's CSS, which only ever has to
 * run in real browsers.
 *
 * Every sendMail() call should pass both `text` and `html` — a real
 * multipart/alternative message is itself a small deliverability signal, on
 * top of just looking better. `bodyHtml` passed in here is trusted,
 * already-built HTML; escape any dynamic text with escapeHtml()/
 * escapeHtmlMultiline() before interpolating it into that HTML yourself.
 */

import * as KIT from './emailKit.js'

const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://freshbubbles.pt'
const LOGO_URL = `${SITE_URL}/geral/freshbubbleslogo.png`
const BRAND = {
  name: 'Fresh Bubbles',
  address: 'Av. Dr. António Carvalho de Figueiredo 35A, 2670-407 Loures',
  phone: '+351 912 715 258',
  email: 'marcacoes@freshbubbles.pt',
}

const INK = '#0f2a27'
const INK_SOFT = '#3d6a63'
const PRIMARY = '#0d9488'
const PRIMARY_DARK = '#0f766e'
const PRIMARY_BG = '#f0fdfa'
const BORDER = '#d9f2ee'

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** Escapes text and turns newlines into <br> — for admin/free-text bodies (the marketing broadcast) where line breaks matter but nothing else should be interpreted as HTML. */
export const escapeHtmlMultiline = (s) => escapeHtml(s).replace(/\n/g, '<br>')

/** A bulletproof-enough button: a padded, background-colored table cell renders correctly in Outlook desktop, unlike a styled <a> or <button>. */
export function emailButton(label, href) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr>
      <td bgcolor="#0d7a73" style="border-radius:12px;">
        <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block; padding:12px 28px; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:12px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`
}

/**
 * Wraps `bodyHtml` in the branded shell: logo header, a white content card,
 * and a footer with real contact facts (same ones the public landing page
 * uses — see views/landing.js's DEFAULT_CONTENT.brand).
 */
/** The shop's brand with the built-in defaults filled in (same rule as renderEmailHtml). */
export function resolveBrand(brand = {}) {
  const pick = (v, d) => (v && String(v).trim() ? String(v).trim() : d)
  const own = !!(brand && brand.name)
  return {
    name: pick(brand.name, BRAND.name),
    address: pick(brand.address, own ? '' : BRAND.address),
    phone: pick(brand.phone, own ? '' : BRAND.phone),
    email: pick(brand.email, own ? '' : BRAND.email),
    logo: pick(brand.logo, own ? '' : LOGO_URL),
    tagline: brand.tagline != null ? String(brand.tagline) : (own ? '' : 'Laundry & Ironing'),
  }
}

/** wide: about the width of an A4 page (800 px) and the body is NOT wrapped in one white card (a report brings its own boxes). */
export function renderEmailHtml({ title, preheader, bodyHtml, brand = {}, wide = false, bare = false }) {
  // bare: only the page background and the width; the body brings its own header, card and footer (the day-close report)
  if (bare) {
    return `<!DOCTYPE html>
<html lang="pt-PT"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title || '')}</title></head>
<body style="margin:0; padding:0; background:#f1f5f9; font-family:Arial,Helvetica,sans-serif;">
  ${preheader ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:900px;"><tr><td>${bodyHtml}</td></tr></table>
  </td></tr></table>
</body></html>`
  }
  // The shop's own name, logo and contact from the admin (services/emailBrand.js) win over the built-in defaults.
  // The shared look (services/emailKit.js): one white card with the brand header, the message, and the contact footer.
  const b = resolveBrand(brand)
  const inner = `${KIT.header({ brand: b, title: title || '' })}<div style="padding-top:24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#334155;">${bodyHtml}</div>${KIT.footer({ brand: b })}`
  return `<!DOCTYPE html>
<html lang="pt-PT"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title || b.name)}</title></head>
<body style="margin:0; padding:0; background:#f1f5f9; font-family:Arial,Helvetica,sans-serif;">
  ${preheader ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${wide ? 820 : 640}px;"><tr><td>${KIT.card(inner)}</td></tr></table>
  </td></tr></table>
</body>
</html>`
}

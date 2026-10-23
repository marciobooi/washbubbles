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
      <td bgcolor="${PRIMARY}" style="border-radius:8px;">
        <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block; padding:12px 28px; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:8px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`
}

/**
 * Wraps `bodyHtml` in the branded shell: logo header, a white content card,
 * and a footer with real contact facts (same ones the public landing page
 * uses — see views/landing.js's DEFAULT_CONTENT.brand).
 */
export function renderEmailHtml({ title, preheader, bodyHtml, brand = {} }) {
  // The shop's own name, logo and contact from the admin (services/emailBrand.js) win over the built-in defaults.
  const pick = (v, d) => (v && String(v).trim() ? String(v).trim() : d)
  // A shop that has its own brand never borrows FreshBubbles' address, phone, e-mail or logo: what it lacks is simply left out.
  const own = !!(brand && brand.name)
  const B = { name: pick(brand.name, BRAND.name), address: pick(brand.address, own ? '' : BRAND.address), phone: pick(brand.phone, own ? '' : BRAND.phone), email: pick(brand.email, own ? '' : BRAND.email) }
  const logo = pick(brand.logo, own ? '' : LOGO_URL)
  const tagline = brand.tagline != null ? String(brand.tagline) : (own ? '' : 'Laundry & Ironing')
  const footLine1 = [B.name, B.address].filter(Boolean).map(escapeHtml).join(' &middot; ')
  const footLine2 = [B.phone ? escapeHtml(B.phone) : '', B.email ? `<a href="mailto:${escapeHtml(B.email)}" style="color:${PRIMARY_DARK};">${escapeHtml(B.email)}</a>` : ''].filter(Boolean).join(' &middot; ')
  return `<!DOCTYPE html>
<html lang="pt-PT">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${escapeHtml(title || B.name)}</title>
</head>
<body style="margin:0; padding:0; background:${PRIMARY_BG}; font-family:Arial,Helvetica,sans-serif;">
  ${preheader ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PRIMARY_BG};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              ${logo ? `<img src="${escapeHtml(logo)}" width="56" height="56" alt="${escapeHtml(B.name)}" style="display:block;">` : ''}
              <div style="margin-top:10px; font-family:Arial,Helvetica,sans-serif; font-size:18px; font-weight:bold; color:${INK};">${escapeHtml(B.name)}</div>
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:${INK_SOFT};">${escapeHtml(tagline)}</div>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff; border:1px solid ${BORDER}; border-radius:16px; padding:32px;">
              ${title ? `<h1 style="margin:0 0 16px; font-family:Arial,Helvetica,sans-serif; font-size:20px; color:${INK};">${escapeHtml(title)}</h1>` : ''}
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.6; color:${INK};">
                ${bodyHtml}
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 12px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:${INK_SOFT}; line-height:1.6;">
              ${footLine1}${footLine2 ? '<br>' : ''}
              ${footLine2}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

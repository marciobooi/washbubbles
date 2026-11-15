/**
 * The building blocks of every e-mail the system sends (reports for the admin, receipts and notices for customers): the same look,
 * adapted to what each message says. Tables and inline styles only (Outlook, Gmail and Apple Mail), no scripts, no gradients.
 *
 *   card(inner)                     the one big white card the whole message sits in
 *   header({ brand, title, subtitle, meta })   logo + name on the left, title under it, an optional "ficha" box on the right
 *   footer({ brand, line })         address, phone, e-mail and a small generated-at line
 *   boxRow([cells])                 boxes side by side, always the same height (each box is a table cell)
 *   kpi({ label, value, unit, sub, tone })     a number tile
 *   panel({ title, subtitle, tag, inner, foot, width })   a titled box (a cell of a boxRow)
 *   kv(rows)                        label / value rows ("(+) ...", totals, tones)
 *   note({ text, tone })            a coloured notice
 *   badge(text, tone), avatar(initials)
 */
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const T = {
  ink: '#0f172a', text: '#334155', soft: '#64748b', faint: '#94a3b8', line: '#e2e8f0', hair: '#f1f5f9', tint: '#f8fafc',
  teal: '#0d7a73', tealDark: '#0f766e', tealTint: '#f0fdfa', tealLine: '#99f6e4',
  rose: '#e11d48', roseDark: '#be123c', roseTint: '#fff1f2', roseLine: '#fecdd3',
  green: '#059669', greenDark: '#047857', greenTint: '#ecfdf5', greenLine: '#a7f3d0',
  amber: '#f59e0b', amberDark: '#b45309', amberTint: '#fffbeb', amberLine: '#fde68a',
  sky: '#0284c7', orange: '#f97316', red: '#ef4444',
}

const TONES = {
  neutral: { bg: T.tint, line: T.line, label: T.soft, value: T.ink },
  teal: { bg: T.tealTint, line: T.tealLine, label: T.tealDark, value: T.teal },
  rose: { bg: T.roseTint, line: T.roseLine, label: T.roseDark, value: T.rose },
  green: { bg: T.greenTint, line: T.greenLine, label: T.greenDark, value: T.green },
  amber: { bg: T.amberTint, line: T.amberLine, label: T.amberDark, value: T.amberDark },
}
const tone = (t) => TONES[t] || TONES.neutral
const F = 'Arial,Helvetica,sans-serif'

export const eur = (n) => `${Number(n || 0).toFixed(2).replace('.', ',')} €`
export const initials = (s) => String(s || '').trim().split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·'

export function badge(text, t = 'green') {
  const c = tone(t)
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${c.bg};border:1px solid ${c.line};font-size:11px;font-weight:bold;color:${c.label};">${escapeHtml(text)}</span>`
}

export function avatar(text) {
  return `<span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:12px;background:${T.teal};color:#ffffff;font-size:10px;font-weight:bold;text-align:center;vertical-align:middle;">${escapeHtml(initials(text))}</span>`
}

/** The one big white card. */
export function card(inner) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${T.line};border-radius:24px;"><tr><td style="padding:32px;font-family:${F};color:${T.text};">${inner}</td></tr></table>`
}

export function header({ brand, title, subtitle = '', meta = '' }) {
  const logo = brand.logo ? `<img src="${escapeHtml(brand.logo)}" width="44" height="44" alt="" style="display:block;border:0;">` : ''
  const left = `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
      ${logo ? `<td width="56" valign="middle">${logo}</td>` : ''}
      <td valign="middle"><div style="font-size:20px;font-weight:bold;color:${T.ink};line-height:1.1;">${escapeHtml(brand.name)}</div>
      ${brand.tagline ? `<div style="font-size:10px;font-weight:bold;letter-spacing:2px;color:${T.tealDark};text-transform:uppercase;margin-top:4px;">${escapeHtml(brand.tagline)}</div>` : ''}</td>
    </tr></table>
    <div style="font-size:26px;font-weight:bold;color:${T.ink};margin-top:18px;line-height:1.2;">${escapeHtml(title)}</div>
    ${subtitle ? `<div style="font-size:13px;color:${T.soft};margin-top:4px;">${escapeHtml(subtitle)}</div>` : ''}`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${T.hair};"><tr>
    <td valign="top" style="padding-bottom:24px;">${left}</td>
    ${meta ? `<td valign="top" width="270" style="padding:0 0 24px 20px;">${meta}</td>` : ''}
  </tr></table>`
}

/** The "ficha" box on the right of the header: [label, value] lines, then an optional last line. */
export function meta(lines, last = '') {
  const row = ([k, v]) => `<tr><td style="padding:4px 0;font-size:12px;color:${T.faint};font-weight:bold;">${escapeHtml(k)}</td><td style="padding:4px 0;font-size:12px;color:${T.ink};font-weight:bold;text-align:right;">${escapeHtml(v)}</td></tr>`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${T.tint};border:1px solid ${T.line};border-radius:16px;"><tr><td style="padding:14px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lines.map(row).join('')}</table>
    ${last ? `<div style="border-top:1px solid ${T.line};margin-top:8px;padding-top:10px;">${last}</div>` : ''}
  </td></tr></table>`
}

export function footer({ brand, line = '' }) {
  const mail = brand.email ? `<a href="mailto:${escapeHtml(brand.email)}" style="color:${T.tealDark};text-decoration:none;">${escapeHtml(brand.email)}</a>` : ''
  const bits = [...[brand.name, brand.address, brand.phone].filter(Boolean).map(escapeHtml), mail].filter(Boolean).join(' &nbsp;·&nbsp; ')
  return `<div style="border-top:1px solid ${T.line};margin-top:32px;padding-top:20px;text-align:center;font-size:12px;color:${T.soft};">
    ${bits}${line ? `<div style="font-size:11px;color:${T.faint};margin-top:10px;">${escapeHtml(line)}</div>` : ''}</div>`
}

const GAP = '<td width="16" style="width:16px;font-size:0;line-height:0;">&nbsp;</td>'

/** Boxes side by side. Each cell is itself the box, so the cells of a row always have the same height. */
export function boxRow(cells, top = 24) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:${top}px;border-collapse:separate;"><tr>${cells.join(GAP)}</tr></table>`
}

export function kpi({ label, value, unit = '€', sub = '', tone: t = 'neutral', width = '24%' }) {
  const c = tone(t)
  return `<td width="${width}" valign="top" style="background:${c.bg};border:1px solid ${c.line};border-radius:16px;padding:16px 16px;">
    <div style="font-size:10px;font-weight:bold;color:${c.label};text-transform:uppercase;letter-spacing:.8px;">${escapeHtml(label)}</div>
    <div style="font-size:25px;font-weight:bold;color:${c.value};margin-top:6px;line-height:1.1;">${escapeHtml(value)}${unit ? ` <span style="font-size:16px;color:${T.soft};">${escapeHtml(unit)}</span>` : ''}</div>
    ${sub ? `<div style="font-size:11px;color:${T.soft};margin-top:6px;line-height:1.5;">${sub}</div>` : ''}
  </td>`
}

/** A titled box. `inner` is trusted HTML; title, subtitle and tag are escaped here. */
export function panel({ title, subtitle = '', tag = '', inner, foot = '', width = '49%', flush = false }) {
  const head = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="top"><div style="font-size:14px;font-weight:bold;color:${T.ink};">${escapeHtml(title)}</div>${subtitle ? `<div style="font-size:11px;color:${T.soft};margin-top:2px;">${escapeHtml(subtitle)}</div>` : ''}</td>
      ${tag ? `<td valign="top" align="right" style="white-space:nowrap;"><span style="display:inline-block;padding:4px 10px;border-radius:8px;background:${T.hair};font-size:11px;font-weight:bold;color:${T.soft};">${escapeHtml(tag)}</span></td>` : ''}
    </tr></table>`
  return `<td width="${width}" valign="top" style="background:#ffffff;border:1px solid ${T.line};border-radius:16px;padding:18px 20px;"><table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" style="height:100%;"><tr><td valign="top" height="100%" style="height:100%;">${head}<div style="margin-top:14px;">${inner}</div></td></tr>${foot ? `<tr><td valign="bottom" style="padding-top:14px;">${foot}</td></tr>` : ''}</table></td>`
}

/** Label / value rows. opt: bold, soft, color, sign ('(+)', '(-)', '(=)'), dot (a colour), bg (row tint). */
export function kv(list, { size = 12 } = {}) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list.map(([label, value, o = {}]) => {
    const col = o.color || (o.soft ? T.soft : T.ink)
    const lead = o.dot ? `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${o.dot};margin-right:8px;"></span>` : o.sign ? `<span style="font-weight:bold;color:${o.signColor || T.soft};margin-right:6px;">${escapeHtml(o.sign)}</span>` : ''
    return `<tr${o.bg ? ` style="background:${o.bg};"` : ''}>
      <td style="padding:9px ${o.bg ? 10 : 0}px;border-bottom:1px solid ${T.hair};font-size:${size}px;color:${o.soft ? T.soft : T.text};${o.bold ? 'font-weight:bold;color:' + T.ink + ';' : ''}">${lead}${escapeHtml(label)}</td>
      <td style="padding:9px ${o.bg ? 10 : 0}px;border-bottom:1px solid ${T.hair};font-size:${size}px;text-align:right;white-space:nowrap;font-family:Menlo,Consolas,monospace;color:${col};${o.bold ? 'font-weight:bold;' : ''}">${escapeHtml(value)}</td>
    </tr>`
  }).join('')}</table>`
}

/** A coloured notice. `html` is trusted. */
export function note({ html, tone: t = 'neutral', height = 0 }) {
  const c = tone(t)
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td ${height ? `height="${height}" ` : ''}valign="middle" style="background:${c.bg};border:1px solid ${c.line};border-radius:12px;padding:10px 12px;font-size:11px;line-height:1.6;color:${T.text};">${html}</td></tr></table>`
}

/** A thin progress bar (a two-cell table: works everywhere). */
export function bar(pct, color) {
  const p = Math.max(0, Math.min(100, Math.round(pct)))
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;"><tr>
    ${p > 0 ? `<td width="${p}%" height="6" style="background:${color};border-radius:3px;font-size:0;line-height:0;">&nbsp;</td>` : ''}
    <td${p < 100 ? '' : ' width="0"'} height="6" style="background:${T.hair};border-radius:3px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`
}

/** The head of a box: title, subtitle and an optional tag on the right. */
function panelHead({ title, subtitle = '', tag = '' }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="top"><div style="font-size:14px;font-weight:bold;color:${T.ink};">${escapeHtml(title)}</div>${subtitle ? `<div style="font-size:11px;color:${T.soft};margin-top:2px;">${escapeHtml(subtitle)}</div>` : ''}</td>
      ${tag ? `<td valign="top" align="right" style="white-space:nowrap;"><span style="display:inline-block;padding:4px 10px;border-radius:8px;background:${T.hair};font-size:11px;font-weight:bold;color:${T.soft};">${escapeHtml(tag)}</span></td>` : ''}
    </tr></table>`
}

/**
 * Boxes side by side: [{ title, subtitle, tag, inner, foot, width }]. Every box is a body cell with its foot cell right under it
 * (a second table row), so the bodies are always the same height and the feet always on the same line. A box with no foot
 * still gets an empty foot cell, so the row stays aligned.
 */
export function panelRow(specs, top = 24) {
  const anyFoot = specs.some((s) => s.foot)
  const edge = `background:#ffffff;border:1px solid ${T.line};`
  const body = specs.map((s) => `<td width="${s.width || (specs.length === 1 ? '100%' : Math.floor(96 / specs.length) + '%')}" valign="top" style="${edge}${anyFoot ? 'border-bottom:0;border-radius:16px 16px 0 0;padding:18px 20px 0;' : 'border-radius:16px;padding:18px 20px;'}">${panelHead(s)}<div style="margin-top:14px;">${s.inner}</div></td>`)
  const foot = specs.map((s) => `<td valign="bottom" style="${edge}border-top:0;border-radius:0 0 16px 16px;padding:14px 20px 18px;">${s.foot || ''}</td>`)
  const gap = `<td rowspan="2" width="16" style="width:16px;font-size:0;line-height:0;">&nbsp;</td>`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:${top}px;border-collapse:separate;"><tr>${body.join(gap)}</tr>${anyFoot ? `<tr>${foot.join('')}</tr>` : ''}</table>`
}

/** A section for a longer text (observations, a message): one full-width box. */
export function wide({ title, subtitle = '', tag = '', inner }) {
  return panelRow([{ title, subtitle, tag, inner, width: '100%' }])
}

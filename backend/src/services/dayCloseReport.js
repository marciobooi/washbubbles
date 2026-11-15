/**
 * The day-close report sent by e-mail when a close is confirmed (and by the "send by e-mail" button): big numbers first, how the
 * money came in, two pie charts, the till, the deposit. Plain HTML tables (what every mail client shows); the charts are PNG images
 * made here with sharp and attached inline (cid:), because Gmail and Outlook show neither SVG nor scripts.
 */
import sharp from 'sharp'
import Sale from '../models/sale.js'
import Machine from '../models/machine.js'
import { escapeHtml } from './emailTemplate.js'

export const COLORS = { cash: '#0f766e', mbway: '#d3101c', topup: '#f59e0b', wash: '#0ea5e9', dry: '#f97316', other: '#94a3b8' }
const INK = '#1f2937'
const SOFT = '#6b7280'
const LINE = '#e5e7eb'

const eur = (n) => `${Number(n || 0).toFixed(2).replace('.', ',')} €`
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100
const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0)

/** A donut chart (no text: the legend is HTML next to it) as a PNG buffer, drawn twice the size it is shown for sharp screens. */
export async function donutPng(slices, size = 220) {
  const s = size * 2
  const cx = s / 2; const cy = s / 2; const R = s / 2 - 4; const r = R * 0.58
  const total = slices.reduce((a, b) => a + Math.max(0, b.value), 0)
  let paths = ''
  if (!(total > 0)) {
    paths = `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${LINE}" stroke-width="${R - r}"/>`
  } else {
    const live = slices.filter((x) => x.value > 0)
    if (live.length === 1) {
      paths = `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${live[0].color}" stroke-width="${R - r}"/>`
    } else {
      let a0 = -Math.PI / 2
      for (const x of live) {
        const a1 = a0 + (x.value / total) * Math.PI * 2
        const large = a1 - a0 > Math.PI ? 1 : 0
        const p = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`
        paths += `<path d="M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z" fill="${x.color}" stroke="#ffffff" stroke-width="4"/>`
        a0 = a1
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${paths}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** The numbers of a close: what the record holds, plus the split by service read from the sales it covered. */
export async function reportData(dc) {
  let sales = await Sale.find({ tenantId: dc.tenantId, dayCloseId: dc._id }).lean()
  if (!sales.length && dc.periodFrom) sales = await Sale.find({ tenantId: dc.tenantId, createdAt: { $gt: new Date(dc.periodFrom), $lte: new Date(dc.periodTo || dc.createdAt) } }).lean()
  const ids = [...new Set(sales.map((s) => s.machineId && String(s.machineId)).filter(Boolean))]
  const machines = ids.length ? await Machine.find({ _id: { $in: ids } }).select('name type').lean() : []
  const mById = Object.fromEntries(machines.map((m) => [String(m._id), m]))
  const use = { wash: { n: 0, eur: 0 }, dry: { n: 0, eur: 0 } }
  const perMachine = {}
  for (const s of sales) {
    if (s.type !== 'payment' || s.status === 'refunded' || !s.machineId) continue
    const m = mById[String(s.machineId)]
    if (!m) continue
    const k = m.type === 'dry' ? 'dry' : 'wash'
    use[k].n += 1; use[k].eur += Number(s.amount || 0)
    perMachine[m.name] = (perMachine[m.name] || 0) + 1
  }
  const refunds = sales.filter((s) => s.type === 'refund').reduce((a, s) => a + Math.abs(Number(s.amount || 0)), 0)
  const cashTotal = r2(dc.totalCash)
  const cashTopups = r2(Math.max(0, Math.min(cashTotal, Number(dc.totalRecharges || 0))))
  const bank = dc.metadata?.bank || null
  return {
    from: dc.periodFrom ? new Date(dc.periodFrom) : null,
    to: new Date(dc.periodTo || dc.createdAt),
    closedBy: dc.closedByUsername || '',
    revenue: r2(dc.totalSales),
    cashServices: r2(cashTotal - cashTopups),
    cashTopups,
    cashTotal,
    mbway: r2(dc.totalMbway),
    cardSpent: r2(dc.totalCard),
    refunds: r2(refunds),
    salesCount: Number(dc.salesCount || sales.length || 0),
    use: { wash: { n: use.wash.n, eur: r2(use.wash.eur) }, dry: { n: use.dry.n, eur: r2(use.dry.eur) } },
    topMachines: Object.entries(perMachine).sort((a, b) => b[1] - a[1]).slice(0, 5),
    openingFloat: r2(Number(dc.openingFloat || 0)),
    floatAdded: r2(dc.floatAdded),
    floatWithdrawn: r2(dc.floatWithdrawn),
    expected: r2(dc.expectedCash),
    counted: r2(dc.countedCash),
    discrepancy: r2(dc.discrepancy),
    toBank: r2(dc.amountToBank),
    bankNotes: bank ? r2((bank.notes || []).reduce((a, d) => a + Number(d.value) * Number(d.count), 0)) : null,
    bankCoins: bank ? r2(bank.coins) : null,
    floatLeft: r2(dc.floatLeft),
    change: r2(dc.totalChangeDispensed),
    notes: dc.notes || '',
  }
}

const dateLong = (d) => { const t = d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Lisbon' }); return t.charAt(0).toUpperCase() + t.slice(1) }
const timeShort = (d) => d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' })

/** A box that IS a table cell: the cells of one row always have the same height, in every mail client. */
const CELL = `background:#ffffff;border:1px solid ${LINE};border-radius:14px;`
const GAP = '<td width="12" style="font-size:0;line-height:0;">&nbsp;</td>'

/** A row of boxes of equal height, with a gap between them. */
function boxRow(cells, top = 16) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:${top}px;border-collapse:separate;"><tr>${cells.join(GAP)}</tr></table>`
}

function tile(label, value, color = INK, sub = '') {
  return `<td width="25%" valign="top" style="${CELL}padding:14px 16px;">
      <div style="font-size:12px;color:${SOFT};text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(label)}</div>
      <div style="font-size:26px;font-weight:bold;color:${color};margin-top:4px;">${escapeHtml(value)}</div>
      ${sub ? `<div style="font-size:12px;color:${SOFT};margin-top:2px;">${escapeHtml(sub)}</div>` : ''}
    </td>`
}

/** A titled box as a cell of a boxRow. */
function cellBox(title, inner, width = '50%') {
  return `<td width="${width}" valign="top" style="${CELL}padding:20px 24px;">${title ? `<div style="font-size:16px;font-weight:bold;color:${INK};margin-bottom:12px;">${escapeHtml(title)}</div>` : ''}${inner}</td>`
}

function legend(items, total) {
  return items.map((x) => `<tr>
    <td style="padding:5px 0;width:16px;" valign="middle"><div style="width:12px;height:12px;border-radius:3px;background:${x.color};"></div></td>
    <td style="padding:5px 8px;font-size:14px;color:${INK};">${escapeHtml(x.label)}</td>
    <td style="padding:5px 0;font-size:14px;color:${INK};text-align:right;white-space:nowrap;"><b>${escapeHtml(x.text)}</b> <span style="color:${SOFT};">${pct(x.value, total)}%</span></td>
  </tr>`).join('')
}

function chartBlock(title, cid, items, total, note = '') {
  return cellBox(title, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="190" valign="middle" align="center"><img src="cid:${cid}" width="170" height="170" alt="" style="display:block;"></td>
      <td style="padding-left:20px;" valign="middle"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${legend(items, total)}</table>
      ${note ? `<div style="font-size:12px;color:${SOFT};margin-top:8px;">${escapeHtml(note)}</div>` : ''}</td>
    </tr></table>`)
}

/** One module = one white box with its own title. */
function box(title, inner, extra = '') {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${LINE};border-radius:14px;margin-top:16px;${extra}">
    <tr><td style="padding:20px 24px;">${title ? `<div style="font-size:16px;font-weight:bold;color:${INK};margin-bottom:12px;">${escapeHtml(title)}</div>` : ''}${inner}</td></tr></table>`
}

function rows(list) {
  return list.map(([label, value, opt = {}]) => `<tr>
    <td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${opt.soft ? SOFT : INK};${opt.bold ? 'font-weight:bold;' : ''}">${escapeHtml(label)}</td>
    <td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;text-align:right;white-space:nowrap;color:${opt.color || (opt.soft ? SOFT : INK)};${opt.bold ? 'font-weight:bold;' : ''}">${escapeHtml(value)}</td>
  </tr>`).join('')
}

/** subject, text, the inner HTML (to go inside renderEmailHtml) and the chart images to attach. */
export async function buildDayCloseReport(dc) {
  const d = await reportData(dc)
  const diffColor = Math.abs(d.discrepancy) < 0.005 ? '#15803d' : d.discrepancy < 0 ? '#b91c1c' : '#b45309'
  const diffText = Math.abs(d.discrepancy) < 0.005 ? 'Certo' : `${d.discrepancy > 0 ? '+' : ''}${eur(d.discrepancy)}`

  const pay = [
    { label: 'Dinheiro (máquinas)', value: d.cashServices, color: COLORS.cash, text: eur(d.cashServices) },
    { label: 'Carregamentos', value: d.cashTopups, color: COLORS.topup, text: eur(d.cashTopups) },
    { label: 'MB WAY', value: d.mbway, color: COLORS.mbway, text: eur(d.mbway) },
  ]
  const useItems = [
    { label: `Lavagens (${d.use.wash.n})`, value: d.use.wash.eur, color: COLORS.wash, text: eur(d.use.wash.eur) },
    { label: `Secagens (${d.use.dry.n})`, value: d.use.dry.eur, color: COLORS.dry, text: eur(d.use.dry.eur) },
  ]
  const useTotal = d.use.wash.eur + d.use.dry.eur
  const attachments = [
    { filename: 'pagamentos.png', cid: 'chart-pay', contentType: 'image/png', content: await donutPng(pay) },
    { filename: 'servicos.png', cid: 'chart-use', contentType: 'image/png', content: await donutPng(useItems) },
  ]

  const period = d.from && d.from.getTime() > 0 ? `${timeShort(d.from)} → ${timeShort(d.to)}` : `até ${timeShort(d.to)}`
  const bankSub = d.bankNotes != null ? `${eur(d.bankNotes)} em notas + ${eur(d.bankCoins)} em moedas` : ''

  const vendas = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows([
      ['Dinheiro (máquinas)', eur(d.cashServices)],
      ['Carregamentos e cartões novos (dinheiro)', eur(d.cashTopups)],
      ['MB WAY', eur(d.mbway)],
      ['Total faturado', eur(d.revenue), { bold: true }],
      ['Pago com cartão (saldo já contado)', eur(d.cardSpent), { soft: true }],
      ...(d.refunds > 0 ? [['Reembolsos', `-${eur(d.refunds)}`, { soft: true }]] : []),
    ])}</table>`
  const caixa = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows([
      ['Fundo no início', eur(d.openingFloat)],
      ['Dinheiro que entrou', eur(d.cashTotal)],
      ...(d.floatAdded > 0 ? [['Fundo adicionado', eur(d.floatAdded)]] : []),
      ...(d.floatWithdrawn > 0 ? [['Levantamentos', `-${eur(d.floatWithdrawn)}`]] : []),
      ['Esperado na máquina', eur(d.expected)],
      ['Contado', eur(d.counted), { bold: true }],
      ['Diferença', diffText, { bold: true, color: diffColor }],
      ['Depositado no banco', eur(d.toBank), { bold: true }],
      ...(d.bankNotes != null ? [['em notas', eur(d.bankNotes), { soft: true }], ['em moedas (pelo hopper)', eur(d.bankCoins), { soft: true }]] : []),
      ['Fundo que fica', eur(d.floatLeft)],
      ['Troco dado aos clientes', eur(d.change), { soft: true }],
    ])}</table>`

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;color:${INK};">
    ${box('', `<div style="font-size:22px;font-weight:bold;color:${INK};">Fecho de caixa</div>
      <div style="font-size:14px;color:${SOFT};margin-top:4px;">${escapeHtml(dateLong(d.to))} · período ${escapeHtml(period)}${d.closedBy ? ` · fechado por ${escapeHtml(d.closedBy)}` : ''}</div>`, 'margin-top:0;')}

    ${boxRow([
      tile('Faturação do dia', eur(d.revenue), INK, `${d.salesCount} movimentos`),
      tile('Depositado no banco', eur(d.toBank), COLORS.cash, bankSub),
      tile('Diferença na contagem', diffText, diffColor, `contado ${eur(d.counted)} · esperado ${eur(d.expected)}`),
      tile('Fundo que fica', eur(d.floatLeft), INK, 'na máquina'),
    ])}
    ${boxRow([
      chartBlock('Como entrou o dinheiro', 'chart-pay', pay, d.revenue, d.cardSpent > 0 ? `Gasto com cartões: ${eur(d.cardSpent)} (já contado quando o cartão foi carregado).` : ''),
      chartBlock('Lavagens e secagens', 'chart-use', useItems, useTotal, 'Valor das utilizações, incluindo as pagas com cartão.'),
    ])}
    ${boxRow([cellBox('Vendas', vendas), cellBox('Caixa', caixa)])}
    ${d.notes ? box('Notas', `<div style="font-size:14px;color:${INK};">${escapeHtml(d.notes)}</div>`) : ''}
  </div>`

  const text = [
    `Fecho de caixa — ${dateLong(d.to)}`, `Período ${period}${d.closedBy ? ` · fechado por ${d.closedBy}` : ''}`, '',
    `Faturação do dia: ${eur(d.revenue)}`,
    `  Dinheiro (máquinas): ${eur(d.cashServices)}`,
    `  Carregamentos e cartões (dinheiro): ${eur(d.cashTopups)}`,
    `  MB WAY: ${eur(d.mbway)}`,
    `  Pago com cartão (já contado): ${eur(d.cardSpent)}`,
    `Lavagens: ${d.use.wash.n} (${eur(d.use.wash.eur)}) · Secagens: ${d.use.dry.n} (${eur(d.use.dry.eur)})`, '',
    `Esperado: ${eur(d.expected)} · Contado: ${eur(d.counted)} · Diferença: ${diffText}`,
    `Depositado no banco: ${eur(d.toBank)}${bankSub ? ` (${bankSub})` : ''}`,
    `Fundo que fica: ${eur(d.floatLeft)}`,
    ...(d.notes ? ['', `Notas: ${d.notes}`] : []),
  ].join('\n')

  const day = d.to.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Lisbon' })
  return { subject: `Fecho de caixa ${day} — ${eur(d.revenue)}`, text, html, attachments, data: d }
}

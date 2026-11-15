/**
 * The day-close report sent by e-mail when a close is confirmed (and by the "send by e-mail" button): big numbers first, how the
 * money came in, two pie charts, the till, the deposit. Plain HTML tables (what every mail client shows); the charts are PNG images
 * made here with sharp and attached inline (cid:), because Gmail and Outlook show neither SVG nor scripts.
 */
import sharp from 'sharp'
import Sale from '../models/sale.js'
import Machine from '../models/machine.js'
import { escapeHtml, resolveBrand } from './emailTemplate.js'
import * as K from './emailKit.js'

export const COLORS = { cash: '#0f766e', mbway: '#d3101c', topup: '#f59e0b', wash: '#0ea5e9', dry: '#f97316', other: '#94a3b8' }
const INK = '#1f2937'
const SOFT = '#6b7280'
const LINE = '#e5e7eb'

const eur = K.eur
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

const dateLong = (d) => d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Lisbon' }).replace(/\./g, '')
const timeOf = (d) => d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' })
const dayTime = (d) => d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' }).replace(',', '')

function legend(items, total) {
  return items.map((x) => `<tr>
    <td style="padding:7px 0;font-size:12px;color:${K.T.text};"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${x.color};margin-right:8px;"></span>${escapeHtml(x.label)}</td>
    <td style="padding:7px 0;font-size:12px;text-align:right;white-space:nowrap;"><b style="color:${K.T.ink};">${escapeHtml(x.text)}</b> <span style="color:${K.T.faint};">${pct(x.value, total)}%</span></td>
  </tr>`).join('')
}

/** One chart box: the donut (an inline image) and its legend side by side. `bars` puts a progress bar under each legend line. */
function chartPanel({ title, subtitle, tag, cid, items, total, foot, bars = false }) {
  const rows = bars
    ? items.map((x) => `<tr><td style="padding:8px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:12px;color:${K.T.text};"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${x.color};margin-right:8px;"></span>${escapeHtml(x.label)}</td>
        <td style="font-size:12px;text-align:right;white-space:nowrap;"><b style="color:${K.T.ink};">${escapeHtml(x.text)}</b> <span style="color:${K.T.faint};">${pct(x.value, total)}%</span></td></tr></table>${K.bar(pct(x.value, total), x.color)}</td></tr>`).join('')
    : legend(items, total)
  const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="125" valign="middle" align="center"><img src="cid:${cid}" width="115" height="115" alt="" style="display:block;border:0;"></td>
      <td valign="middle" style="padding-left:12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td>
    </tr></table>`
  return { title, subtitle, tag, inner, foot }
}

/** subject, text, the inner HTML (to go inside renderEmailHtml with bare:true) and the chart images to attach. */
export async function buildDayCloseReport(dc, brandIn = {}) {
  const d = await reportData(dc)
  const brand = resolveBrand(brandIn)
  const T = K.T
  const noDiff = Math.abs(d.discrepancy) < 0.005
  const diffTone = noDiff ? 'green' : 'rose'
  const diffText = noDiff ? '0,00' : `${d.discrepancy > 0 ? '+' : ''}${eur(d.discrepancy).replace(' €', '')}`
  const num = (n) => eur(n).replace(' €', '')

  const pay = [
    { label: 'Dinheiro (máquinas)', value: d.cashServices, color: COLORS.cash, text: eur(d.cashServices) },
    { label: 'Carregamentos', value: d.cashTopups, color: COLORS.topup, text: eur(d.cashTopups) },
    { label: 'MB WAY', value: d.mbway, color: COLORS.mbway, text: eur(d.mbway) },
  ]
  const useItems = [
    { label: `Lavagens · ${d.use.wash.n}`, value: d.use.wash.eur, color: COLORS.wash, text: eur(d.use.wash.eur) },
    { label: `Secagens · ${d.use.dry.n}`, value: d.use.dry.eur, color: COLORS.dry, text: eur(d.use.dry.eur) },
  ]
  const useTotal = d.use.wash.eur + d.use.dry.eur
  const cycles = d.use.wash.n + d.use.dry.n
  const attachments = [
    { filename: 'pagamentos.png', cid: 'chart-pay', contentType: 'image/png', content: await donutPng(pay, 115) },
    { filename: 'servicos.png', cid: 'chart-use', contentType: 'image/png', content: await donutPng(useItems, 115) },
  ]

  const period = d.from && d.from.getTime() > 0 ? `${dayTime(d.from)} → ${dayTime(d.to)}` : `até ${dayTime(d.to)}`
  const bankSub = d.bankNotes != null ? `${eur(d.bankNotes)} em notas · ${eur(d.bankCoins)} em moedas` : 'Preparado para recolha'

  const meta = K.meta([['Data do fecho:', `${dateLong(d.to)}, ${timeOf(d.to)}`], ['Período:', period]],
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:12px;color:${T.soft};">${K.avatar(d.closedBy || '·')}&nbsp; Operador: <b style="color:${T.ink};">${escapeHtml(d.closedBy || '-')}</b></td>
      <td align="right">${K.badge('Concluído', 'green')}</td></tr></table>`)

  const kpis = K.boxRow([
    K.kpi({ label: 'Faturação do dia', value: num(d.revenue), sub: 'Dinheiro, carregamentos e MB WAY' }),
    K.kpi({ label: 'Depósito no banco', value: num(d.toBank), tone: 'teal', sub: escapeHtml(bankSub) }),
    K.kpi({ label: 'Diferença no caixa', value: diffText, tone: diffTone, sub: `Contado: <b style="color:${T.text};">${eur(d.counted)}</b><br>Esperado: <b style="color:${T.text};">${eur(d.expected)}</b>` }),
    K.kpi({ label: 'Fundo em máquina', value: num(d.floatLeft), sub: 'Fundo de trocos operacional' }),
  ], 24)

  const charts = K.panelRow([
    chartPanel({ title: 'Origem da faturação', subtitle: 'Distribuição por método de liquidação', tag: `${pay.filter((x) => x.value > 0).length} métodos`, cid: 'chart-pay', items: pay, total: d.revenue,
      foot: d.cardSpent > 0 ? K.note({ height: 52, html: `<b>Nota contábil:</b> gasto com cartões: <b>${eur(d.cardSpent)}</b> (já incluído quando o saldo foi carregado).` }) : '' }),
    chartPanel({ title: 'Utilização dos serviços', subtitle: 'Divisão de receita entre lavagens e secagens', tag: `${cycles} ciclos`, cid: 'chart-use', items: useItems, total: useTotal, bars: true,
      foot: K.note({ height: 52, html: `Inclui utilizações em dinheiro e com saldo de cartões.<br><b>Total: ${eur(useTotal)}</b>` }) }),
  ])

  const vendas = K.kv([
    ['Dinheiro direto (máquinas)', eur(d.cashServices), { dot: COLORS.cash }],
    ['Carregamentos e cartões novos (espécie)', eur(d.cashTopups), { dot: COLORS.topup }],
    ['MB WAY', eur(d.mbway), { dot: COLORS.mbway }],
    ['Total faturado no período', eur(d.revenue), { bold: true, bg: T.tealTint, color: T.tealDark }],
    ['Pago com cartão de cliente (saldo já contado)', eur(d.cardSpent), { soft: true, dot: T.faint }],
    ['Reembolsos', d.refunds > 0 ? `-${eur(d.refunds)}` : eur(0), { soft: true, dot: T.faint }],
    ['Movimentos no terminal', String(d.salesCount), { soft: true, dot: T.faint }],
  ])
  const caixa = K.kv([
    ['Fundo no início do turno', eur(d.openingFloat), { size: 12 }],
    ['Dinheiro que entrou (físico)', eur(d.cashTotal), { sign: '(+)', signColor: T.green, color: T.greenDark }],
    ...(d.floatAdded > 0 ? [['Fundo de troco adicionado', eur(d.floatAdded), { sign: '(+)' }]] : []),
    ...(d.floatWithdrawn > 0 ? [['Levantamentos', `-${eur(d.floatWithdrawn)}`, { sign: '(-)', signColor: T.rose }]] : []),
    ['Total esperado na máquina', eur(d.expected), { sign: '(=)', bold: true, bg: T.tint }],
    ['Total contado fisicamente', eur(d.counted), { bold: true, bg: T.amberTint }],
    [noDiff ? 'Contagem certa' : 'Diferença de contagem', noDiff ? eur(0) : `${d.discrepancy > 0 ? '+' : ''}${eur(d.discrepancy)}`, { bold: true, bg: noDiff ? T.greenTint : T.roseTint, color: noDiff ? T.greenDark : T.rose }],
    ['Depositado no banco', eur(d.toBank), { sign: '(-)', signColor: T.rose }],
    ['Fundo residual que fica na máquina', eur(d.floatLeft), { sign: '(=)', signColor: T.teal, bg: T.tealTint, color: T.tealDark, bold: true }],
  ], { size: 12 })
  const tables = K.panelRow([
    ({ title: 'Demonstração de vendas', subtitle: 'Resumo discriminado das receitas', tag: 'EUR (€)', inner: vendas,
      foot: K.note({ height: 40, html: `Soma do que entrou: dinheiro + carregamentos + MB WAY. O que se gasta com cartões já foi contado ao carregar.` }) }),
    ({ title: 'Reconciliação e fluxo físico', subtitle: 'Auditoria do dinheiro na máquina', tag: 'Auditoria', inner: caixa,
      foot: K.note({ height: 40, html: `Troco dado aos clientes <b style="float:right;font-family:Menlo,Consolas,monospace;color:${T.text};">${eur(d.change)}</b>` }) }),
  ])

  const notes = d.notes ? K.panelRow([({ title: 'Observações do turno', subtitle: 'Ocorrências, justificações de divergências ou avisos para o turno seguinte', width: '100%',
    inner: K.note({ tone: 'amber', html: `<div style="font-size:13px;color:${T.ink};line-height:1.6;">${escapeHtml(d.notes)}</div>${d.closedBy ? `<div style="margin-top:10px;font-size:11px;color:${T.soft};">${K.avatar(d.closedBy)}&nbsp; Anotado por: <b style="color:${T.ink};">${escapeHtml(d.closedBy)}</b></div>` : ''}` }) })]) : ''

  const generated = `Documento gerado eletronicamente em ${d.to.toLocaleDateString('pt-PT', { timeZone: 'Europe/Lisbon' })} às ${timeOf(new Date())}`
  const html = K.card(`${K.header({ brand, title: 'Fecho de caixa diário', subtitle: 'Demonstração financeira detalhada e auditoria de caixa', meta })}${kpis}${charts}${tables}${notes}${K.footer({ brand, line: generated })}`)

  const text = [
    `Fecho de caixa — ${dateLong(d.to)}`, `Período ${period}${d.closedBy ? ` · fechado por ${d.closedBy}` : ''}`, '',
    `Faturação do dia: ${eur(d.revenue)}`,
    `  Dinheiro (máquinas): ${eur(d.cashServices)}`,
    `  Carregamentos: ${eur(d.cashTopups)}`,
    `  MB WAY: ${eur(d.mbway)}`,
    `  Pago com cartão (já contado): ${eur(d.cardSpent)}`,
    `Lavagens: ${d.use.wash.n} (${eur(d.use.wash.eur)}) · Secagens: ${d.use.dry.n} (${eur(d.use.dry.eur)})`, '',
    `Esperado: ${eur(d.expected)} · Contado: ${eur(d.counted)} · Diferença: ${noDiff ? 'certo' : eur(d.discrepancy)}`,
    `Depositado no banco: ${eur(d.toBank)}${d.bankNotes != null ? ` (${bankSub})` : ''}`,
    `Fundo que fica: ${eur(d.floatLeft)}`,
    ...(d.notes ? ['', `Observações: ${d.notes}`] : []),
  ].join('\n')

  const day = d.to.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Lisbon' })
  return { subject: `Fecho de caixa ${day} — ${eur(d.revenue)}`, text, html, attachments, data: d }
}

/** Plain-text receipt body — shared by the printed and emailed versions so they read identically. */
export function formatReceiptText(items = []) {
  const lines = items.map((i) => {
    const label = i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge'))
      ? 'Recarga de cartão' : (i.name || 'Máquina')
    const amount = Number(i.price || i.amount || 0)
    return `${label} — €${amount.toFixed(2)}`
  })
  const total = items.reduce((s, i) => s + Number(i.price || i.amount || 0), 0)
  return [
    'Recibo de compra', '',
    ...lines, '',
    `Total: €${total.toFixed(2)}`,
    `Data: ${new Date().toLocaleString('pt-PT')}`, '',
    'Obrigado pela sua visita!',
  ].join('\n')
}

/** Z-report body for a cash-session close/float top-up — mirrors the emailed version in backend/src/services/dayClose.js so the two read identically. */
export function formatDayCloseReceiptText(dc) {
  const f = (n) => Number(n || 0).toFixed(2)
  const lines = [
    'Fecho de Caixa', '',
    `Fundo inicial: €${f(dc.openingFloat)}`,
    `Vendas dinheiro: €${f(dc.totalCash)}`,
    `Vendas cartão: €${f(dc.totalCard)}`,
    `Esperado em caixa: €${f(dc.expectedCash)}`,
    `Contado: €${f(dc.countedCash)}`,
    `Diferença: €${f(dc.discrepancy)}`, '',
    `Para o banco: €${f(dc.amountToBank)}`,
    `Fundo para próxima sessão: €${f(dc.floatLeft)}`, '',
  ]
  if (dc.countedDenominations?.length) {
    lines.push('Contagem:')
    for (const d of dc.countedDenominations) {
      const label = d.value < 1 ? `${Math.round(d.value * 100)}c` : `${d.value}€`
      lines.push(`  ${label} x${d.count} = €${f(d.total)}`)
    }
    lines.push('')
  }
  if (dc.notes) lines.push(`Notas: ${dc.notes}`, '')
  lines.push(`Fechado por: ${dc.closedByUsername || '-'}`)
  lines.push(`Data: ${new Date(dc.periodTo || dc.createdAt).toLocaleString('pt-PT')}`)
  return lines.join('\n')
}

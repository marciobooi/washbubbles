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

/**
 * Every alert the system can e-mail, in ONE list. The admin chooses which ones to receive (Definições > Email); the server filters
 * on this list (services/alerts.js) and the screen builds its switches from it (GET /admin/alerts/catalog).
 *
 *   key        stable id, saved in the setting `alerts.prefs` ({ key: true|false })
 *   group      where it shows on the screen
 *   label      what the admin reads
 *   help       one line: when it is sent
 *   defaultOn  what applies until the admin chooses (new alerts that nobody listed here are sent: never silent by accident)
 *   critical   customer money is involved: the screen asks to confirm before it is switched off
 *   match      the alert's subject, so the callers did not have to change (a caller may also pass the key explicitly)
 */
export const ALERT_GROUPS = [
  { key: 'money', label: 'Dinheiro do cliente' },
  { key: 'mbway', label: 'MB WAY' },
  { key: 'hardware', label: 'Máquinas e hardware' },
  { key: 'kiosk', label: 'Quiosque e ligação' },
  { key: 'system', label: 'Sistema' },
  { key: 'reports', label: 'Relatórios' },
]

export const ALERT_TYPES = [
  // customer money
  { key: 'paid.not.started', group: 'money', label: 'Cliente pagou e a máquina não arrancou', help: 'Um pagamento foi aceite e a máquina não recebeu o arranque.', defaultOn: true, critical: true, match: /^Cliente pagou e a máquina não arrancou/ },
  { key: 'money.held', group: 'money', label: 'Dinheiro de cliente retido na máquina', help: 'Ficou dinheiro de um cliente na máquina que não foi devolvido.', defaultOn: true, critical: true, match: /^Dinheiro de cliente retido/ },
  { key: 'change.short', group: 'money', label: 'Falta de troco', help: 'O hopper não deu todo o troco: há um cliente por pagar.', defaultOn: true, critical: true, match: /^Falta de troco/ },
  { key: 'refund.owed', group: 'money', label: 'Reembolso com dinheiro por pagar', help: 'Num reembolso pelo hopper saiu menos do que devia.', defaultOn: true, critical: true, match: /^Reembolso: falta pagar/ },
  { key: 'blocks.undelivered', group: 'money', label: 'Blocos pagos e não entregues', help: 'Um secador recebeu menos blocos do que o cliente pagou.', defaultOn: true, critical: true, match: /^Blocos pagos e não entregues/ },
  // MB WAY
  { key: 'mbway.paid', group: 'mbway', label: 'MB WAY pago com problema', help: 'Pago, mas a máquina não arrancou, o cartão não foi tratado, foi pago depois de cancelar ou está por confirmar.', defaultOn: true, critical: true, match: /^MB WAY pago/ },
  { key: 'mbway.check', group: 'mbway', label: 'MB WAY a verificar', help: 'Pedido que pode ter sido criado, ou estado desconhecido do Eupago.', defaultOn: true, match: /^MB WAY:/ },
  // machines and hardware
  { key: 'start.unconfirmed', group: 'hardware', label: 'Arranque sem confirmação', help: 'O controlador não confirmou o arranque de uma máquina.', defaultOn: true, match: /^Arranque sem confirmação/ },
  { key: 'peripheral.silent', group: 'hardware', label: 'Periférico sem resposta', help: 'O controlador não consegue falar com o noteiro, moedeiro, hopper, etc.', defaultOn: true, match: /^Periférico sem resposta/ },
  { key: 'coin.unmapped', group: 'hardware', label: 'Moeda não reconhecida', help: 'O moedeiro recebeu uma moeda que não conhece e não deu crédito.', defaultOn: true, match: /^Moeda não reconhecida/ },
  { key: 'coin.mute', group: 'hardware', label: 'Moedeiro possivelmente mudo', help: 'Há horas que não chega nenhuma moeda, com a loja a trabalhar.', defaultOn: true, match: /^O moedeiro pode estar mudo/ },
  { key: 'maintenance.fault', group: 'hardware', label: 'Avaria registada', help: 'Uma avaria foi registada na Manutenção.', defaultOn: true, match: /^Avaria/ },
  { key: 'controller.state', group: 'hardware', label: 'Controlador desligado, reiniciado ou de volta', help: 'O estado da ligação ao controlador mudou.', defaultOn: true, match: /^Controlador (desligado|reiniciado|voltou a responder)/ },
  { key: 'controller.silent', group: 'hardware', label: 'URGENTE: controlador sem resposta', help: 'O controlador não responde há minutos: as máquinas não arrancam.', defaultOn: true, critical: true, match: /^URGENTE: controlador sem resposta/ },
  // kiosk and connection
  { key: 'kiosk.offline', group: 'kiosk', label: 'Quiosque offline', help: 'O quiosque não comunica com o servidor há mais de 15 minutos.', defaultOn: true, match: /^Quiosque offline/ },
  { key: 'kiosk.online', group: 'kiosk', label: 'Quiosque online outra vez', help: 'O quiosque voltou a comunicar.', defaultOn: false, match: /^Quiosque online outra vez/ },
  { key: 'kiosk.screen.error', group: 'kiosk', label: 'Erro no ecrã do quiosque', help: 'O ecrã do quiosque teve um erro e reiniciou sozinho.', defaultOn: true, match: /^Erro no ecrã do quiosque/ },
  { key: 'kiosk.alert', group: 'kiosk', label: 'Avisos enviados pelo próprio quiosque', help: 'Avisos que o quiosque da loja envia por iniciativa própria.', defaultOn: true },
  { key: 'sync.rejected', group: 'kiosk', label: 'Sincronização recusada', help: 'O servidor central recusou um registo enviado pela loja.', defaultOn: true, match: /^Sincronização:/ },
  { key: 'card.chip', group: 'kiosk', label: 'Cartão com saldo estranho', help: 'Um cartão desconhecido ou com mais saldo no chip do que na base.', defaultOn: true, match: /^Cartão (desconhecido|com saldo)/ },
  // system
  { key: 'backup.failed', group: 'system', label: 'Cópia de segurança falhou', help: 'A cópia diária dos dados não ficou completa.', defaultOn: true, match: /^Cópia de segurança falhou/ },
  { key: 'staff.pin', group: 'system', label: 'PIN do staff a expirar ou expirado', help: 'Aviso de que o PIN do staff expira (todas as segundas-feiras).', defaultOn: false, match: /^(O )?PIN de staff/ },
  // reports (not alerts: a report sent on its own)
  { key: 'report.dayClose', group: 'reports', label: 'Relatório de fecho de caixa', help: 'Enviado sozinho quando se confirma cada fecho. No histórico dos fechos pode sempre reenviar-se à mão.', defaultOn: true },
]

const BY_KEY = new Map(ALERT_TYPES.map((t) => [t.key, t]))

/** The type of an alert: the key the caller gave, else the one whose `match` fits the subject, else null (unknown: always sent). */
export function alertTypeOf(subject, explicit = null) {
  if (explicit && BY_KEY.has(explicit)) return BY_KEY.get(explicit)
  const s = String(subject || '')
  return ALERT_TYPES.find((t) => t.match && t.match.test(s)) || null
}

/** The effective choice for every type: what the admin saved, else the default. */
export function effectivePrefs(saved = {}) {
  const out = {}
  for (const t of ALERT_TYPES) out[t.key] = saved && typeof saved[t.key] === 'boolean' ? saved[t.key] : t.defaultOn
  return out
}

/** The same list without the regular expressions, for the screen. */
export function catalog() {
  return { groups: ALERT_GROUPS, types: ALERT_TYPES.map(({ match, ...t }) => t) }
}

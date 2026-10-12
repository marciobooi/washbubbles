// What the "Legal / RGPD" tab starts from, and what the kiosk shows until the owner saves their own.
// The privacy text is a DRAFT written from the data this system really keeps (card holder details,
// balance and movements, sales). It must be reviewed by the owner / a lawyer before it is relied on.
export const LEGAL_LANGS = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
]

export const DEFAULT_PRIVACY_PT = `Responsável pelo tratamento
Os dados da entidade responsável (nome, NIF, morada e contacto) estão indicados nesta janela.

Que dados recolhemos
Ao comprar ou usar um cartão pode, se quiser, indicar o nome, email, telefone e NIF (contribuinte). Todos são opcionais. Guardamos também o número do cartão, o saldo e os movimentos (recargas e utilizações das máquinas).

Para que usamos
Para gerir o saldo do seu cartão, recuperar o saldo em caso de extravio, emitir recibos e faturas e cumprir obrigações legais. Só enviamos promoções ou novidades se tiver dado o seu consentimento.

Fundamento
Execução do serviço que pediu, cumprimento de obrigações legais (por exemplo, faturação) e o seu consentimento, quando aplicável.

Quanto tempo guardamos
Enquanto o cartão estiver ativo e durante os prazos exigidos por lei. Pode pedir a eliminação dos dados que não tenhamos obrigação de conservar.

Os seus direitos
Pode pedir acesso, retificação, apagamento, limitação, oposição e portabilidade dos seus dados, e retirar o consentimento quando quiser. Se entender que os seus direitos não foram respeitados, pode apresentar reclamação à Comissão Nacional de Proteção de Dados (www.cnpd.pt).

Contacto
Para exercer os seus direitos, use o contacto indicado nesta janela.`

export const DEFAULT_LEGAL = {
  company: '',
  nif: '',
  address: '',
  phone: '',
  email: '',
  complaintsUrl: 'https://www.livroreclamacoes.pt',
  privacy: { pt: DEFAULT_PRIVACY_PT, en: '', fr: '', de: '' },
  terms: { pt: '', en: '', fr: '', de: '' },
}

/** Merge what the server saved onto the defaults (a missing field never leaves the page empty). */
export function mergeLegal(saved) {
  const s = saved && typeof saved === 'object' ? saved : {}
  const text = (k) => ({ ...DEFAULT_LEGAL[k], ...(s[k] && typeof s[k] === 'object' ? s[k] : {}) })
  return { ...DEFAULT_LEGAL, ...s, privacy: text('privacy'), terms: text('terms') }
}

/** The text in `lang`, falling back to Portuguese (the source language) when that translation is empty. */
export function legalText(block, lang) {
  return (block && (block[lang] || block.pt)) || ''
}

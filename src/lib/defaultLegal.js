// What the "Legal / RGPD" tab starts from, and what the kiosk shows until the owner saves their own.
// Both texts are DRAFTS for a self-service laundry in Portugal, written from what this system really does
// (cash and loyalty-card payments, optional card-holder details, dryers sold in blocks of minutes).
// They must be read and confirmed by the owner / a lawyer before they are relied on.
// Format: a line starting with "## " is a section heading, a line starting with "- " is a bullet.
export const LEGAL_LANGS = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
]

export const DEFAULT_PRIVACY_PT = `## 1. Quem é o responsável
A entidade responsável pelo tratamento dos seus dados pessoais está identificada no fim desta janela (nome, NIF, morada e contacto).

## 2. Que dados tratamos
- Cartão de fidelidade: número do cartão, saldo e movimentos (recargas e utilizações das máquinas).
- Dados que indicar, se quiser, ao comprar o cartão: nome, email, telefone e NIF (contribuinte).
- Registos das vendas: valor, data e hora, máquina e forma de pagamento (dinheiro ou cartão).
- Registos técnicos do funcionamento do equipamento (por exemplo, erros), sem dados pessoais.

## 3. Para que usamos e com que fundamento
- Gerir o seu cartão e o seu saldo: execução do serviço que pediu.
- Emitir recibos e faturas e cumprir obrigações fiscais e contabilísticas: obrigação legal.
- Recuperar o seu saldo em caso de extravio do cartão: execução do serviço e interesse legítimo.
- Enviar promoções e novidades por email: apenas com o seu consentimento, que pode retirar a qualquer momento.
- Garantir a segurança e o bom funcionamento do equipamento: interesse legítimo.

## 4. Dados facultativos
Indicar nome, email, telefone ou NIF é facultativo. Sem eles pode usar o cartão normalmente, mas não conseguimos recuperar o saldo em caso de extravio nem emitir fatura com o seu NIF.

## 5. Com quem partilhamos
Apenas com prestadores que nos ajudam a prestar o serviço (por exemplo, alojamento do sistema, envio de email e contabilidade), vinculados por contrato à proteção dos dados, e com autoridades quando a lei o exigir. Não vendemos os seus dados.

## 6. Quanto tempo guardamos
Pelo tempo necessário às finalidades acima e pelos prazos que a lei impõe (por exemplo, os documentos fiscais são conservados durante 10 anos). Pode pedir a eliminação dos dados que não tenhamos obrigação de conservar.

## 7. Os seus direitos
Tem direito de acesso, retificação, apagamento, limitação, oposição e portabilidade dos seus dados, e a retirar o consentimento a qualquer momento, sem prejuízo do que já foi tratado. Para exercer estes direitos use o contacto indicado nesta janela. Se entender que os seus direitos não foram respeitados, pode apresentar reclamação à Comissão Nacional de Proteção de Dados (www.cnpd.pt).

## 8. Segurança
Aplicamos medidas técnicas e organizativas adequadas para proteger os seus dados contra acesso, alteração ou perda não autorizados.

## 9. Enquadramento legal
Regulamento (UE) 2016/679 (RGPD) e Lei n.º 58/2019.`

export const DEFAULT_PRIVACY_EN = `## 1. Who is responsible
The entity responsible for processing your personal data is identified at the bottom of this window (name, tax number, address and contact).

## 2. What data we process
- Loyalty card: card number, balance and movements (top-ups and machine use).
- Details you may choose to give when buying the card: name, email, phone and tax number (NIF).
- Sales records: amount, date and time, machine and payment method (cash or card).
- Technical records of how the equipment works (for example errors), without personal data.

## 3. What we use it for and on what basis
- Managing your card and balance: performing the service you asked for.
- Issuing receipts and invoices and meeting tax and accounting obligations: legal obligation.
- Recovering your balance if the card is lost: performing the service and legitimate interest.
- Sending promotions and news by email: only with your consent, which you can withdraw at any time.
- Keeping the equipment secure and working properly: legitimate interest.

## 4. Optional details
Giving your name, email, phone or tax number is optional. Without them you can use the card normally, but we cannot recover your balance if it is lost or issue an invoice with your tax number.

## 5. Who we share it with
Only with providers who help us deliver the service (for example system hosting, email sending and accounting), bound by contract to protect the data, and with authorities where the law requires. We do not sell your data.

## 6. How long we keep it
For as long as needed for the purposes above and for the periods required by law (for example, tax documents are kept for 10 years). You may ask for deletion of data we are not obliged to keep.

## 7. Your rights
You have the right to access, rectify, erase, restrict, object to and port your data, and to withdraw consent at any time without affecting what was already processed. To exercise these rights use the contact shown in this window. If you believe your rights were not respected you may complain to the Portuguese data protection authority, the Comissão Nacional de Proteção de Dados (www.cnpd.pt).

## 8. Security
We apply appropriate technical and organisational measures to protect your data against unauthorised access, alteration or loss.

## 9. Legal framework
Regulation (EU) 2016/679 (GDPR) and Portuguese Law 58/2019.`

export const DEFAULT_TERMS_PT = `## 1. Âmbito
Estas regras aplicam-se à utilização da lavandaria self-service e do quiosque de pagamento. Ao usar o serviço aceita estas regras.

## 2. Como funciona
Escolha uma máquina livre, adicione-a ao carrinho, pague e dirija-se à máquina para escolher o programa e carregar em Start. Os secadores são vendidos em ciclos de tempo (normalmente de 15 minutos) e escolhe quantos quer. Os preços estão indicados em euros no ecrã e incluem IVA à taxa legal em vigor.

## 3. Pagamento
- Pode pagar com moedas e notas de 5, 10 e 20 euros, ou com o cartão de fidelidade. Não são aceites notas de 50 euros.
- O troco é devolvido em moedas.
- O dinheiro inserido e não utilizado é devolvido em moedas ao fim de alguns minutos sem tocar no ecrã.
- Com o cartão de fidelidade as máquinas podem ter um preço mais baixo, conforme indicado no ecrã.

## 4. Cartão de fidelidade
O cartão é pessoal e pré-pago. O saldo fica registado no cartão e no nosso sistema. Em caso de extravio, só conseguimos recuperar o saldo se tiver indicado os seus dados ao comprar o cartão. Para qualquer questão sobre o saldo use o contacto indicado nesta janela.

## 5. Se a máquina não funcionar
Se uma máquina não arrancar, não lhe é cobrado o valor. Se parar por avaria depois de iniciar, contacte-nos de imediato pelo contacto indicado, para resolvermos a situação.

## 6. Regras de utilização
- Respeite a capacidade (kg) indicada em cada máquina.
- Verifique os bolsos e retire todos os objetos antes de colocar a roupa.
- Não coloque roupa com óleos, gasolina, solventes ou outros produtos inflamáveis ou químicos.
- Use apenas produtos adequados a máquinas de lavar roupa.
- Ao terminar, retire a roupa e deixe o espaço limpo.
- Não é permitido fumar. Os menores devem estar acompanhados e não podem brincar nas máquinas.
- Não danifique o equipamento: os danos são da responsabilidade de quem os causar.

## 7. Responsabilidade
Salvo nos casos em que a lei determine de outra forma, não respondemos por peças danificadas por utilização inadequada (excesso de carga, programa errado, objetos esquecidos nos bolsos), nem por peças ou objetos esquecidos no espaço.

## 8. Reclamações
Dispõe de Livro de Reclamações em formato eletrónico: use o botão "Livro de Reclamações" deste ecrã. Em caso de litígio de consumo pode recorrer a uma entidade de Resolução Alternativa de Litígios de consumo (informação em www.consumidor.gov.pt).

## 9. Lei aplicável
Aplica-se a lei portuguesa.`

export const DEFAULT_TERMS_EN = `## 1. Scope
These rules apply to the use of the self-service laundry and the payment kiosk. By using the service you accept these rules.

## 2. How it works
Choose a free machine, add it to the cart, pay, then go to the machine to choose the programme and press Start. Dryers are sold in time blocks (usually 15 minutes) and you choose how many you want. Prices are shown in euros on the screen and include VAT at the legal rate in force.

## 3. Payment
- You can pay with coins and 5, 10 and 20 euro notes, or with the loyalty card. 50 euro notes are not accepted.
- Change is given back in coins.
- Money inserted and not used is returned in coins after a few minutes without touching the screen.
- With the loyalty card machines may have a lower price, as shown on the screen.

## 4. Loyalty card
The card is personal and prepaid. The balance is recorded on the card and in our system. If the card is lost we can only recover the balance if you gave your details when buying the card. For any question about the balance use the contact shown in this window.

## 5. If a machine does not work
If a machine does not start you are not charged. If it stops because of a fault after starting, contact us straight away using the contact shown so we can sort it out.

## 6. Rules of use
- Respect the capacity (kg) shown on each machine.
- Check pockets and remove all objects before loading the clothes.
- Do not load clothes with oil, petrol, solvents or other flammable or chemical products.
- Use only products suitable for washing machines.
- When finished, take your clothes and leave the space clean.
- Smoking is not allowed. Children must be accompanied and must not play on the machines.
- Do not damage the equipment: damage is the responsibility of whoever causes it.

## 7. Liability
Except where the law provides otherwise, we are not liable for items damaged by improper use (overloading, wrong programme, objects left in pockets), nor for items or objects left behind in the premises.

## 8. Complaints
An electronic Complaints Book is available: use the "Complaints Book" button on this screen. In a consumer dispute you may turn to a consumer Alternative Dispute Resolution body (information at www.consumidor.gov.pt).

## 9. Governing law
Portuguese law applies.`

export const DEFAULT_LEGAL = {
  company: '',
  nif: '',
  address: '',
  phone: '',
  email: '',
  complaintsUrl: 'https://www.livroreclamacoes.pt',
  privacy: { pt: DEFAULT_PRIVACY_PT, en: DEFAULT_PRIVACY_EN, fr: '', de: '' },
  terms: { pt: DEFAULT_TERMS_PT, en: DEFAULT_TERMS_EN, fr: '', de: '' },
}

/** Merge what the server saved onto the defaults (a missing field never leaves the page empty). */
export function mergeLegal(saved) {
  const s = saved && typeof saved === 'object' ? saved : {}
  // a language the admin left empty falls back to the default text for that language, then to Portuguese
  const text = (k) => {
    const mine = s[k] && typeof s[k] === 'object' ? s[k] : {}
    const out = {}
    for (const l of ['pt', 'en', 'fr', 'de']) out[l] = mine[l] && String(mine[l]).trim() ? mine[l] : DEFAULT_LEGAL[k][l]
    return out
  }
  return { ...DEFAULT_LEGAL, ...s, privacy: text('privacy'), terms: text('terms') }
}

/** The text in `lang`, falling back to Portuguese (the source language) when that translation is empty. */
export function legalText(block, lang) {
  return (block && (block[lang] || block.pt)) || ''
}

/** Split a legal text into renderable blocks: headings ("## "), bullet lists ("- ") and paragraphs. */
export function parseLegal(text) {
  const blocks = []
  let list = null
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd()
    if (/^##\s+/.test(line)) { list = null; blocks.push({ type: 'h', text: line.replace(/^##\s+/, '') }); continue }
    if (/^-\s+/.test(line)) {
      if (!list) { list = { type: 'ul', items: [] }; blocks.push(list) }
      list.items.push(line.replace(/^-\s+/, ''))
      continue
    }
    list = null
    if (line.trim()) blocks.push({ type: 'p', text: line })
  }
  return blocks
}

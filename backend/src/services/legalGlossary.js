/**
 * Words and phrases the automatic translator gets wrong in the legal texts (found by reading the German
 * and Spanish output). A phrase here is always rendered exactly as written, in every language, and wins over
 * the machine translation. The shop's own dictionary (landingPage.glossary, edited by the admin) is applied
 * after this list, so the admin can still override any entry.
 */
const row = (pt, en, fr, de, es) => ({ pt, en, fr, de, es })
const same = (pt) => row(pt, pt, pt, pt, pt)

export const LEGAL_GLOSSARY = [
  // addresses must never be translated
  same('www.consumidor.gov.pt'),
  same('www.cnpd.pt'),
  same('www.livroreclamacoes.pt'),
  row('Comissão Nacional de Proteção de Dados', 'National Data Protection Commission (CNPD)', 'Commission nationale de la protection des données (CNPD)', 'Nationale Datenschutzkommission (CNPD)', 'Comisión Nacional de Protección de Datos (CNPD)'),
  row('Livro de Reclamações', 'Complaints Book', 'Livre de réclamations', 'Beschwerdebuch', 'Libro de Reclamaciones'),
  row('Resolução Alternativa de Litígios', 'Alternative Dispute Resolution', 'Règlement extrajudiciaire des litiges', 'alternative Streitbeilegung', 'Resolución Alternativa de Litigios'),
  row('cartão de fidelidade', 'loyalty card', 'carte de fidélité', 'Treuekarte', 'tarjeta de fidelidad'),
  row('Cartão de fidelidade', 'Loyalty card', 'Carte de fidélité', 'Treuekarte', 'Tarjeta de fidelidad'),
  row('RGPD', 'GDPR', 'RGPD', 'DSGVO', 'RGPD'),
  same('NIF'),
  row('contribuinte', 'taxpayer number', 'numéro de contribuable', 'Steuernummer', 'número de contribuyente'),
  row('extravio', 'loss', 'perte', 'Verlust', 'pérdida'),
  row('saldo', 'balance', 'solde', 'Guthaben', 'saldo'),
  row('Saldo', 'Balance', 'Solde', 'Guthaben', 'Saldo'),
  row('troco', 'change', 'monnaie', 'Wechselgeld', 'cambio'),
  row('promoções', 'promotions', 'promotions', 'Werbeaktionen', 'promociones'),
  row('reclamações', 'complaints', 'réclamations', 'Beschwerden', 'reclamaciones'),
  row('Reclamações', 'Complaints', 'Réclamations', 'Beschwerden', 'Reclamaciones'),
  row('máquinas', 'machines', 'machines', 'Maschinen', 'máquinas'),
  row('máquina', 'machine', 'machine', 'Maschine', 'máquina'),
  row('secadores', 'dryers', 'sèche-linge', 'Trockner', 'secadoras'),
  row('quiosque', 'kiosk', 'borne', 'Kiosk', 'quiosco'),
  row('lavandaria self-service', 'self-service laundry', 'laverie en libre-service', 'Selbstbedienungs-Waschsalon', 'lavandería de autoservicio'),
  row('forma de pagamento', 'payment method', 'moyen de paiement', 'Zahlungsart', 'forma de pago'),
  row('peças esquecidas', 'items left behind', 'articles oubliés', 'vergessene Wäschestücke', 'prendas olvidadas'),
]

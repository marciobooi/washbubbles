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
  // second pass: what the German/Spanish output still got wrong (cardboard for "cartão", "sales records" as
  // "Verkaufsrekorde", "Leugnen Sie die Ausrüstung nicht" for "não danifique o equipamento", ...)
  row('não danifique o equipamento', 'do not damage the equipment', 'n’endommagez pas l’équipement', 'Beschädigen Sie die Geräte nicht', 'no dañe el equipo'),
  row('Dispõe de Livro de Reclamações em formato eletrónico', 'An electronic Complaints Book is available', 'Un Livre de réclamations électronique est à votre disposition', 'Ein elektronisches Beschwerdebuch steht zur Verfügung', 'Dispone de Libro de Reclamaciones electrónico'),
  row('entidade de Resolução Alternativa de Litígios de consumo', 'consumer alternative dispute resolution body', 'organisme de règlement extrajudiciaire des litiges de consommation', 'Verbraucherschlichtungsstelle', 'entidad de resolución alternativa de litigios de consumo'),
  row('Registos das vendas', 'Sales records', 'Registres des ventes', 'Verkaufsaufzeichnungen', 'Registros de ventas'),
  row('Registos técnicos', 'Technical records', 'Registres techniques', 'Technische Aufzeichnungen', 'Registros técnicos'),
  row('extravio do cartão', 'loss of the card', 'perte de la carte', 'Verlust der Karte', 'pérdida de la tarjeta'),
  row('retirar o consentimento', 'withdraw consent', 'retirer le consentement', 'die Einwilligung widerrufen', 'retirar el consentimiento'),
  row('produtos adequados a máquinas de lavar roupa', 'products suitable for washing machines', 'produits adaptés aux machines à laver', 'für Waschmaschinen geeignete Produkte', 'productos adecuados para lavadoras'),
  row('não respondemos por', 'we are not liable for', 'nous ne sommes pas responsables de', 'wir haften nicht für', 'no nos responsabilizamos de'),
  row('alojamento do sistema', 'system hosting', 'hébergement du système', 'Hosting des Systems', 'alojamiento del sistema'),
  row('prestadores', 'providers', 'prestataires', 'Dienstleister', 'proveedores'),
  row('equipamento', 'equipment', 'équipement', 'Geräte', 'equipo'),
  row('peças', 'garments', 'vêtements', 'Kleidungsstücke', 'prendas'),
  row('cartão', 'card', 'carte', 'Karte', 'tarjeta'),
  row('Cartão', 'Card', 'Carte', 'Karte', 'Tarjeta'),
  // section titles (matched inside "6. Quanto tempo guardamos")
  row('Quem é o responsável', 'Who is responsible', 'Qui est responsable', 'Wer verantwortlich ist', 'Quién es el responsable'),
  row('Que dados tratamos', 'What data we process', 'Quelles données nous traitons', 'Welche Daten wir verarbeiten', 'Qué datos tratamos'),
  row('Para que usamos e com que fundamento', 'What we use it for and on what basis', 'Pourquoi nous les utilisons et sur quelle base', 'Wofür wir sie verwenden und auf welcher Grundlage', 'Para qué los usamos y con qué fundamento'),
  row('Dados facultativos', 'Optional details', 'Données facultatives', 'Freiwillige Angaben', 'Datos facultativos'),
  row('Com quem partilhamos', 'Who we share it with', 'Avec qui nous les partageons', 'An wen wir sie weitergeben', 'Con quién los compartimos'),
  row('Quanto tempo guardamos', 'How long we keep it', 'Combien de temps nous les conservons', 'Wie lange wir die Daten aufbewahren', 'Cuánto tiempo los conservamos'),
  row('Os seus direitos', 'Your rights', 'Vos droits', 'Ihre Rechte', 'Sus derechos'),
  row('Enquadramento legal', 'Legal framework', 'Cadre juridique', 'Rechtsrahmen', 'Marco legal'),
  row('Como funciona', 'How it works', 'Comment ça marche', 'So funktioniert es', 'Cómo funciona'),
  row('Regras de utilização', 'Rules of use', 'Règles d’utilisation', 'Nutzungsregeln', 'Normas de uso'),
  row('Se a máquina não funcionar', 'If the machine does not work', 'Si la machine ne fonctionne pas', 'Wenn die Maschine nicht funktioniert', 'Si la máquina no funciona'),
  row('Lei aplicável', 'Governing law', 'Loi applicable', 'Anwendbares Recht', 'Ley aplicable'),
]

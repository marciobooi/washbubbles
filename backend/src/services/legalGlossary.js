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
  row('promoções', 'promotions', 'promotions', 'Werbeaktionen', 'promociones'),
  row('reclamações', 'complaints', 'réclamations', 'Beschwerden', 'reclamaciones'),
  row('Reclamações', 'Complaints', 'Réclamations', 'Beschwerden', 'Reclamaciones'),
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
  // whole phrases only: a single noun swapped in on its own loses its gender and the German/Spanish
  // articles around it come out wrong ("Ihren Karte"), so nouns are listed inside the phrase they appear in
  row('dinheiro ou cartão', 'cash or card', 'espèces ou carte', 'Bargeld oder Karte', 'efectivo o tarjeta'),
  row('com o cartão de fidelidade', 'with the loyalty card', 'avec la carte de fidélité', 'mit der Treuekarte', 'con la tarjeta de fidelidad'),
  row('O troco é devolvido em moedas', 'Change is given back in coins', 'La monnaie est rendue en pièces', 'Das Wechselgeld wird in Münzen zurückgegeben', 'El cambio se devuelve en monedas'),
  row('Respeite a capacidade', 'Respect the capacity', 'Respectez la capacité', 'Beachten Sie die Kapazität', 'Respete la capacidad'),
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
  // whole sentences the German output still garbled (checked by hand); matched as an exact line, so no machine translation
  { pt: "Cartão de fidelidade: número do cartão, saldo e movimentos (recargas e utilizações das máquinas).", en: "", fr: "", de: "Treuekarte: Kartennummer, Guthaben und Bewegungen (Aufladungen und Nutzung der Maschinen).", es: "" },
  { pt: "Gerir o seu cartão e o seu saldo: execução do serviço que pediu.", en: "", fr: "", de: "Verwaltung Ihrer Karte und Ihres Guthabens: Erfüllung der von Ihnen gewünschten Leistung.", es: "" },
  { pt: "Recuperar o seu saldo em caso de extravio do cartão: execução do serviço e interesse legítimo.", en: "", fr: "", de: "Wiederherstellung Ihres Guthabens bei Verlust der Karte: Erfüllung der Leistung und berechtigtes Interesse.", es: "" },
  { pt: "Enviar promoções e novidades por email: apenas com o seu consentimento, que pode retirar a qualquer momento.", en: "", fr: "", de: "Versand von Werbeaktionen und Neuigkeiten per E-Mail: nur mit Ihrer Einwilligung, die Sie jederzeit widerrufen können.", es: "" },
  { pt: "Com o cartão de fidelidade as máquinas podem ter um preço mais baixo, conforme indicado no ecrã.", en: "", fr: "", de: "Mit der Treuekarte können die Maschinen günstiger sein, wie auf dem Bildschirm angezeigt.", es: "" },
  { pt: "O cartão é pessoal e pré-pago. O saldo fica registado no cartão e no nosso sistema. Em caso de extravio, só conseguimos recuperar o saldo se tiver indicado os seus dados ao comprar o cartão. Para qualquer questão sobre o saldo use o contacto indicado nesta janela.", en: "", fr: "", de: "Die Karte ist persönlich und vorausbezahlt. Das Guthaben wird auf der Karte und in unserem System gespeichert. Bei Verlust können wir das Guthaben nur wiederherstellen, wenn Sie beim Kauf der Karte Ihre Daten angegeben haben. Bei Fragen zum Guthaben nutzen Sie bitte den in diesem Fenster angegebenen Kontakt.", es: "" },
  { pt: "Se uma máquina não arrancar, não lhe é cobrado o valor. Se parar por avaria depois de iniciar, contacte-nos de imediato pelo contacto indicado, para resolvermos a situação.", en: "", fr: "", de: "Startet eine Maschine nicht, wird Ihnen nichts berechnet. Bleibt sie nach dem Start wegen einer Störung stehen, kontaktieren Sie uns bitte sofort über den angegebenen Kontakt, damit wir das Problem lösen können.", es: "" },
  { pt: "Respeite a capacidade (kg) indicada em cada máquina.", en: "", fr: "", de: "Beachten Sie die an jeder Maschine angegebene Kapazität (kg).", es: "Respete la capacidad (kg) indicada en cada máquina." },
  { pt: "Salvo nos casos em que a lei determine de outra forma, não respondemos por peças danificadas por utilização inadequada (excesso de carga, programa errado, objetos esquecidos nos bolsos), nem por peças ou objetos esquecidos no espaço.", en: "", fr: "", de: "Soweit gesetzlich nichts anderes bestimmt ist, haften wir nicht für Kleidungsstücke, die durch unsachgemäße Nutzung beschädigt werden (Überladung, falsches Programm, in den Taschen vergessene Gegenstände), noch für im Geschäft vergessene Kleidungsstücke oder Gegenstände.", es: "" },
  { pt: "Dispõe de Livro de Reclamações em formato eletrónico: use o botão \"Livro de Reclamações\" deste ecrã. Em caso de litígio de consumo pode recorrer a uma entidade de Resolução Alternativa de Litígios de consumo (informação em www.consumidor.gov.pt).", en: "", fr: "", de: "Ein elektronisches Beschwerdebuch steht Ihnen zur Verfügung: Nutzen Sie dazu die Schaltfläche „Beschwerdebuch“ auf diesem Bildschirm. Bei Verbraucherstreitigkeiten können Sie sich an eine Verbraucherschlichtungsstelle wenden (Informationen unter www.consumidor.gov.pt).", es: "" },
]
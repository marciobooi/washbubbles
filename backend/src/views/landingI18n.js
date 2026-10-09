/**
 * The fixed labels of the public page (menu, buttons, footer, ...) in every language it is served in.
 * Hand-written on purpose: a handful of short labels must read right, so they are not machine translated.
 * The text the admin writes (hero, steps, services, ...) is translated by services/landingTranslate.js.
 *
 * Portuguese is the source language and is served at "/"; the others at "/en", "/fr", "/de", "/es".
 * `{open}`, `{close}`, `{n}`, `{brand}`, `{rating}` are filled in by fmt().
 */

export const LANGS = ['pt', 'en', 'fr', 'de', 'es']
export const TRANSLATED_LANGS = ['en', 'fr', 'de', 'es']

export const UI = {
  pt: {
    htmlLang: 'pt-PT', ogLocale: 'pt_PT', name: 'Português',
    skip: 'Saltar para o conteúdo', navAria: 'Navegação principal', langAria: 'Idioma',
    how: 'Como funciona', services: 'Serviços', reviews: 'Avaliações', visit: 'Visite-nos',
    enter: 'Entrar', enterAria: 'Entrar — acesso reservado', openMenu: 'Abrir menu',
    openNote: 'Aberto todos os dias, das {open} às {close}', ratingCount: '({n} no Google)',
    reviewSource: '· avaliação no Google', reviewsAria: 'Avaliações', reviewN: 'Avaliação {n}',
    address: 'Morada', mapTitle: 'Mapa', contactHours: 'Contacto & horário',
    everyDay: 'Todos os dias, das {open} às {close}', staffArea: 'Área reservada (equipa)',
    rights: 'Todos os direitos reservados.', ctaVisit: 'Visite-nos', ctaContact: 'Fale connosco',
    title: '{brand} Loures — Lavandaria Self-Service, Engomadoria e Limpeza a Seco',
    description: 'Lavandaria self-service em Loures: máquinas de lavar e secar, engomadoria, limpeza a seco, lavagem de tapetes e recolha ao domicílio. Avaliação {rating}/5 no Google.',
    schemaDescription: 'Lavandaria self-service, engomadoria, limpeza a seco e lavagem de tapetes em Loures. Recolha e entrega ao domicílio disponível.',
  },
  en: {
    htmlLang: 'en', ogLocale: 'en_GB', name: 'English',
    skip: 'Skip to content', navAria: 'Main navigation', langAria: 'Language',
    how: 'How it works', services: 'Services', reviews: 'Reviews', visit: 'Visit us',
    enter: 'Log in', enterAria: 'Log in — staff access only', openMenu: 'Open menu',
    openNote: 'Open every day, {open} to {close}', ratingCount: '({n} on Google)',
    reviewSource: '· Google review', reviewsAria: 'Reviews', reviewN: 'Review {n}',
    address: 'Address', mapTitle: 'Map', contactHours: 'Contact & opening hours',
    everyDay: 'Every day, {open} to {close}', staffArea: 'Staff area',
    rights: 'All rights reserved.', ctaVisit: 'Visit us', ctaContact: 'Contact us',
    title: '{brand} Loures — Self-Service Laundrette, Ironing and Dry Cleaning',
    description: 'Self-service laundrette in Loures: washing and drying machines, ironing, dry cleaning, rug washing and home pick-up. Rated {rating}/5 on Google.',
    schemaDescription: 'Self-service laundrette, ironing, dry cleaning and rug washing in Loures, Portugal. Home pick-up and delivery available.',
  },
  fr: {
    htmlLang: 'fr', ogLocale: 'fr_FR', name: 'Français',
    skip: 'Aller au contenu', navAria: 'Navigation principale', langAria: 'Langue',
    how: 'Comment ça marche', services: 'Services', reviews: 'Avis', visit: 'Nous rendre visite',
    enter: 'Connexion', enterAria: 'Connexion — accès réservé', openMenu: 'Ouvrir le menu',
    openNote: 'Ouvert tous les jours, de {open} à {close}', ratingCount: '({n} sur Google)',
    reviewSource: '· avis Google', reviewsAria: 'Avis', reviewN: 'Avis {n}',
    address: 'Adresse', mapTitle: 'Carte', contactHours: 'Contact et horaires',
    everyDay: 'Tous les jours, de {open} à {close}', staffArea: 'Espace réservé (équipe)',
    rights: 'Tous droits réservés.', ctaVisit: 'Nous rendre visite', ctaContact: 'Nous contacter',
    title: '{brand} Loures — Laverie en libre-service, repassage et nettoyage à sec',
    description: 'Laverie en libre-service à Loures : machines à laver et à sécher, repassage, nettoyage à sec, lavage de tapis et collecte à domicile. Noté {rating}/5 sur Google.',
    schemaDescription: 'Laverie en libre-service, repassage, nettoyage à sec et lavage de tapis à Loures, au Portugal. Collecte et livraison à domicile disponibles.',
  },
  de: {
    htmlLang: 'de', ogLocale: 'de_DE', name: 'Deutsch',
    skip: 'Zum Inhalt springen', navAria: 'Hauptnavigation', langAria: 'Sprache',
    how: 'So funktioniert’s', services: 'Leistungen', reviews: 'Bewertungen', visit: 'Besuchen Sie uns',
    enter: 'Anmelden', enterAria: 'Anmelden — nur für Mitarbeiter', openMenu: 'Menü öffnen',
    openNote: 'Täglich geöffnet, {open} bis {close} Uhr', ratingCount: '({n} auf Google)',
    reviewSource: '· Google-Bewertung', reviewsAria: 'Bewertungen', reviewN: 'Bewertung {n}',
    address: 'Adresse', mapTitle: 'Karte', contactHours: 'Kontakt & Öffnungszeiten',
    everyDay: 'Täglich, {open} bis {close} Uhr', staffArea: 'Mitarbeiterbereich',
    rights: 'Alle Rechte vorbehalten.', ctaVisit: 'Besuchen Sie uns', ctaContact: 'Kontakt aufnehmen',
    title: '{brand} Loures — Selbstbedienungs-Waschsalon, Bügelservice und Textilreinigung',
    description: 'Selbstbedienungs-Waschsalon in Loures: Wasch- und Trockenmaschinen, Bügelservice, chemische Reinigung, Teppichwäsche und Abholung nach Hause. {rating}/5 bei Google.',
    schemaDescription: 'Selbstbedienungs-Waschsalon, Bügelservice, chemische Reinigung und Teppichwäsche in Loures, Portugal. Abhol- und Lieferservice verfügbar.',
  },
  es: {
    htmlLang: 'es', ogLocale: 'es_ES', name: 'Español',
    skip: 'Saltar al contenido', navAria: 'Navegación principal', langAria: 'Idioma',
    how: 'Cómo funciona', services: 'Servicios', reviews: 'Opiniones', visit: 'Visítenos',
    enter: 'Acceder', enterAria: 'Acceder — acceso reservado', openMenu: 'Abrir menú',
    openNote: 'Abierto todos los días, de {open} a {close}', ratingCount: '({n} en Google)',
    reviewSource: '· opinión en Google', reviewsAria: 'Opiniones', reviewN: 'Opinión {n}',
    address: 'Dirección', mapTitle: 'Mapa', contactHours: 'Contacto y horario',
    everyDay: 'Todos los días, de {open} a {close}', staffArea: 'Área reservada (equipo)',
    rights: 'Todos los derechos reservados.', ctaVisit: 'Visítenos', ctaContact: 'Contáctenos',
    title: '{brand} Loures — Lavandería de autoservicio, planchado y limpieza en seco',
    description: 'Lavandería de autoservicio en Loures: lavadoras y secadoras, planchado, limpieza en seco, lavado de alfombras y recogida a domicilio. Valoración {rating}/5 en Google.',
    schemaDescription: 'Lavandería de autoservicio, planchado, limpieza en seco y lavado de alfombras en Loures, Portugal. Recogida y entrega a domicilio disponibles.',
  },
}

/** Fill `{name}` placeholders. */
export function fmt(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])))
}

/** Path of the page in a language: "/" for Portuguese, "/en" ... for the rest. */
export const langPath = (lang) => (lang === 'pt' ? '/' : `/${lang}`)

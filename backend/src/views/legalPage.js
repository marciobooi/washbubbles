/**
 * Public legal pages of the website: /legal/privacy, /legal/terms and /legal/cookies (and /en/legal/…).
 * Server-rendered like the front page. The privacy and terms texts are the same ones the kiosk shows
 * (setting legal.info + its automatic translations); the cookies page is written here, by hand, in every
 * language, because it describes what THIS website does.
 */
import { UI, LANGS, langPath } from './landingI18n.js'
import { parseLegal, legalText } from '../services/legalDefaults.js'

const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://freshbubbles.pt'
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const COOKIES = {
  pt: {
    title: 'Política de Cookies',
    body: `## O que são cookies
Cookies são pequenos ficheiros que um site pode guardar no seu navegador.

## O que este site faz
Este site não define cookies próprios e não usa cookies de análise, de publicidade nem de rastreio. Não precisamos, por isso, de lhe pedir consentimento para cookies.

## Serviços de terceiros
Os tipos de letra são servidos por este próprio site. O único serviço de terceiros é:
- Mapa (Google Maps): só é carregado se carregar em "Mostrar mapa". Ao carregá-lo, a Google pode guardar cookies no seu navegador, nos termos da política da Google.

## Como controlar cookies
Pode apagar ou bloquear cookies nas definições do seu navegador, a qualquer momento.

## Dúvidas
Use o contacto indicado na Política de Privacidade.`,
  },
  en: {
    title: 'Cookie Policy',
    body: `## What cookies are
Cookies are small files a website can store in your browser.

## What this website does
This website does not set its own cookies and does not use analytics, advertising or tracking cookies. So we do not need to ask for your consent to cookies.

## Third-party services
The fonts are served by this website itself. The only third-party service is:
- Map (Google Maps): it is loaded only if you press "Show map". When loaded, Google may store cookies in your browser, under Google's own policy.

## How to control cookies
You can delete or block cookies in your browser settings at any time.

## Questions
Use the contact shown in the Privacy Policy.`,
  },
  fr: {
    title: 'Politique de cookies',
    body: `## Qu’est-ce qu’un cookie
Les cookies sont de petits fichiers qu’un site peut enregistrer dans votre navigateur.

## Ce que fait ce site
Ce site ne dépose pas de cookies propres et n’utilise pas de cookies d’analyse, de publicité ni de suivi. Nous n’avons donc pas besoin de vous demander votre consentement pour les cookies.

## Services tiers
Les polices sont servies par ce site lui-même. Le seul service tiers est :
- Carte (Google Maps) : elle n’est chargée que si vous appuyez sur « Afficher la carte ». Une fois chargée, Google peut enregistrer des cookies dans votre navigateur, selon sa propre politique.

## Comment contrôler les cookies
Vous pouvez supprimer ou bloquer les cookies dans les paramètres de votre navigateur à tout moment.

## Questions
Utilisez le contact indiqué dans la Politique de confidentialité.`,
  },
  de: {
    title: 'Cookie-Richtlinie',
    body: `## Was Cookies sind
Cookies sind kleine Dateien, die eine Website in Ihrem Browser speichern kann.

## Was diese Website tut
Diese Website setzt keine eigenen Cookies und verwendet keine Analyse-, Werbe- oder Tracking-Cookies. Wir müssen Sie daher nicht um Ihre Einwilligung zu Cookies bitten.

## Dienste Dritter
Die Schriftarten werden von dieser Website selbst bereitgestellt. Der einzige Dienst Dritter ist:
- Karte (Google Maps): Sie wird nur geladen, wenn Sie auf „Karte anzeigen“ tippen. Nach dem Laden kann Google gemäß der eigenen Richtlinie Cookies in Ihrem Browser speichern.

## Cookies verwalten
Sie können Cookies jederzeit in den Einstellungen Ihres Browsers löschen oder blockieren.

## Fragen
Nutzen Sie den in der Datenschutzerklärung genannten Kontakt.`,
  },
  es: {
    title: 'Política de Cookies',
    body: `## Qué son las cookies
Las cookies son pequeños archivos que un sitio web puede guardar en su navegador.

## Qué hace este sitio
Este sitio no establece cookies propias y no utiliza cookies de análisis, publicidad ni seguimiento. Por eso no necesitamos pedirle su consentimiento para las cookies.

## Servicios de terceros
Las fuentes las sirve este propio sitio. El único servicio de terceros es:
- Mapa (Google Maps): solo se carga si pulsa "Mostrar mapa". Una vez cargado, Google puede guardar cookies en su navegador, según su propia política.

## Cómo controlar las cookies
Puede borrar o bloquear las cookies en la configuración de su navegador en cualquier momento.

## Dudas
Utilice el contacto indicado en la Política de Privacidad.`,
  },
}

function blocksHtml(text, lang) {
  // The same text is shown in the kiosk ("this window"); on the website it is a page.
  const fix = (s) => (lang === 'pt' ? s.replace(/desta janela/g, 'desta página') : lang === 'en' ? s.replace(/this window/g, 'this page') : s)
  return parseLegal(text).map((b) => (
    b.type === 'h' ? `<h2>${esc(fix(b.text))}</h2>`
      : b.type === 'ul' ? `<ul>${b.items.map((i) => `<li>${esc(fix(i))}</li>`).join('')}</ul>`
        : `<p>${esc(fix(b.text))}</p>`
  )).join('\n')
}

/**
 * @param {'privacy'|'terms'|'cookies'} doc
 * @param {{ lang, brand:{name,logo}, legal:object (mergeLegal result), available:string[] }} opts
 */
export function renderLegalPage(doc, { lang = 'pt', brand, legal, available = ['pt'] } = {}) {
  if (!UI[lang]) lang = 'pt'
  const L = UI[lang]
  const titleOf = { privacy: L.privacyLink, terms: L.termsLink, cookies: L.cookiesLink }
  const title = titleOf[doc] || L.privacyLink
  const text = doc === 'cookies' ? COOKIES[lang].body : legalText(doc === 'terms' ? legal.terms : legal.privacy, lang)
  const parts = [legal.company, legal.nif && `NIF ${legal.nif}`, legal.address, legal.phone, legal.email].filter(Boolean)
  const langs = LANGS.filter((l) => l === 'pt' || available.includes(l))
  const switcher = langs.length > 1
    ? `<nav class="langs" aria-label="${esc(L.langAria)}">${langs.map((l) => `<a href="${langPath(l) === '/' ? '' : langPath(l)}/legal/${doc}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`).join('')}</nav>`
    : ''
  const home = langPath(lang)
  return `<!doctype html>
<html lang="${esc(L.htmlLang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(brand.name)}</title>
<meta name="robots" content="index,follow">
<link rel="icon" href="${esc(brand.logo)}">
<link rel="stylesheet" href="/fonts/fonts.css">
<style>
:root{ --ink:#0f2a27; --soft:#3d6a63; --p:#0d9488; --p9:#134e4a }
*{ box-sizing:border-box } body{ margin:0; font:16px/1.65 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:var(--ink); background:linear-gradient(180deg,#f0fdfa,#fff 240px) }
header{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 20px; max-width:860px; margin:0 auto }
header a.brand{ display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--p9); font-weight:700 }
header img{ width:32px; height:32px; object-fit:contain }
.langs{ display:flex; gap:10px; font-size:13px } .langs a{ color:var(--soft); text-decoration:none } .langs a[aria-current]{ color:var(--p9); font-weight:700 }
main{ max-width:860px; margin:0 auto; padding:8px 20px 56px }
.back{ display:inline-flex; align-items:center; gap:6px; margin-top:8px; padding:10px 16px; border-radius:999px; background:#fff; border:1px solid rgba(13,148,136,.3); color:var(--p9); font-weight:600; font-size:15px; text-decoration:none }
.back:hover{ background:#f0fdfa }
h1{ font-size:30px; line-height:1.2; color:var(--p9); margin:12px 0 18px }
h2{ font-size:19px; color:var(--p9); margin:28px 0 8px }
ul{ padding-left:22px } li{ margin:4px 0 }
.entity{ margin-top:32px; padding:16px 18px; border:1px solid rgba(13,148,136,.2); border-radius:14px; background:#f8fffd; color:var(--soft); font-size:15px }
.entity b{ display:block; font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:#7a9a95; margin-bottom:4px }
footer{ max-width:860px; margin:0 auto; padding:0 20px 40px; font-size:13px; color:#7a9a95; display:flex; gap:18px; flex-wrap:wrap }
footer a{ color:inherit }
</style>
</head>
<body>
<header>
  <a class="brand" href="${esc(home)}"><img src="${esc(brand.logo)}" alt="" width="32" height="32"><span>${esc(brand.name)}</span></a>
  ${switcher}
</header>
<main>
  <a class="back" href="${esc(home)}">&larr; ${esc(L.legalBack)}</a>
  <h1>${esc(title)}</h1>
  ${blocksHtml(text, lang)}
  ${parts.length ? `<div class="entity"><b>${esc(L.legalEntity)}</b>${esc(parts.join(' · '))}</div>` : ''}
</main>
<footer>
  <a href="${esc(home)}">${esc(L.legalBack)}</a>
  <a href="${langPath(lang) === '/' ? '' : langPath(lang)}/legal/privacy">${esc(L.privacyLink)}</a>
  <a href="${langPath(lang) === '/' ? '' : langPath(lang)}/legal/terms">${esc(L.termsLink)}</a>
  <a href="${langPath(lang) === '/' ? '' : langPath(lang)}/legal/cookies">${esc(L.cookiesLink)}</a>
</footer>
</body>
</html>`
}

export { SITE_URL }

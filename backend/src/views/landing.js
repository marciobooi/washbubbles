/**
 * Server-rendered public front page — plain HTML/CSS/vanilla JS, deliberately not
 * part of the React SPA.
 *
 * Why: the SPA is client-rendered, so a crawler (and a link preview, and anyone
 * with JS disabled or slow) sees an empty shell until the bundle runs. This route
 * returns fully-formed markup in the FIRST response — real headings, real text,
 * real structured data — so Google (and everyone else) can read it immediately.
 *
 * Business facts (address, phone, hours, rating, email, socials — DEFAULT_CONTENT.brand,
 * below) and the page's marketing COPY (headings, step/feature/CTA/quote text,
 * and any admin-added sections) are both stored as one Setting (key
 * CONTENT_SETTING_KEY) and editable from the "Página Inicial" tab in
 * AdminSettings.jsx. There's deliberately only one source of truth for a
 * business fact: jsonLd(), below, builds structured data straight from the
 * same content, so editing the phone number here can never leave the visible
 * page and Google's LocalBusiness schema disagreeing with each other. Only the
 * logo (a real uploaded asset, not text) stays outside this and fixed in code.
 * DEFAULT_CONTENT is both the shipped copy/facts and the fallback used
 * whenever nothing's been saved yet or the DB read fails — see routes/public.js
 * for how the two are combined, with a short cache and a timeout so a Mongo
 * hiccup never takes this page down.
 *
 * Served only when PUBLIC_LANDING_PAGE=true (routes/public.js) — the shop-kiosk
 * build's own "/" is the real point-of-sale UI and must never be shadowed by
 * this. See docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md §16.
 */

const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://freshbubbles.pt'
const LOGIN_URL = '/admin/login'
// Default until an admin uploads a different one — via the existing Branding
// tab's logo upload (Setting key branding.logo), not a separate control
// here. routes/public.js reads that Setting and overlays it onto
// content.brand.logo before rendering; see its own comment for why.
const DEFAULT_LOGO_PATH = '/geral/freshbubbleslogo.png'

// ---------------------------------------------------------------------------
// Editable content — see the file-level comment above. Persisted under this
// Setting key (single-tenant deployment: no tenant qualifier needed beyond
// what withTenant already resolves — see routes/public.js).
export const CONTENT_SETTING_KEY = 'landingPage.content'

export const DEFAULT_CONTENT = {
  // Real, current facts only — originally from the business's own Google
  // Business Profile (address, phone, hours, rating). Editable from admin;
  // these values are also what ships if nothing's ever been saved.
  brand: {
    name: 'Fresh Bubbles',
    tagline: 'Laundry & Ironing', // the exact tagline printed on the real logo mark
    email: 'marcacoes@freshbubbles.pt',
    logo: DEFAULT_LOGO_PATH,
    phone: '+351 912 715 258',
    address: {
      street: 'Av. Dr. António Carvalho de Figueiredo 35A',
      postal: '2670-407',
      city: 'Loures',
      country: 'Portugal',
    },
    hours: { open: '07:00', close: '23:30' },
    rating: { value: 4.5, count: 11 },
    social: [
      { name: 'Instagram', url: 'https://www.instagram.com/freshbubblesloures/' },
    ],
  },
  hero: {
    eyebrow: 'Lavandaria em Loures',
    heading: 'Coloque. Pague.',
    accent: 'Retire fresca.',
    subheading: 'Máquinas modernas, dos 8 aos 20kg. Pague em moedas, notas, cartão bancário ou o seu cartão Fresh Bubbles. Sem marcações, sem filas — chegue, lave, siga a sua vida.',
    ctaPrimaryLabel: 'Como funciona',
    ctaSecondaryLabel: 'Visite-nos',
  },
  steps: {
    visible: true,
    eyebrow: 'O processo',
    heading: 'Três passos, sem complicações',
    description: 'Da roupa suja à roupa fresca, sem precisar de mais nada além de tempo livre.',
    items: [
      { t: 'Coloque a roupa', d: 'Escolha a máquina do tamanho certo — dos 8 aos 20kg — e coloque a roupa suja.' },
      { t: 'Pague como preferir', d: 'Moedas, notas, cartão bancário ou o seu cartão Fresh Bubbles. Sem app a instalar.' },
      { t: 'Retire fresca', d: 'Lavagem e secagem rápidas. Enquanto espera, ligue-se ao WiFi grátis.' },
    ],
  },
  features: {
    visible: true,
    eyebrow: 'Porquê a Fresh Bubbles',
    heading: 'Feito para o seu dia a dia',
    description: 'O essencial de uma lavandaria, sem o que não precisa.',
    items: [
      { t: 'Self-service, à sua hora', d: 'Moedas, notas, cartão bancário ou cartão de cliente. Sem marcações — chegue quando lhe for melhor.' },
      { t: 'Engomadoria', d: 'Deixe a roupa connosco e leve-a pronta a vestir, sem passar a ferro em casa.' },
      { t: 'Limpeza a seco', d: 'Para as peças mais delicadas, o cuidado que precisam.' },
      { t: 'Lavagem de tapetes', d: 'Tapetes lavados com o mesmo cuidado da sua roupa.' },
      { t: 'Recolha e entrega ao domicílio', d: 'Não tem de sair de casa — nós vamos buscar e entregamos.' },
      { t: 'Enquanto espera', d: 'Vending de snacks e bebidas, e WiFi grátis — a sua pausa, tratada.' },
    ],
  },
  cta: {
    visible: true,
    heading: 'Pronta para a próxima lavagem?',
    description: 'Sem marcações. Chegue quando lhe for melhor e a sua roupa espera por si, fresca.',
  },
  visit: {
    visible: true,
    eyebrow: 'Visite-nos',
    heading: 'Onde estamos',
    description: 'Em Loures, aberta todos os dias.',
    // The nav/footer already link to /admin/login — this is a second, more
    // prominent copy of that link sitting inside the public contact card.
    // Admin-toggleable since a marketing page for customers doesn't always
    // want to advertise a staff-only link that prominently.
    showLoginLink: true,
  },
  // Its own section, not part of Visite-nos — testimonials aren't contact
  // info. One real, attributed review only — never invent text for the
  // others Google shows. Admin can add more once their real text is on
  // hand; the carousel degrades to a static single quote when there's just
  // one, same as it always looked before this had its own section.
  reviews: {
    visible: true,
    eyebrow: 'O que dizem',
    heading: 'Avaliações reais no Google',
    items: [
      { text: 'Serviço impecável e atenção espetacular.', author: 'Daniel Vinhas' },
    ],
  },
  customSections: [],
}

/**
 * Merge admin-saved content (partial, and possibly saved under an older
 * shape) onto DEFAULT_CONTENT. Explicit per-field rather than a generic
 * deep-merge lib — the shape is small and fixed, and this way a missing or
 * malformed field always falls back to a real default instead of `undefined`
 * reaching the template.
 */
export function mergeContent(raw) {
  const c = (raw && typeof raw === 'object') ? raw : {}
  const items = (list, fallback) => (Array.isArray(list) && list.length ? list : fallback)
  const b = (c.brand && typeof c.brand === 'object') ? c.brand : {}
  // `val != null` first: Number(null) is 0 and Number.isFinite(0) is true, so
  // a saved `{ count: null }` would otherwise merge in as a real 0 instead of
  // falling back to the default — "field not provided" and "field is zero"
  // must stay distinguishable.
  const numberOr = (val, fallback) => (val != null && Number.isFinite(Number(val)) ? Number(val) : fallback)
  return {
    brand: {
      ...DEFAULT_CONTENT.brand,
      ...b,
      address: { ...DEFAULT_CONTENT.brand.address, ...(b.address || {}) },
      hours: { ...DEFAULT_CONTENT.brand.hours, ...(b.hours || {}) },
      rating: {
        value: numberOr(b.rating && b.rating.value, DEFAULT_CONTENT.brand.rating.value),
        count: numberOr(b.rating && b.rating.count, DEFAULT_CONTENT.brand.rating.count),
      },
      // Array.isArray (not "has length") so an intentional "remove all social
      // links" save is honoured — only a field that was never saved at all
      // falls back to the default Instagram entry.
      social: Array.isArray(b.social)
        ? b.social.filter((s) => s && s.name && s.url)
        : DEFAULT_CONTENT.brand.social,
    },
    hero: { ...DEFAULT_CONTENT.hero, ...(c.hero || {}) },
    steps: {
      ...DEFAULT_CONTENT.steps,
      ...(c.steps || {}),
      items: items(c.steps && c.steps.items, DEFAULT_CONTENT.steps.items),
    },
    features: {
      ...DEFAULT_CONTENT.features,
      ...(c.features || {}),
      items: items(c.features && c.features.items, DEFAULT_CONTENT.features.items),
    },
    cta: { ...DEFAULT_CONTENT.cta, ...(c.cta || {}) },
    visit: { ...DEFAULT_CONTENT.visit, ...(c.visit || {}) },
    reviews: {
      ...DEFAULT_CONTENT.reviews,
      ...(c.reviews || {}),
      items: items(c.reviews && c.reviews.items, DEFAULT_CONTENT.reviews.items),
    },
    // Admin-created sections only — needs at least a heading to be worth a
    // section element, so a half-filled draft never ships blank markup.
    customSections: Array.isArray(c.customSections) ? c.customSections.filter((s) => s && s.heading) : [],
  }
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const slugify = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section'

// Derived from the saved phone number rather than stored as its own field —
// two copies of the same number (display + tel: href) drifting apart after
// an edit is exactly the kind of bug a computed value avoids outright.
const toTelHref = (phone) => String(phone || '').replace(/[^\d+]/g, '')

// Social links are free-form admin input (any name, any URL) — not a fixed
// per-platform config — so the icon is picked by matching the name against
// known platforms, with a plain "link" glyph for anything else. Good enough
// for a small row icon; never blocks adding a profile we don't recognise.
const SOCIAL_ICON_PATHS = {
  instagram: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M17.5 6.5h.01',
  facebook: 'M14 9h3V6h-3a4 4 0 0 0-4 4v2H8v3h2v6h3v-6h3l1-3h-4v-2a1 1 0 0 1 1-1z',
  tiktok: 'M14 3v10.5a2.5 2.5 0 1 1-2.5-2.5 M14 3a5 5 0 0 0 5 5',
  whatsapp: 'M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3z M8.5 8.5c0 4 3 7 7 7',
}
const GENERIC_LINK_ICON_PATH = 'M9.5 14.5l5-5 M8 12a4 4 0 0 1 0-5.5l1.5-1.5a4 4 0 0 1 5.5 5.5 M16 12a4 4 0 0 1 0 5.5l-1.5 1.5a4 4 0 0 1-5.5-5.5'
const socialIconPath = (name) => SOCIAL_ICON_PATHS[String(name || '').trim().toLowerCase()] || GENERIC_LINK_ICON_PATH

/**
 * The hand-drawn coral underline — the page's one recurring "emphasis" mark
 * (hero, and other section headings via accentLastWord() below). A single
 * path stretched to fit each span's width via preserveAspectRatio="none"
 * looked visibly different per word — a short word ("Google") squashed the
 * same wave into a different rhythm than a long phrase ("Retire fresca.")
 * did. This tiles one fixed-period wave instead (CSS background-repeat), so
 * the rhythm is identical everywhere regardless of what text it's under;
 * sized in em so it still scales with each heading's own font-size.
 */
const SQUIGGLE_DATA_URI = (() => {
  // A full up-then-down period per tile (like one sine cycle): two quadratic
  // curves through the same midline (0,10)->(45,10)->(90,10) via control
  // points (22.5,3) and (67.5,17). What makes it join seamlessly instead of
  // looking like separate dashes: the tangent *arriving* at x=90 (heading
  // away from control point (67.5,17)) is identical to the tangent
  // *leaving* x=0 (heading toward (22.5,3)) — both (+22.5,-7) — so one
  // tile's end flows into the next tile's start at the same angle.
  //
  // The viewBox's own 90:20 (4.5:1) aspect ratio matches the ~4.5:1 shape of
  // the CSS box it's scaled into (background-size: 1.35em .3em, below) —
  // that match matters: an earlier square (1:1) viewBox squashed into that
  // same wide, short box rendered as disconnected dashes instead of a
  // continuous wave in Chromium, even though the path was mathematically
  // C1-continuous across tile edges. A non-uniform background-size stretch
  // on an SVG apparently isn't just "the same picture, scaled" in practice.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='20' viewBox='0 0 90 20'>
    <path d='M0 10 Q22.5 3 45 10 Q67.5 17 90 10' fill='none' stroke='#ff8b6b' stroke-width='5' stroke-linecap='round'/>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
})()

/**
 * Underlines the last word of a heading with the squiggle. Section headings
 * are single free-text admin fields (unlike the hero, which has a dedicated
 * `accent` field for exactly the emphasized phrase) — wrapping a specific
 * word chosen in code would silently stop matching the moment an admin
 * edits the text. The last word always exists, so this stays correct for
 * whatever the heading currently says.
 */
function accentLastWord(text) {
  const trimmed = String(text || '').trim()
  const lastSpace = trimmed.lastIndexOf(' ')
  if (lastSpace === -1) return `<span class="accent">${escapeHtml(trimmed)}</span>`
  return `${escapeHtml(trimmed.slice(0, lastSpace + 1))}<span class="accent">${escapeHtml(trimmed.slice(lastSpace + 1))}</span>`
}

/** A small inline SVG "porthole" — the washing-machine drum window that's already the real logo's central mark, reused here as the page's one recurring signature shape. */
function porthole({ size = 120, ring = true, spin = false } = {}) {
  const id = `ph-${Math.round(Math.random() * 1e9).toString(36)}`
  return `
    <svg class="porthole${spin ? ' porthole--spin' : ''}" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="${id}-glass" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
          <stop offset="45%" stop-color="#ccfbf1" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="#0d9488" stop-opacity="0.18"/>
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="47" fill="url(#${id}-glass)" stroke="#0f766e" stroke-opacity="0.25" stroke-width="1.5"/>
      ${ring ? `
      <circle cx="50" cy="50" r="34" fill="none" stroke="#0d9488" stroke-opacity="0.55" stroke-width="3"/>
      <path d="M50 16 C 66 16 79 27 79 44 C 79 54 73 61 64 66" fill="none" stroke="#14b8a6" stroke-width="3" stroke-linecap="round" stroke-opacity="0.85"/>
      ` : ''}
    </svg>`
}

/**
 * A subtle grain texture, generated once at module load — not a downloaded
 * asset. Flat CSS gradients alone read as slightly plasticky; a faint
 * blend-moded noise layer over the whole page is one of the cheapest ways to
 * make a digital surface feel physical/designed rather than templated.
 */
const NOISE_DATA_URI = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>
    <filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter>
    <rect width='100%' height='100%' filter='url(#n)'/>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
})()

function starIcon() {
  return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.4 6.1 20.5l1.3-6.6-4.9-4.5 6.6-.8z"/></svg>'
}

function bubbleDots(n = 5) {
  let out = ''
  for (let i = 0; i < n; i++) {
    const size = 6 + ((i * 7) % 14)
    const left = 8 + ((i * 53) % 84)
    const delay = (i * 1.7).toFixed(1)
    const dur = (9 + (i % 4) * 2.5).toFixed(1)
    out += `<span class="bubble" style="--size:${size}px; --left:${left}%; --delay:${delay}s; --dur:${dur}s"></span>`
  }
  return out
}

/** A single static background bubble, scroll-parallaxed via data-parallax — see .bg-bubble's own CSS comment. `pos` is any mix of top/left/right/bottom CSS values. */
function bgBubble({ size = 80, pos, opacity = 0.5, speed = 0.08 }) {
  return `<span class="bg-bubble" style="width:${size}px; height:${size}px; ${pos}; opacity:${opacity}" data-parallax="${speed}" aria-hidden="true"></span>`
}

function jsonLd(content) {
  const brand = content.brand
  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: brand.name,
    url: SITE_URL,
    image: `${SITE_URL}${brand.logo}`,
    email: brand.email,
    telephone: brand.phone,
    description: 'Lavandaria self-service, engomadoria, limpeza a seco e lavagem de tapetes em Loures. Recolha e entrega ao domicílio disponível.',
    priceRange: '€€',
    areaServed: 'Loures',
    address: {
      '@type': 'PostalAddress',
      streetAddress: brand.address.street,
      postalCode: brand.address.postal,
      addressLocality: brand.address.city,
      addressCountry: 'PT',
    },
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: brand.hours.open,
      closes: brand.hours.close,
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: brand.rating.value,
      reviewCount: brand.rating.count,
    },
    sameAs: brand.social.map((s) => s.url),
  }
  // Business facts are admin text now, not a fixed literal — JSON.stringify
  // alone doesn't escape "<", so a saved value containing "</script>" could
  // otherwise close this tag early and inject markup. < is valid inside
  // a JSON string and decodes back to "<" on JSON.parse, so this is inert to
  // any consumer reading the structured data, just unusable as HTML.
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

/** An admin-created section: heading + body text + an optional CTA button. Not a general layout/block editor — see the file-level comment on scope. */
function renderCustomSection(cs) {
  const slug = slugify(cs.id || cs.heading)
  return `
  <section id="custom-${slug}" aria-labelledby="custom-${slug}-h">
    <div class="wrap">
      <div class="section-head reveal">
        ${cs.eyebrow ? `<span class="eyebrow">${escapeHtml(cs.eyebrow)}</span>` : ''}
        <h2 id="custom-${slug}-h">${escapeHtml(cs.heading)}</h2>
        ${cs.body ? `<p>${escapeHtml(cs.body)}</p>` : ''}
      </div>
      ${cs.ctaLabel && cs.ctaHref ? `
      <div style="text-align:center">
        <a class="btn-primary" href="${escapeHtml(cs.ctaHref)}">${escapeHtml(cs.ctaLabel)}</a>
      </div>` : ''}
    </div>
  </section>`
}

export function renderLandingPage(rawContent) {
  const content = mergeContent(rawContent)
  const brand = content.brand
  const fullAddress = `${brand.address.street}, ${brand.address.postal} ${brand.address.city}, ${brand.address.country}`
  const mapsQuery = encodeURIComponent(fullAddress)
  const title = `${brand.name} Loures — Lavandaria Self-Service, Engomadoria e Limpeza a Seco`
  const description = `Lavandaria self-service em Loures: máquinas de lavar e secar, engomadoria, limpeza a seco, lavagem de tapetes e recolha ao domicílio. Avaliação ${brand.rating.value}/5 no Google.`

  return `<!DOCTYPE html>
<html lang="pt-PT">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${SITE_URL}/">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#0d9488">

<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(brand.name)}">
<meta property="og:locale" content="pt_PT">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:image" content="${SITE_URL}${escapeHtml(brand.logo)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${SITE_URL}${escapeHtml(brand.logo)}">

<link rel="icon" href="${escapeHtml(brand.logo)}" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@500;600;700;800&display=swap" rel="stylesheet">

<script type="application/ld+json">${jsonLd(content)}</script>

<style>
:root{
  --ink:#0f2a27; --ink-soft:#3d6a63;
  --primary-50:#f0fdfa; --primary-100:#ccfbf1; --primary-200:#99f6e4; --primary-300:#5eead4;
  --primary-400:#2dd4bf; --primary-500:#14b8a6; --primary-600:#0d9488; --primary-700:#0f766e;
  --primary-800:#115e59; --primary-900:#134e4a;
  --coral:#ff8b6b; --coral-dark:#e8663f;
  --font-head:'Poppins',ui-sans-serif,system-ui,sans-serif;
  --font-body:'Inter',ui-sans-serif,system-ui,sans-serif;
  --shadow-soft:0 1px 2px rgba(15,42,39,.04),0 8px 24px -8px rgba(15,42,39,.10);
  --shadow-lift:0 4px 10px rgba(15,42,39,.06),0 24px 48px -16px rgba(13,148,136,.28);
  --shadow-btn:0 8px 20px -6px rgba(13,148,136,.55),0 2px 6px rgba(15,42,39,.12);
  --shadow-btn-hover:0 12px 28px -6px rgba(255,139,107,.55),0 4px 10px rgba(15,42,39,.14);
  --container:1160px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){ html{scroll-behavior:auto} }
body{
  margin:0; color:var(--ink); font-family:var(--font-body); line-height:1.55;
  background:
    radial-gradient(1200px 600px at 85% -10%, var(--primary-100) 0%, transparent 60%),
    radial-gradient(900px 500px at -6% 8%, #fff2e4 0%, transparent 52%),
    radial-gradient(700px 900px at 100% 55%, rgba(45,212,191,.14) 0%, transparent 60%),
    var(--primary-50);
  -webkit-font-smoothing:antialiased;
  position:relative;
}
/* Grain — see NOISE_DATA_URI's own comment. Fixed + blended, so it reads as
   texture on the surface rather than a moving/scrolling layer. */
body::after{
  content:''; position:fixed; inset:0; z-index:999; pointer-events:none;
  background-image:url("${NOISE_DATA_URI}"); background-size:170px 170px;
  opacity:.035; mix-blend-mode:overlay;
}
h1,h2,h3{ font-family:var(--font-head); color:var(--ink); margin:0; letter-spacing:-0.01em }
p{ margin:0 }
a{ color:inherit }
img{ max-width:100%; display:block }
.wrap{ max-width:var(--container); margin:0 auto; padding-inline:20px }
:focus-visible{ outline:3px solid var(--coral); outline-offset:2px; border-radius:6px }
.sr-only{ position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0 }
.skip-link{ position:absolute; left:12px; top:-60px; background:var(--ink); color:#fff; padding:10px 16px; border-radius:8px; z-index:200; transition:top .2s }
.skip-link:focus{ top:12px }

/* ---------- nav ---------- */
.nav{
  position:sticky; top:0; z-index:100;
  background:rgba(240,253,250,.72); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
  border-bottom:1px solid rgba(13,148,136,.10);
}
.nav .wrap{ display:flex; align-items:center; justify-content:space-between; height:72px; gap:16px }
.brand{ display:flex; align-items:center; gap:10px; text-decoration:none; flex-shrink:0 }
.brand .brand-logo{ width:36px; height:36px; object-fit:contain }
.brand-word{ font-family:var(--font-head); font-weight:700; font-size:19px; color:var(--primary-900); line-height:1.1 }
.brand-word small{ display:block; font-family:var(--font-body); font-weight:500; font-size:10.5px; letter-spacing:.11em; color:var(--ink-soft); text-transform:uppercase }

.nav-links{ display:flex; align-items:center; gap:6px; list-style:none; margin:0; padding:0 }
.nav-links a{
  text-decoration:none; font-weight:500; font-size:14.5px; color:var(--ink-soft);
  padding:9px 14px; border-radius:999px; transition:background .18s ease, color .18s ease;
}
.nav-links a:hover{ background:rgba(13,148,136,.10); color:var(--primary-800) }

.nav-right{ display:flex; align-items:center; gap:10px }
.btn-login{
  display:inline-flex; align-items:center; gap:8px; text-decoration:none;
  font-family:var(--font-body); font-weight:600; font-size:14.5px; color:#fff;
  background:linear-gradient(135deg,var(--primary-600),var(--primary-700));
  padding:10px 20px 10px 16px; border-radius:999px; box-shadow:var(--shadow-btn);
  transition:transform .22s cubic-bezier(.175,.885,.32,1.275), box-shadow .22s ease, background .22s ease;
}
.btn-login:hover{ transform:translateY(-2px); box-shadow:var(--shadow-btn-hover); background:linear-gradient(135deg,var(--primary-500),var(--primary-600)) }
.btn-login:active{ transform:translateY(0) scale(.97) }
.btn-login svg{ width:17px; height:17px }

.nav-toggle{
  display:none; background:none; border:0; padding:8px; border-radius:8px; cursor:pointer;
}
.nav-toggle svg{ width:24px; height:24px; color:var(--primary-900) }

/* ---------- buttons / links (shared) ---------- */
.btn-primary{
  display:inline-flex; align-items:center; gap:10px; text-decoration:none;
  font-family:var(--font-body); font-weight:600; font-size:16px; color:#fff;
  background:linear-gradient(135deg,var(--primary-600),var(--primary-700));
  padding:15px 28px; border-radius:999px; box-shadow:var(--shadow-btn);
  transition:transform .22s cubic-bezier(.175,.885,.32,1.275), box-shadow .22s ease;
}
.btn-primary:hover{ transform:translateY(-3px); box-shadow:var(--shadow-btn-hover) }
.btn-ghost{
  display:inline-flex; align-items:center; gap:8px; text-decoration:none;
  font-weight:600; font-size:16px; color:var(--primary-800);
  padding:15px 22px; border-radius:999px; border:1.5px solid rgba(13,148,136,.28);
  transition:background .2s ease, border-color .2s ease, transform .2s ease;
}
.btn-ghost:hover{ background:rgba(13,148,136,.08); border-color:rgba(13,148,136,.5); transform:translateY(-2px) }

/* ---------- hero ---------- */
.hero{ padding:64px 0 88px; position:relative; overflow:clip }
.hero .wrap{ display:grid; grid-template-columns:1.05fr .95fr; gap:48px; align-items:center }
.eyebrow{
  display:inline-flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600;
  letter-spacing:.14em; text-transform:uppercase; color:var(--primary-700);
  background:rgba(13,148,136,.10); padding:7px 14px; border-radius:999px; margin-bottom:20px;
}
.eyebrow::before{ content:''; width:6px; height:6px; border-radius:999px; background:var(--coral) }
.hero h1{
  font-size:clamp(2.4rem,4.6vw + 1rem,3.85rem); font-weight:700; line-height:1.06; letter-spacing:-0.02em;
}
/* .accent — the hand-drawn coral underline. Started as the hero's own
   emphasis mark, now reused on other headings via accentLastWord() (see its
   own comment); sized in em so the same markup reads right at any heading's
   font-size without a per-context override. */
.accent{
  color:var(--primary-700); position:relative; white-space:nowrap;
}
/* ::before (not ::after) so it's generated BEFORE the text node in paint
   order — later content paints on top at the same stacking level, so this
   sits under the text with no z-index needed (z-index:-1 here only worked
   in *some* ancestor stacking contexts: fine in the hero, invisible inside
   the CTA band's own layered background). A tiled background-repeat instead
   of one stretched SVG keeps the wave's rhythm identical under any word,
   long or short — see SQUIGGLE_DATA_URI's own comment. */
.accent::before{
  content:''; position:absolute; left:-2%; right:-2%; bottom:-.12em; height:.3em;
  background-image:url("${SQUIGGLE_DATA_URI}");
  background-repeat:repeat-x; background-size:1.35em .3em; background-position:left center;
  /* Hidden until drawn in — clip-path grows left-to-right like a pen stroke,
     not a fade, so it actually reads as "hand-drawn" rather than "appeared". */
  clip-path:inset(0 100% 0 0);
}
.cta-band h2 .accent{ color:#fff }
/* Hero is above the fold — visible immediately, nothing to scroll into
   view — so its squiggle draws itself in shortly after load instead of
   waiting on the .reveal/IntersectionObserver mechanism the other headings
   use below (there's nothing for that to trigger on here). */
.hero .accent::before{ animation:draw-squiggle .9s cubic-bezier(.16,.84,.44,1) .5s forwards }
@keyframes draw-squiggle{ to{ clip-path:inset(0 0 0 0) } }
/* Everywhere else, the heading itself sits inside a .reveal element (the
   section-head div, or .cta-band) — same trigger the eyebrow already uses,
   so the squiggle draws in right as its heading scrolls into view. */
.reveal.is-visible .accent::before{
  clip-path:inset(0 0 0 0); transition:clip-path .8s cubic-bezier(.16,.84,.44,1) .1s;
}
@media (prefers-reduced-motion:reduce){
  .accent::before{ clip-path:inset(0 0 0 0); animation:none; transition:none }
}
.hero-sub{ margin-top:22px; font-size:17.5px; color:var(--ink-soft); max-width:46ch }
.hero-cta{ display:flex; flex-wrap:wrap; gap:14px; margin-top:34px }
.hero-note{ margin-top:22px; display:flex; align-items:center; flex-wrap:wrap; gap:10px; font-size:14px; color:var(--ink-soft) }
.hero-note > svg{ width:18px; height:18px; color:var(--primary-600); flex-shrink:0 }
.rating-chip{
  display:inline-flex; align-items:center; gap:5px; font-weight:600; color:var(--primary-800);
  background:rgba(255,255,255,.7); border:1px solid rgba(13,148,136,.18); padding:4px 11px 4px 8px; border-radius:999px;
}
.rating-chip svg{ width:14px; height:14px; color:var(--coral-dark) }
.rating-count{ font-weight:500; color:var(--ink-soft) }

.hero-art{ position:relative; aspect-ratio:1/1; display:flex; align-items:center; justify-content:center }
/* Each porthole sits in its own positioned wrapper (.pl) so scroll-parallax
   (JS, sets translateY on the wrapper) and the drum-spin (CSS keyframe on the
   svg itself) animate two different elements — set them on the same element
   and the JS write clobbers the CSS animation's transform every frame. */
.hero-art .pl{ position:absolute; will-change:transform }
.hero-art .pl .porthole{ display:block; width:100%; height:100%; filter:drop-shadow(0 30px 45px rgba(13,148,136,.22)) }
.hero-art .pl.ph-main{ width:80%; height:80%; }
.hero-art .pl.ph-back-a{ width:40%; height:40%; top:-4%; left:-6%; opacity:.85 }
.hero-art .pl.ph-back-b{ width:27%; height:27%; bottom:2%; right:-3%; opacity:.9 }
.hero-art .pl.ph-back-c{ width:16%; height:16%; top:12%; right:8%; opacity:.8 }
.ph-glow{
  position:absolute; inset:6%; border-radius:999px; z-index:-1;
  background:radial-gradient(circle at 40% 35%, rgba(45,212,191,.45), rgba(13,148,136,.14) 55%, transparent 75%);
  filter:blur(32px);
}
.porthole--spin{ animation:spin 32s linear infinite }
@keyframes spin{ to{ transform:rotate(360deg) } }
@media (prefers-reduced-motion:reduce){ .porthole--spin{ animation:none } }

.bubble{
  position:absolute; left:var(--left); bottom:-10%; width:var(--size); height:var(--size);
  border-radius:999px; background:radial-gradient(circle at 32% 28%, rgba(255,255,255,.95), rgba(153,246,228,.35) 60%, rgba(13,148,136,.12));
  box-shadow:inset 0 0 6px rgba(255,255,255,.6);
  animation:drift var(--dur) ease-in var(--delay) infinite;
}
@keyframes drift{
  0%{ transform:translateY(0) translateX(0); opacity:0 }
  10%{ opacity:.9 }
  90%{ opacity:.5 }
  100%{ transform:translateY(-620%) translateX(14px); opacity:0 }
}
@media (prefers-reduced-motion:reduce){ .bubble{ animation:none; opacity:0 } }

/* Background soap bubbles scattered through the rest of the page — same
   glassy radial-gradient look as the hero's .bubble, but static (no
   keyframe animation) since movement here comes entirely from data-parallax
   (the same scroll-linked system the hero portholes already use). Stacking
   a CSS animation AND the JS parallax transform on one element is exactly
   the bug the hero's portholes had to work around with a wrapper div — no
   wrapper needed here since there's only one thing driving transform. */
.bg-bubble{
  position:absolute; border-radius:999px; pointer-events:none; will-change:transform; z-index:0;
  background:radial-gradient(circle at 32% 28%, rgba(255,255,255,.9), rgba(153,246,228,.32) 55%, rgba(13,148,136,.1) 80%, transparent 100%);
  box-shadow:inset 0 0 10px rgba(255,255,255,.5);
}

/* ---------- sections ---------- */
section{ padding:84px 0 }
.section-head{ max-width:640px; margin:0 auto 52px; text-align:center }
.section-head .eyebrow{
  margin-bottom:16px;
  /* Draws in left-to-right when its section scrolls into view, piggybacking
     on .reveal's own IntersectionObserver trigger below — clip-path doesn't
     affect layout/spacing at all, only what's painted, so this needs no JS
     of its own. */
  clip-path:inset(0 100% 0 0);
  transition:clip-path .7s cubic-bezier(.16,.84,.44,1);
}
.reveal.is-visible .eyebrow{ clip-path:inset(0 0 0 0) }
.section-head h2{ font-size:clamp(1.7rem,2.2vw + 1rem,2.5rem); font-weight:700; letter-spacing:-0.015em }
.section-head p{ margin-top:14px; font-size:16.5px; color:var(--ink-soft) }

.reveal{ opacity:0; transform:translateY(22px); transition:opacity .6s ease, transform .6s cubic-bezier(.16,.84,.44,1) }
.reveal.is-visible{ opacity:1; transform:none }
@media (prefers-reduced-motion:reduce){
  .reveal{ opacity:1; transform:none; transition:none }
  .section-head .eyebrow{ clip-path:inset(0 0 0 0); transition:none }
}

/* how it works */
.steps{ display:grid; grid-template-columns:repeat(3,1fr); gap:28px; counter-reset:step; position:relative }
.steps::before{
  content:''; position:absolute; top:44px; left:14%; right:14%; height:2px;
  /* Coral, not teal — matches the squiggle/eyebrow-dot accent color instead
     of introducing a third accent tone. */
  background:repeating-linear-gradient(90deg,rgba(255,139,107,.4) 0 10px,transparent 10px 20px);
}
.step{ position:relative; text-align:center; padding:0 8px }
.step-mark{ position:relative; width:88px; height:88px; margin:0 auto 22px }
.step-mark .porthole{ width:100%; height:100% }
.step-mark span{
  position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-family:var(--font-head); font-weight:700; font-size:26px; color:var(--primary-800);
}
.step h3{ font-size:19px; font-weight:600; margin-bottom:8px }
.step p{ font-size:15px; color:var(--ink-soft) }

/* features */
.features{ display:grid; grid-template-columns:repeat(3,1fr); gap:22px }
.feature-card{
  background:linear-gradient(160deg,rgba(255,255,255,.92),rgba(255,255,255,.62));
  border:1px solid rgba(255,255,255,.7); border-radius:20px; padding:28px 26px;
  box-shadow:var(--shadow-soft); backdrop-filter:blur(6px);
  transition:transform .35s cubic-bezier(.175,.885,.32,1.275), box-shadow .35s ease, border-color .35s ease;
}
.feature-card:hover{ transform:translateY(-6px); box-shadow:var(--shadow-lift); border-color:rgba(255,255,255,.95) }
.feature-icon{
  width:46px; height:46px; border-radius:14px; display:flex; align-items:center; justify-content:center;
  background:linear-gradient(135deg,var(--primary-100),var(--primary-200)); margin-bottom:18px;
}
.feature-icon svg{ width:24px; height:24px; color:var(--primary-700) }
.feature-card h3{ font-size:17px; font-weight:600; margin-bottom:8px }
.feature-card p{ font-size:14.5px; color:var(--ink-soft) }

/* CTA band */
.cta-band{
  background:linear-gradient(135deg,var(--primary-700),var(--primary-900));
  border-radius:28px; padding:56px 44px; text-align:center; position:relative; overflow:hidden;
  box-shadow:0 30px 60px -24px rgba(15,42,39,.45);
}
.cta-band::before{
  content:''; position:absolute; inset:0;
  background:radial-gradient(480px 240px at 15% 0%, rgba(255,255,255,.12), transparent 60%),
             radial-gradient(420px 260px at 100% 100%, rgba(255,139,107,.18), transparent 60%);
}
.cta-band > *{ position:relative }
.cta-watermark{ position:absolute; top:-18%; right:-10%; width:60%; max-width:420px; opacity:.14; pointer-events:none }
.cta-band h2{ color:#fff; font-size:clamp(1.6rem,2vw + 1rem,2.2rem) }
.cta-band p{ color:rgba(240,253,250,.82); margin-top:12px; font-size:16px }
.cta-band .hero-cta{ justify-content:center; margin-top:30px }
.cta-band .btn-ghost{ color:#fff; border-color:rgba(255,255,255,.35) }
.cta-band .btn-ghost:hover{ background:rgba(255,255,255,.12); border-color:rgba(255,255,255,.6) }

/* reviews — a single quote when there's only one (no carousel chrome at
   all), or an auto-playing crossfade carousel once there's more than one.
   Every slide shares the same single grid cell (grid-area:1/1 below), so
   the track auto-sizes to whichever slide is tallest — including the
   currently-invisible ones, since visibility:hidden still counts for grid
   track sizing. Two earlier approaches (measuring heights from JS, and
   absolutely-positioning inactive slides under a flex layout) each had
   their own real bug — a JS snapshot taken before web fonts finished
   loading, and inactive slides silently measuring ~80px wider than the
   active one because absolute inset:0 is relative to the padding edge, not
   the content edge. This has neither problem: the browser's own layout
   engine keeps it correct continuously, with no JS and no padding/inset
   arithmetic to get subtly wrong. */
.reviews{
  max-width:640px; margin:0 auto; text-align:center; position:relative;
  /* Same glass-card language as .feature-card/.visit-card, just lighter —
     a see-through boundary for the quote, not another solid white box. */
  background:rgba(255,255,255,.35); border:1px solid rgba(255,255,255,.55); border-radius:24px;
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  box-shadow:var(--shadow-soft);
  display:grid; align-items:center;
}
.review-slide{
  grid-area:1/1; margin:0; border:0; padding:44px 40px;
  opacity:0; visibility:hidden; transition:opacity .5s ease;
}
.review-slide.is-active{ opacity:1; visibility:visible }
.review-slide p{
  font-family:var(--font-head); font-weight:500; font-size:22px; line-height:1.4; color:var(--primary-900);
  margin:0 0 14px;
}
.review-slide cite{ font-style:normal; font-size:14px; font-weight:600; color:var(--ink-soft) }
.review-slide cite span{ font-weight:400; color:#94a3a1 }
@media (prefers-reduced-motion:reduce){ .review-slide{ transition:none } }

.review-dots{ display:flex; justify-content:center; gap:8px; margin-top:20px }
.review-dot{
  width:8px; height:8px; border-radius:999px; border:0; padding:0; cursor:pointer;
  background:rgba(13,148,136,.25); transition:background .2s ease, transform .2s ease;
}
.review-dot.is-active{ background:var(--primary-600); transform:scale(1.3) }
.review-dot:hover{ background:rgba(13,148,136,.5) }

/* visit us */
.visit{ display:grid; grid-template-columns:1fr 1fr; gap:28px; align-items:start }
.visit-card{
  background:rgba(255,255,255,.85); border:1px solid rgba(255,255,255,.7); border-radius:20px;
  padding:30px 28px; box-shadow:var(--shadow-soft);
}
.visit-card h3{ font-size:15px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--primary-700); margin-bottom:14px }
.visit-row{ display:flex; align-items:flex-start; gap:12px; font-size:15px; color:var(--ink-soft); margin-bottom:12px }
.visit-row:last-child{ margin-bottom:0 }
.visit-row svg{ width:19px; height:19px; color:var(--primary-600); flex-shrink:0; margin-top:2px }
.visit-row a{ color:var(--primary-800); font-weight:600; text-decoration:none }
.visit-row a:hover{ text-decoration:underline }
.map-embed{
  margin-top:18px; border-radius:14px; overflow:hidden; box-shadow:var(--shadow-soft);
  border:1px solid rgba(13,148,136,.14); aspect-ratio:16/11; background:var(--primary-100);
}
.map-embed iframe{ width:100%; height:100%; border:0; display:block }

/* footer */
footer{ border-top:1px solid rgba(13,148,136,.14); padding:40px 0 32px }
footer .wrap{ display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:20px }
.foot-brand{ display:flex; align-items:center; gap:10px }
.foot-brand .brand-logo{ width:28px; height:28px; object-fit:contain }
.foot-brand-text{ font-family:var(--font-head); font-weight:600; font-size:15px; color:var(--primary-900) }
.foot-brand-text small{ display:block; font-family:var(--font-body); font-weight:400; font-size:11.5px; color:var(--ink-soft); letter-spacing:.06em }
footer .foot-links{ display:flex; gap:22px; font-size:13.5px; color:var(--ink-soft) }
footer .foot-links a{ text-decoration:none; color:inherit }
footer .foot-links a:hover{ color:var(--primary-800) }
.foot-copy{ font-size:12.5px; color:#94a3a1; width:100%; text-align:center; margin-top:24px }

/* ---------- responsive ---------- */
@media (max-width:900px){
  .hero .wrap{ grid-template-columns:1fr; gap:40px }
  .hero{ padding-top:40px; text-align:center }
  .hero-sub{ margin-inline:auto }
  .hero-cta{ justify-content:center }
  .hero-note{ justify-content:center }
  /* Children are all position:absolute (no intrinsic size), and the auto
     margins below switch this from grid-stretch to shrink-to-fit sizing — so
     without an explicit width, aspect-ratio has nothing to compute from and
     the whole box (and everything in it) collapses to 0x0. */
  .hero-art{ order:-1; width:100%; max-width:360px; margin:0 auto; aspect-ratio:4/3 }
  .steps{ grid-template-columns:1fr; gap:36px }
  .steps::before{ display:none }
  .features{ grid-template-columns:1fr 1fr }
  .visit{ grid-template-columns:1fr }
}
@media (max-width:680px){
  .nav-links, .nav-right .btn-login span.btn-label{ }
  .nav-links{
    position:fixed; inset:72px 0 auto 0; flex-direction:column; align-items:stretch; gap:2px;
    background:rgba(240,253,250,.98); backdrop-filter:blur(16px);
    padding:14px 20px 20px; border-bottom:1px solid rgba(13,148,136,.14);
    box-shadow:0 18px 30px -14px rgba(15,42,39,.18);
    transform:translateY(-12px); opacity:0; pointer-events:none; transition:transform .25s ease, opacity .2s ease;
  }
  .nav-links a{ padding:13px 14px; font-size:16px; border-radius:12px }
  body.nav-open .nav-links{ transform:translateY(0); opacity:1; pointer-events:auto }
  .nav-toggle{ display:inline-flex }
  .btn-login .btn-label{ display:none }
  .btn-login{ padding:11px }
  section{ padding:60px 0 }
  .features{ grid-template-columns:1fr }
  .cta-band{ padding:40px 24px }
  footer .wrap{ justify-content:center; text-align:center }
  footer .foot-links{ justify-content:center; flex-wrap:wrap }
}
</style>
</head>
<body>
<a class="skip-link" href="#conteudo">Saltar para o conteúdo</a>

<nav class="nav" aria-label="Navegação principal">
  <div class="wrap">
    <a class="brand" href="#topo">
      <img class="brand-logo" src="${escapeHtml(brand.logo)}" alt="${escapeHtml(brand.name)}" width="36" height="36">
      <span class="brand-word">${escapeHtml(brand.name)}<small>${escapeHtml(brand.tagline)}</small></span>
    </a>
    <ul class="nav-links" id="nav-links">
      ${content.steps.visible ? `<li><a href="#como-funciona">Como funciona</a></li>` : ''}
      ${content.features.visible ? `<li><a href="#servicos">Serviços</a></li>` : ''}
      ${content.customSections.filter((s) => s.visible !== false).map((s) => `<li><a href="#custom-${slugify(s.id || s.heading)}">${escapeHtml(s.heading)}</a></li>`).join('')}
      ${content.reviews.visible ? `<li><a href="#avaliacoes">Avaliações</a></li>` : ''}
      ${content.visit.visible ? `<li><a href="#visite-nos">Visite-nos</a></li>` : ''}
    </ul>
    <div class="nav-right">
      <a class="btn-login" href="${LOGIN_URL}" aria-label="Entrar — acesso reservado">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>
        <span class="btn-label">Entrar</span>
      </a>
      <button class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="nav-links" aria-label="Abrir menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
    </div>
  </div>
</nav>

<main id="conteudo">
  <header class="hero" id="topo">
    <div class="wrap">
      <div>
        <span class="eyebrow">${escapeHtml(content.hero.eyebrow)}</span>
        <h1>${escapeHtml(content.hero.heading)}<br><span class="accent">${escapeHtml(content.hero.accent)}</span></h1>
        <p class="hero-sub">${escapeHtml(content.hero.subheading)}</p>
        <div class="hero-cta">
          <a class="btn-primary" href="#como-funciona">${escapeHtml(content.hero.ctaPrimaryLabel)}</a>
          <a class="btn-ghost" href="#visite-nos">${escapeHtml(content.hero.ctaSecondaryLabel)}</a>
        </div>
        <div class="hero-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
          Aberto todos os dias, das ${escapeHtml(brand.hours.open)} às ${escapeHtml(brand.hours.close)}
          <span class="rating-chip">${starIcon()} ${brand.rating.value} <span class="rating-count">(${brand.rating.count} no Google)</span></span>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="ph-glow" data-parallax="0.04"></div>
        <div class="pl ph-main" data-parallax="0.05">${porthole({ size: 420, spin: true })}</div>
        <div class="pl ph-back-a" data-parallax="0.16">${porthole({ size: 160, spin: false })}</div>
        <div class="pl ph-back-b" data-parallax="-0.13">${porthole({ size: 110, spin: false })}</div>
        <div class="pl ph-back-c" data-parallax="0.22">${porthole({ size: 70, spin: false, ring: false })}</div>
        ${bubbleDots(6)}
      </div>
    </div>
  </header>

  ${content.steps.visible ? `
  <section id="como-funciona" aria-labelledby="como-funciona-h" style="position:relative;">
    ${bgBubble({ size: 110, pos: 'top:8%; right:6%;', opacity: 0.55, speed: 0.05 })}
    ${bgBubble({ size: 60, pos: 'bottom:6%; left:5%;', opacity: 0.4, speed: 0.04 })}
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">${escapeHtml(content.steps.eyebrow)}</span>
        <h2 id="como-funciona-h">${accentLastWord(content.steps.heading)}</h2>
        <p>${escapeHtml(content.steps.description)}</p>
      </div>
      <div class="steps">
        ${content.steps.items.map((s, i) => `
        <div class="step reveal" style="transition-delay:${i * 0.08}s">
          <div class="step-mark" data-parallax="${i % 2 === 0 ? 0.06 : -0.06}">${porthole({ size: 88, spin: false })}<span aria-hidden="true">${i + 1}</span></div>
          <h3>${escapeHtml(s.t)}</h3>
          <p>${escapeHtml(s.d)}</p>
        </div>`).join('')}
      </div>
    </div>
  </section>` : ''}

  ${content.features.visible ? `
  <section id="servicos" aria-labelledby="servicos-h" style="background:rgba(255,255,255,.4); position:relative;">
    ${bgBubble({ size: 140, pos: 'bottom:4%; left:4%;', opacity: 0.45, speed: -0.07 })}
    ${bgBubble({ size: 95, pos: 'top:10%; left:8%;', opacity: 0.35, speed: -0.06 })}
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">${escapeHtml(content.features.eyebrow)}</span>
        <h2 id="servicos-h">${accentLastWord(content.features.heading)}</h2>
        <p>${escapeHtml(content.features.description)}</p>
      </div>
      <div class="features">
        ${content.features.items.map((f, i) => `
        <div class="feature-card reveal" style="transition-delay:${(i % 3) * 0.07}s">
          <div class="feature-icon">${featureIcon(i)}</div>
          <h3>${escapeHtml(f.t)}</h3>
          <p>${escapeHtml(f.d)}</p>
        </div>`).join('')}
      </div>
    </div>
  </section>` : ''}

  ${content.customSections.filter((s) => s.visible !== false).map(renderCustomSection).join('')}

  ${content.cta.visible ? `
  <section aria-hidden="false">
    <div class="wrap">
      <div class="cta-band reveal">
        ${bgBubble({ size: 105, pos: 'top:-10%; left:8%;', opacity: 0.3, speed: 0.05 })}
        ${bgBubble({ size: 50, pos: 'bottom:8%; right:22%;', opacity: 0.25, speed: -0.08 })}
        <svg class="cta-watermark" data-parallax="0.06" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="47" fill="none" stroke="#fff" stroke-width="1.5"/>
          <circle cx="50" cy="50" r="34" fill="none" stroke="#fff" stroke-width="2.5"/>
          <path d="M50 16 C 66 16 79 27 79 44 C 79 54 73 61 64 66" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <h2>${accentLastWord(content.cta.heading)}</h2>
        <p>${escapeHtml(content.cta.description)}</p>
        <div class="hero-cta">
          <a class="btn-primary" href="#visite-nos">Visite-nos</a>
          <a class="btn-ghost" href="mailto:${escapeHtml(brand.email)}">Fale connosco</a>
        </div>
      </div>
    </div>
  </section>` : ''}

  ${content.reviews.visible ? `
  <section id="avaliacoes" aria-labelledby="avaliacoes-h" style="position:relative;">
    ${bgBubble({ size: 70, pos: 'top:6%; left:10%;', opacity: 0.5, speed: 0.09 })}
    ${bgBubble({ size: 44, pos: 'bottom:10%; right:12%;', opacity: 0.4, speed: -0.05 })}
    ${bgBubble({ size: 80, pos: 'bottom:2%; left:30%;', opacity: 0.3, speed: 0.06 })}
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">${escapeHtml(content.reviews.eyebrow)}</span>
        <h2 id="avaliacoes-h">${accentLastWord(content.reviews.heading)}</h2>
      </div>

      <div class="reviews reveal"${content.reviews.items.length > 1 ? ' data-review-carousel' : ''}>
        ${content.reviews.items.map((r, i) => `
        <blockquote class="review-slide${i === 0 ? ' is-active' : ''}">
          <p>&ldquo;${escapeHtml(r.text)}&rdquo;</p>
          <cite>${escapeHtml(r.author)} <span>· avaliação no Google</span></cite>
        </blockquote>`).join('')}
        ${content.reviews.items.length > 1 ? `
        <div class="review-dots" role="tablist" aria-label="Avaliações">
          ${content.reviews.items.map((_, i) => `<button type="button" class="review-dot${i === 0 ? ' is-active' : ''}" data-review-dot="${i}" aria-label="Avaliação ${i + 1}"></button>`).join('')}
        </div>` : ''}
      </div>
    </div>
  </section>` : ''}

  ${content.visit.visible ? `
  <section id="visite-nos" aria-labelledby="visite-nos-h" style="position:relative;">
    ${bgBubble({ size: 145, pos: 'top:4%; right:4%;', opacity: 0.4, speed: -0.04 })}
    ${bgBubble({ size: 65, pos: 'bottom:8%; left:6%;', opacity: 0.35, speed: 0.07 })}
    ${bgBubble({ size: 160, pos: 'bottom:-6%; right:20%;', opacity: 0.25, speed: -0.03 })}
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">${escapeHtml(content.visit.eyebrow)}</span>
        <h2 id="visite-nos-h">${escapeHtml(content.visit.heading)}</h2>
        <p>${escapeHtml(content.visit.description)}</p>
      </div>

      <div class="visit reveal">
        <div class="visit-card">
          <h3>Morada</h3>
          <div class="visit-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <a href="https://www.google.com/maps/search/?api=1&query=${mapsQuery}" target="_blank" rel="noopener noreferrer">${escapeHtml(fullAddress)}</a>
          </div>
          <div class="map-embed">
            <iframe src="https://www.google.com/maps?q=${mapsQuery}&output=embed" title="Mapa — ${escapeHtml(fullAddress)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
          </div>
        </div>
        <div class="visit-card">
          <h3>Contacto &amp; horário</h3>
          <div class="visit-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
            <span>Todos os dias, das ${escapeHtml(brand.hours.open)} às ${escapeHtml(brand.hours.close)}</span>
          </div>
          <div class="visit-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <a href="tel:${toTelHref(brand.phone)}">${escapeHtml(brand.phone)}</a>
          </div>
          <div class="visit-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v16H4z" opacity="0"/><path d="M22 6l-10 7L2 6"/><path d="M2 6h20v12H2z"/></svg>
            <a href="mailto:${escapeHtml(brand.email)}">${escapeHtml(brand.email)}</a>
          </div>
          ${brand.social.map((s) => `
          <div class="visit-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${socialIconPath(s.name)}"/></svg>
            <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>
          </div>`).join('')}
          ${content.visit.showLoginLink !== false ? `
          <div class="visit-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>
            <a href="${LOGIN_URL}">Área reservada (equipa)</a>
          </div>` : ''}
        </div>
      </div>
    </div>
  </section>` : ''}
</main>

<footer>
  <div class="wrap">
    <div class="foot-brand">
      <img class="brand-logo" src="${escapeHtml(brand.logo)}" alt="${escapeHtml(brand.name)}" width="28" height="28">
      <span class="foot-brand-text">${escapeHtml(brand.name)}<small>${escapeHtml(brand.tagline)}</small></span>
    </div>
    <div class="foot-links">
      ${content.steps.visible ? `<a href="#como-funciona">Como funciona</a>` : ''}
      ${content.features.visible ? `<a href="#servicos">Serviços</a>` : ''}
      ${content.customSections.filter((s) => s.visible !== false).map((s) => `<a href="#custom-${slugify(s.id || s.heading)}">${escapeHtml(s.heading)}</a>`).join('')}
      ${content.reviews.visible ? `<a href="#avaliacoes">Avaliações</a>` : ''}
      <a href="${LOGIN_URL}">Entrar</a>
    </div>
    <p class="foot-copy">&copy; ${new Date().getFullYear()} ${escapeHtml(brand.name)}. Todos os direitos reservados.</p>
  </div>
</footer>

<script>
(function(){
  var toggle = document.getElementById('nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function(){
      var open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.getElementById('nav-links').addEventListener('click', function(e){
      if (e.target.tagName === 'A') { document.body.classList.remove('nav-open'); toggle.setAttribute('aria-expanded','false'); }
    });
  }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var reveals = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(function(el){ el.classList.add('is-visible'); });
  } else {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function(el){ io.observe(el); });
  }

  // Scroll parallax: each [data-parallax] layer shifts relative to how far it
  // is from the viewport's vertical centre, not from raw scrollY — so depth
  // feels right wherever the element sits on the page (hero near the top,
  // the CTA band's watermark much further down), never a runaway offset.
  // Skipped entirely under reduced motion, same as the spin/drift/reveal above.
  if (!reduceMotion) {
    var layers = [].slice.call(document.querySelectorAll('[data-parallax]'));
    if (layers.length && 'requestAnimationFrame' in window) {
      var vh = window.innerHeight;
      var ticking = false;
      var apply = function(){
        layers.forEach(function(el){
          var speed = parseFloat(el.getAttribute('data-parallax')) || 0;
          var rect = el.getBoundingClientRect();
          var offset = (rect.top + rect.height / 2 - vh / 2) * speed;
          el.style.transform = 'translate3d(0,' + offset.toFixed(1) + 'px,0)';
        });
        ticking = false;
      };
      var onScroll = function(){
        if (!ticking) { window.requestAnimationFrame(apply); ticking = true; }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', function(){ vh = window.innerHeight; apply(); });
      apply();
    }
  }

  // Reviews carousel — only present in the markup at all when there's more
  // than one review (see renderLandingPage), so a single real review still
  // renders exactly as the plain static quote it always was. Auto-advances,
  // pauses on hover/focus (a moving carousel the visitor can't stop is an
  // accessibility trap), and never auto-advances under reduced motion —
  // manual dot navigation still works either way.
  var carousel = document.querySelector('[data-review-carousel]');
  if (carousel) {
    var slides = [].slice.call(carousel.querySelectorAll('.review-slide'));
    var dots = [].slice.call(carousel.querySelectorAll('[data-review-dot]'));
    var active = 0;
    var timer = null;
    // No height bookkeeping needed here — see .reviews's own CSS comment:
    // every slide shares one grid cell, so the card is already sized to
    // the tallest one by the browser's normal layout, kept correct
    // automatically as fonts load or the viewport resizes.
    var show = function(i){
      slides[active].classList.remove('is-active');
      if (dots[active]) dots[active].classList.remove('is-active');
      active = i;
      slides[active].classList.add('is-active');
      if (dots[active]) dots[active].classList.add('is-active');
    };
    var next = function(){ show((active + 1) % slides.length); };
    var start = function(){ if (!reduceMotion && !timer) timer = setInterval(next, 6000); };
    var stop = function(){ if (timer) { clearInterval(timer); timer = null; } };
    dots.forEach(function(dot, i){
      dot.addEventListener('click', function(){ show(i); stop(); start(); });
    });
    carousel.addEventListener('mouseenter', stop);
    carousel.addEventListener('mouseleave', start);
    carousel.addEventListener('focusin', stop);
    carousel.addEventListener('focusout', start);
    start();
  }
})();
</script>
</body>
</html>`
}

// Cycles by index (icons[i % icons.length]) so it never throws if an admin
// changes how many feature items there are — see the file-level comment on
// what's admin-editable. With the default 6 items, order matches FEATURES
// exactly and each icon reads as its own service, not a generic set.
// "Limpeza a seco" uses the real textile-care dry-clean symbol (a plain
// circle), not an invented one.
function featureIcon(i) {
  const icons = [
    '<circle cx="8" cy="14" r="5"/><circle cx="15" cy="10" r="5"/>', // self-service: coins
    '<path d="M6 21l2-5 7-7a2.12 2.12 0 0 1 3 3l-7 7-5 2z"/><path d="M4 21h4"/><path d="M13 6l2-2"/>', // engomadoria: iron/press
    '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r=".5" fill="currentColor"/>', // limpeza a seco: the actual care-label dry-clean symbol
    '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 11h18M8 11v8M13 11v8"/>', // lavagem de tapetes: a rug's woven panels
    '<path d="M3 9h13l3 4v5h-2"/><path d="M3 9V6h10v3"/><circle cx="7.5" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>', // recolha e entrega: delivery van
    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>', // enquanto espera: clock
  ]
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[i % icons.length]}</svg>`
}

export function renderRobotsTxt() {
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nSitemap: ${SITE_URL}/sitemap.xml\n`
}

export function renderSitemapXml() {
  const today = new Date().toISOString().slice(0, 10)
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
`
}

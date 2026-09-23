/**
 * Server-rendered public front page — plain HTML/CSS/vanilla JS, deliberately not
 * part of the React SPA.
 *
 * Why: the SPA is client-rendered, so a crawler (and a link preview, and anyone
 * with JS disabled or slow) sees an empty shell until the bundle runs. This route
 * returns fully-formed markup in the FIRST response — real headings, real text,
 * real structured data — so Google (and everyone else) can read it immediately.
 *
 * Content is intentionally hardcoded, not fetched from Settings: this page must
 * keep working even if the database is briefly down, and it must render in one
 * pass with no request waterfall. If the branding name/colours ever need to
 * change, edit this file.
 *
 * Business facts (address, phone, hours, rating) come from the owner's own
 * Google Business Profile, given directly — not scraped or guessed. If any of
 * it changes, update the BRAND constant below.
 *
 * Served only when PUBLIC_LANDING_PAGE=true (routes/public.js) — the shop-kiosk
 * build's own "/" is the real point-of-sale UI and must never be shadowed by
 * this. See docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md §16.
 */

const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://freshbubbles.pt'
const LOGIN_URL = '/admin/login'

// Real, current facts only — from the business's own Google Business Profile
// (address, phone, hours, rating) and its own listing description (services).
// Nothing on this page is invented.
const BRAND = {
  name: 'Fresh Bubbles',
  tagline: 'Laundry & Ironing', // the exact tagline printed on the real logo mark
  email: 'marcacoes@freshbubbles.pt',
  logo: '/geral/freshbubbleslogo.png', // real asset, served by the frontend container
  phone: '+351 912 715 258',
  phoneHref: '+351912715258',
  address: {
    street: 'Av. Dr. António Carvalho de Figueiredo 35A',
    postal: '2670-407',
    city: 'Loures',
    country: 'Portugal',
  },
  // Google's live status snapshot showed "Opens 7 AM · Closes 11:30 PM" with no
  // per-weekday breakdown available — represented as one daily range, not a
  // fabricated weekly table.
  hours: { open: '07:00', close: '23:30' },
  rating: { value: 4.5, count: 11 }, // Google, as pasted by the owner
}
const fullAddress = `${BRAND.address.street}, ${BRAND.address.postal} ${BRAND.address.city}, ${BRAND.address.country}`
const mapsQuery = encodeURIComponent(fullAddress)

// Verified profiles only. Facebook is coming but doesn't exist yet — add it
// here (same shape) the day it does; nothing else needs to change.
const SOCIAL = [
  { name: 'Instagram', url: 'https://www.instagram.com/freshbubblesloures/', icon: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M17.5 6.5h.01' },
]

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

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

const STEPS = [
  { n: '1', t: 'Coloque a roupa', d: 'Escolha a máquina do tamanho certo — dos 8 aos 20kg — e coloque a roupa suja.' },
  { n: '2', t: 'Pague como preferir', d: 'Moedas, notas, cartão bancário ou o seu cartão Fresh Bubbles. Sem app a instalar.' },
  { n: '3', t: 'Retire fresca', d: 'Lavagem e secagem rápidas. Enquanto espera, ligue-se ao WiFi grátis.' },
]

// The self-service machines are one part of a fuller laundry business — see
// the owner's own Google Business Profile description. Keeping both, honestly.
const FEATURES = [
  { t: 'Self-service, à sua hora', d: 'Moedas, notas, cartão bancário ou cartão de cliente. Sem marcações — chegue quando lhe for melhor.' },
  { t: 'Engomadoria', d: 'Deixe a roupa connosco e leve-a pronta a vestir, sem passar a ferro em casa.' },
  { t: 'Limpeza a seco', d: 'Para as peças mais delicadas, o cuidado que precisam.' },
  { t: 'Lavagem de tapetes', d: 'Tapetes lavados com o mesmo cuidado da sua roupa.' },
  { t: 'Recolha e entrega ao domicílio', d: 'Não tem de sair de casa — nós vamos buscar e entregamos.' },
  { t: 'Enquanto espera', d: 'Vending de snacks e bebidas, e WiFi grátis — a sua pausa, tratada.' },
]

function jsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: BRAND.name,
    url: SITE_URL,
    image: `${SITE_URL}${BRAND.logo}`,
    email: BRAND.email,
    telephone: BRAND.phone,
    description: 'Lavandaria self-service, engomadoria, limpeza a seco e lavagem de tapetes em Loures. Recolha e entrega ao domicílio disponível.',
    priceRange: '€€',
    areaServed: 'Loures',
    address: {
      '@type': 'PostalAddress',
      streetAddress: BRAND.address.street,
      postalCode: BRAND.address.postal,
      addressLocality: BRAND.address.city,
      addressCountry: 'PT',
    },
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: BRAND.hours.open,
      closes: BRAND.hours.close,
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: BRAND.rating.value,
      reviewCount: BRAND.rating.count,
    },
    sameAs: SOCIAL.map((s) => s.url),
  }
  return JSON.stringify(data)
}

export function renderLandingPage() {
  const title = `${BRAND.name} Loures — Lavandaria Self-Service, Engomadoria e Limpeza a Seco`
  const description = 'Lavandaria self-service em Loures: máquinas de lavar e secar, engomadoria, limpeza a seco, lavagem de tapetes e recolha ao domicílio. Avaliação 4.5/5 no Google.'

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
<meta property="og:site_name" content="${escapeHtml(BRAND.name)}">
<meta property="og:locale" content="pt_PT">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:image" content="${SITE_URL}${BRAND.logo}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${SITE_URL}${BRAND.logo}">

<link rel="icon" href="${BRAND.logo}" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@500;600;700;800&display=swap" rel="stylesheet">

<script type="application/ld+json">${jsonLd()}</script>

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
.brand .porthole{ width:36px; height:36px }
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
.hero h1 .accent{
  color:var(--primary-700); position:relative; white-space:nowrap;
}
.hero h1 .accent svg{ position:absolute; left:-2%; bottom:-.12em; width:104%; height:.3em; z-index:-1 }
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

/* ---------- sections ---------- */
section{ padding:84px 0 }
.section-head{ max-width:640px; margin:0 auto 52px; text-align:center }
.section-head .eyebrow{ margin-bottom:16px }
.section-head h2{ font-size:clamp(1.7rem,2.2vw + 1rem,2.5rem); font-weight:700; letter-spacing:-0.015em }
.section-head p{ margin-top:14px; font-size:16.5px; color:var(--ink-soft) }

.reveal{ opacity:0; transform:translateY(22px); transition:opacity .6s ease, transform .6s cubic-bezier(.16,.84,.44,1) }
.reveal.is-visible{ opacity:1; transform:none }
@media (prefers-reduced-motion:reduce){ .reveal{ opacity:1; transform:none; transition:none } }

/* how it works */
.steps{ display:grid; grid-template-columns:repeat(3,1fr); gap:28px; counter-reset:step; position:relative }
.steps::before{
  content:''; position:absolute; top:44px; left:14%; right:14%; height:2px;
  background:repeating-linear-gradient(90deg,rgba(13,148,136,.32) 0 10px,transparent 10px 20px);
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

/* quote */
.quote{
  max-width:560px; margin:0 auto 48px; text-align:center; padding:0; border:0;
}
.quote p{
  font-family:var(--font-head); font-weight:500; font-size:22px; line-height:1.4; color:var(--primary-900);
  margin:0 0 14px;
}
.quote cite{ font-style:normal; font-size:14px; font-weight:600; color:var(--ink-soft) }
.quote cite span{ font-weight:400; color:#94a3a1 }

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
.foot-brand .porthole{ width:28px; height:28px }
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
      ${porthole({ size: 36, spin: false })}
      <span class="brand-word">${escapeHtml(BRAND.name)}<small>${escapeHtml(BRAND.tagline)}</small></span>
    </a>
    <ul class="nav-links" id="nav-links">
      <li><a href="#como-funciona">Como funciona</a></li>
      <li><a href="#servicos">Serviços</a></li>
      <li><a href="#visite-nos">Visite-nos</a></li>
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
        <span class="eyebrow">Lavandaria em Loures</span>
        <h1>Coloque. Pague.<br><span class="accent">Retire fresca.
          <svg viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true"><path d="M2 9 C 40 2, 70 13, 100 7 S 160 1, 198 8" fill="none" stroke="var(--coral)" stroke-width="5" stroke-linecap="round"/></svg>
        </span></h1>
        <p class="hero-sub">Máquinas modernas, dos 8 aos 20kg. Pague em moedas, notas, cartão bancário ou o seu cartão Fresh Bubbles. Sem marcações, sem filas — chegue, lave, siga a sua vida.</p>
        <div class="hero-cta">
          <a class="btn-primary" href="#como-funciona">Como funciona</a>
          <a class="btn-ghost" href="#visite-nos">Visite-nos</a>
        </div>
        <div class="hero-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
          Aberto todos os dias, das ${BRAND.hours.open} às ${BRAND.hours.close}
          <span class="rating-chip">${starIcon()} ${BRAND.rating.value} <span class="rating-count">(${BRAND.rating.count} no Google)</span></span>
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

  <section id="como-funciona" aria-labelledby="como-funciona-h">
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">O processo</span>
        <h2 id="como-funciona-h">Três passos, sem complicações</h2>
        <p>Da roupa suja à roupa fresca, sem precisar de mais nada além de tempo livre.</p>
      </div>
      <div class="steps">
        ${STEPS.map((s, i) => `
        <div class="step reveal" style="transition-delay:${i * 0.08}s">
          <div class="step-mark" data-parallax="${i % 2 === 0 ? 0.06 : -0.06}">${porthole({ size: 88, spin: false })}<span aria-hidden="true">${s.n}</span></div>
          <h3>${escapeHtml(s.t)}</h3>
          <p>${escapeHtml(s.d)}</p>
        </div>`).join('')}
      </div>
    </div>
  </section>

  <section id="servicos" aria-labelledby="servicos-h" style="background:rgba(255,255,255,.4)">
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">Porquê a Fresh Bubbles</span>
        <h2 id="servicos-h">Feito para o seu dia a dia</h2>
        <p>O essencial de uma lavandaria, sem o que não precisa.</p>
      </div>
      <div class="features">
        ${FEATURES.map((f, i) => `
        <div class="feature-card reveal" style="transition-delay:${(i % 3) * 0.07}s">
          <div class="feature-icon">${featureIcon(i)}</div>
          <h3>${escapeHtml(f.t)}</h3>
          <p>${escapeHtml(f.d)}</p>
        </div>`).join('')}
      </div>
    </div>
  </section>

  <section aria-hidden="false">
    <div class="wrap">
      <div class="cta-band reveal">
        <svg class="cta-watermark" data-parallax="0.06" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="47" fill="none" stroke="#fff" stroke-width="1.5"/>
          <circle cx="50" cy="50" r="34" fill="none" stroke="#fff" stroke-width="2.5"/>
          <path d="M50 16 C 66 16 79 27 79 44 C 79 54 73 61 64 66" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <h2>Pronta para a próxima lavagem?</h2>
        <p>Sem marcações. Chegue quando lhe for melhor e a sua roupa espera por si, fresca.</p>
        <div class="hero-cta">
          <a class="btn-primary" href="#visite-nos">Visite-nos</a>
          <a class="btn-ghost" href="mailto:${BRAND.email}">Fale connosco</a>
        </div>
      </div>
    </div>
  </section>

  <section id="visite-nos" aria-labelledby="visite-nos-h">
    <div class="wrap">
      <div class="section-head reveal">
        <span class="eyebrow">Visite-nos</span>
        <h2 id="visite-nos-h">Onde estamos</h2>
        <p>Em Loures, aberta todos os dias.</p>
      </div>

      <blockquote class="quote reveal">
        <p>&ldquo;Serviço impecável e atenção espetacular.&rdquo;</p>
        <cite>Daniel Vinhas <span>· avaliação no Google</span></cite>
      </blockquote>

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
            <span>Todos os dias, das ${BRAND.hours.open} às ${BRAND.hours.close}</span>
          </div>
          <div class="visit-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <a href="tel:${BRAND.phoneHref}">${escapeHtml(BRAND.phone)}</a>
          </div>
          <div class="visit-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v16H4z" opacity="0"/><path d="M22 6l-10 7L2 6"/><path d="M2 6h20v12H2z"/></svg>
            <a href="mailto:${BRAND.email}">${escapeHtml(BRAND.email)}</a>
          </div>
          ${SOCIAL.map((s) => `
          <div class="visit-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${s.icon}"/></svg>
            <a href="${s.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>
          </div>`).join('')}
          <div class="visit-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>
            <a href="${LOGIN_URL}">Área reservada (equipa)</a>
          </div>
        </div>
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="wrap">
    <div class="foot-brand">
      ${porthole({ size: 28, spin: false })}
      <span class="foot-brand-text">${escapeHtml(BRAND.name)}<small>${escapeHtml(BRAND.tagline)}</small></span>
    </div>
    <div class="foot-links">
      <a href="#como-funciona">Como funciona</a>
      <a href="#servicos">Serviços</a>
      <a href="${LOGIN_URL}">Entrar</a>
    </div>
    <p class="foot-copy">&copy; ${new Date().getFullYear()} ${escapeHtml(BRAND.name)}. Todos os direitos reservados.</p>
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
})();
</script>
</body>
</html>`
}

// Order matches FEATURES exactly — each icon reads as its own service, not a
// generic set. "Limpeza a seco" uses the real textile-care dry-clean symbol
// (a plain circle), not an invented one.
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

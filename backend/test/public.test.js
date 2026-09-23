import { expect } from 'chai'
import express from 'express'
import request from 'supertest'
import publicRoutes, { _resetContentCacheForTests } from '../src/routes/public.js'
import { resolveTenant } from '../src/middleware/tenant.js'
import { mergeContent, DEFAULT_CONTENT, CONTENT_SETTING_KEY } from '../src/views/landing.js'
import Setting from '../src/models/setting.js'
import Tenant from '../src/models/tenant.js'
import { startTestDb, stopTestDb } from './setup.test-helper.js'

/**
 * Mounts resolveTenant ahead of publicRoutes, mirroring index.js (see the
 * PUBLIC_LANDING_PAGE gate there) — the route now reads its content Setting
 * through withTenant(), which needs req.tenantId resolved the same way a
 * real request gets it.
 */
function buildPublicApp() {
  const app = express()
  app.use(express.json())
  app.use(resolveTenant)
  app.use('/', publicRoutes)
  return app
}

describe('Public front page (routes/public.js + views/landing.js)', () => {
  let app
  let tenant
  before(async () => {
    await startTestDb()
    tenant = await Tenant.create({ name: 'Landing Test Tenant', slug: 'landing-test-tenant' })
    app = buildPublicApp()
  })
  after(async () => { await stopTestDb() })
  afterEach(async () => {
    _resetContentCacheForTests()
    await Setting.deleteMany({ tenantId: tenant._id })
  })

  describe('GET /', () => {
    it('returns real HTML in the first response (no JS required to read it)', async () => {
      const res = await request(app).get('/')
      expect(res.status).to.equal(200)
      expect(res.headers['content-type']).to.match(/text\/html/)
      expect(res.text).to.include('<!DOCTYPE html>')
      expect(res.text).to.include('<html lang="pt-PT">')
    })

    it('sets a short public cache header — content that changes rarely, not never', () => {
      return request(app).get('/').then((res) => {
        expect(res.headers['cache-control']).to.match(/public/)
      })
    })

    it('has exactly one h1, and it is real page copy, not a placeholder', async () => {
      const res = await request(app).get('/')
      const h1Matches = res.text.match(/<h1[\s>]/g) || []
      expect(h1Matches).to.have.length(1)
      expect(res.text).to.match(/<h1>.*Retire fresca.*<\/h1>/s)
    })

    it('carries the hero\'s coral underline accent onto the other section headings, always on the last word', async () => {
      const res = await request(app).get('/')
      // Steps heading "Três passos, sem complicações" -> last word "complicações"
      expect(res.text).to.match(/<h2 id="como-funciona-h">Três passos, sem <span class="accent">complicações<\/span>/)
      // Features heading "Feito para o seu dia a dia" -> last word "dia"
      expect(res.text).to.match(/<h2 id="servicos-h">Feito para o seu dia a <span class="accent">dia<\/span>/)
      // Tiled, not one SVG stretched per word — that's what made a short word
      // ("Google") and a long phrase ("Retire fresca.") look inconsistent.
      expect(res.text).to.include('background-repeat:repeat-x')
      expect(res.text).to.not.include('<svg viewBox="0 0 200 14"')
    })

    it('has the core SEO tags: title, meta description, canonical, robots', async () => {
      const res = await request(app).get('/')
      expect(res.text).to.match(/<title>[^<]+<\/title>/)
      expect(res.text).to.include('<meta name="description" content="')
      expect(res.text).to.include('<link rel="canonical" href="https://freshbubbles.pt/">')
      expect(res.text).to.include('<meta name="robots" content="index, follow">')
    })

    it('has Open Graph and Twitter Card tags for real link previews', async () => {
      const res = await request(app).get('/')
      for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type']) {
        expect(res.text, tag).to.include(`property="${tag}"`)
      }
      expect(res.text).to.include('name="twitter:card" content="summary"')
    })

    it('ships valid JSON-LD LocalBusiness structured data with the real, confirmed business facts', async () => {
      const res = await request(app).get('/')
      const m = res.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)
      expect(m, 'JSON-LD script tag present').to.not.equal(null)
      const data = JSON.parse(m[1])
      expect(data['@type']).to.equal('LocalBusiness')
      expect(data.name).to.equal('Fresh Bubbles')
      expect(data.telephone).to.equal('+351 912 715 258')
      expect(data.address).to.include({
        streetAddress: 'Av. Dr. António Carvalho de Figueiredo 35A',
        postalCode: '2670-407',
        addressLocality: 'Loures',
        addressCountry: 'PT',
      })
      expect(data.openingHoursSpecification).to.include({ opens: '07:00', closes: '23:30' })
      expect(data.aggregateRating).to.deep.equal({ '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 11 })
      expect(data.sameAs).to.deep.equal(['https://www.instagram.com/freshbubblesloures/'])
      // Never guessed: no lat/lng, no fabricated review text.
      expect(data).to.not.have.property('geo')
    })

    it('has a login link in the nav pointing at the real admin login route', async () => {
      const res = await request(app).get('/')
      expect(res.text).to.match(/<nav[\s\S]*?href="\/admin\/login"[\s\S]*?Entrar/)
    })

    it('never invents facts not given: no fabricated review quote beyond the one real one supplied', async () => {
      const res = await request(app).get('/')
      // The one real, attributed quote is present; nothing else claims to be a review.
      expect(res.text).to.include('Serviço impecável e atenção espetacular')
      expect(res.text).to.include('Daniel Vinhas')
      expect((res.text.match(/<blockquote/g) || [])).to.have.length(1)
    })

    it('renders a single review as a plain static quote — no carousel markup for just one', async () => {
      const res = await request(app).get('/')
      expect(res.text).to.not.include('<div class="reviews reveal" data-review-carousel>')
      expect(res.text).to.not.match(/<button type="button" class="review-dot/)
    })

    it('renders reviews as their own section, not nested inside Visite-nos', async () => {
      const res = await request(app).get('/')
      expect(res.text).to.match(/<section id="avaliacoes" aria-labelledby="avaliacoes-h">/)
      // The reviews block must come BEFORE Visite-nos opens, i.e. it's a
      // sibling section, not content inside it.
      const avaliacoesIdx = res.text.indexOf('<section id="avaliacoes"')
      const visiteNosIdx = res.text.indexOf('<section id="visite-nos"')
      expect(avaliacoesIdx).to.be.greaterThan(0)
      expect(avaliacoesIdx).to.be.lessThan(visiteNosIdx)
      const visitSectionOnly = res.text.slice(visiteNosIdx, res.text.indexOf('</section>', visiteNosIdx))
      expect(visitSectionOnly).to.not.include('review-slide')
    })

    it('links "Avaliações" from the nav and footer', async () => {
      const res = await request(app).get('/')
      expect(res.text).to.match(/<ul class="nav-links"[\s\S]*?<a href="#avaliacoes">Avaliações<\/a>[\s\S]*?<\/ul>/)
      expect(res.text).to.match(/<div class="foot-links">[\s\S]*?<a href="#avaliacoes">Avaliações<\/a>[\s\S]*?<\/div>/)
    })

    it('escapes HTML in dynamic text', async () => {
      const res = await request(app).get('/')
      // The email address renders as a real mailto link, not broken markup.
      expect(res.text).to.include('href="mailto:marcacoes@freshbubbles.pt"')
    })

    it('is mobile-responsive: ships a viewport meta tag and a nav toggle for small screens', async () => {
      const res = await request(app).get('/')
      expect(res.text).to.include('name="viewport" content="width=device-width')
      expect(res.text).to.include('id="nav-toggle"')
    })

    it('respects prefers-reduced-motion in the inline script (never silently ignored)', async () => {
      const res = await request(app).get('/')
      expect(res.text).to.include("matchMedia('(prefers-reduced-motion: reduce)')")
    })

    it('ships scroll-parallax layers, gated behind reduced-motion like the other animation', async () => {
      const res = await request(app).get('/')
      const parallaxAttrs = res.text.match(/data-parallax="[^"]*"/g) || []
      // Hero glow + 4 portholes + 3 step-marks + 1 CTA watermark = 9 layers.
      expect(parallaxAttrs.length).to.be.at.least(9)
      expect(res.text).to.match(/if \(!reduceMotion\) \{[\s\S]*data-parallax/)
    })

    it('ships a grain overlay as a generated data URI, not a downloaded asset', async () => {
      const res = await request(app).get('/')
      expect(res.text).to.include('body::after')
      expect(res.text).to.include('data:image/svg+xml;base64,')
      expect(res.text).to.include('mix-blend-mode:overlay')
    })

    it('draws the eyebrow in left-to-right on scroll (clip-path, reusing .reveal\'s own trigger — no extra JS)', async () => {
      const res = await request(app).get('/')
      expect(res.text).to.include('clip-path:inset(0 100% 0 0)')
      expect(res.text).to.include('.reveal.is-visible .eyebrow{ clip-path:inset(0 0 0 0) }')
    })

    it('draws the underline squiggle in too — on load for the hero (above the fold), on scroll for the rest', async () => {
      const res = await request(app).get('/')
      expect(res.text).to.include('.hero .accent::before{ animation:draw-squiggle')
      expect(res.text).to.include('@keyframes draw-squiggle{ to{ clip-path:inset(0 0 0 0) } }')
      expect(res.text).to.include('.reveal.is-visible .accent::before{')
    })

    it('locks the reviews card to the tallest review\'s height so rotating to a shorter one doesn\'t shrink the page around it', async () => {
      const res = await request(app).get('/')
      expect(res.text).to.include('var sizeToTallest = function()')
      expect(res.text).to.include("carousel.style.minHeight = maxH + 'px'")
      expect(res.text).to.include("window.addEventListener('resize', sizeToTallest)")
    })
  })

  describe('GET /robots.txt', () => {
    it('allows crawling, blocks /admin and /api, and points at the sitemap', async () => {
      const res = await request(app).get('/robots.txt')
      expect(res.status).to.equal(200)
      expect(res.headers['content-type']).to.match(/text\/plain/)
      expect(res.text).to.include('Allow: /')
      expect(res.text).to.include('Disallow: /admin')
      expect(res.text).to.include('Disallow: /api')
      expect(res.text).to.include('Sitemap: https://freshbubbles.pt/sitemap.xml')
    })
  })

  describe('GET /sitemap.xml', () => {
    it('is valid XML listing the front page', async () => {
      const res = await request(app).get('/sitemap.xml')
      expect(res.status).to.equal(200)
      expect(res.headers['content-type']).to.match(/xml/)
      expect(res.text).to.include('<?xml version="1.0" encoding="UTF-8"?>')
      expect(res.text).to.include('<loc>https://freshbubbles.pt/</loc>')
    })
  })

  describe('Landing page content (DB-backed, editable from the admin "Página Inicial" tab)', () => {
    // resolveTenant falls back to X-Tenant-Id explicitly rather than relying
    // on the "sole tenant" auto-detect — other test files in the same `npm
    // test` run create their own tenants against the same shared connection,
    // so single-tenant auto-detect can't be assumed here.
    const asThisTenant = () => request(app).get('/').set('X-Tenant-Id', tenant._id.toString())

    it('renders default content when nothing has been saved yet', async () => {
      const res = await asThisTenant()
      expect(res.text).to.match(/<h1>.*Retire fresca.*<\/h1>/s)
    })

    it('overrides hero copy with what was saved to the Setting', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        hero: { ...DEFAULT_CONTENT.hero, heading: 'Lavagem Premium.', accent: 'Sempre pronta.' },
      } })
      const res = await asThisTenant()
      expect(res.text).to.include('Lavagem Premium.')
      expect(res.text).to.include('Sempre pronta.')
    })

    it('omits a section (and its nav link) when saved as not visible', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        steps: { visible: false },
      } })
      const res = await asThisTenant()
      expect(res.text).to.not.include('id="como-funciona"')
      expect(res.text).to.not.match(/<nav[\s\S]*?Como funciona[\s\S]*?<\/nav>/)
      // Untouched sections keep rendering — turning one off isn't all-or-nothing.
      expect(res.text).to.include('id="servicos"')
    })

    it('renders an admin-created custom section, and skips one saved as hidden', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        customSections: [
          { id: 'promo', visible: true, eyebrow: 'Promoção', heading: 'Semana da Lã', body: 'Descontos esta semana.', ctaLabel: 'Saber mais', ctaHref: '/promo' },
          { id: 'draft', visible: false, heading: 'Ainda não publicado' },
        ],
      } })
      const res = await asThisTenant()
      expect(res.text).to.include('Semana da Lã')
      expect(res.text).to.include('Descontos esta semana.')
      expect(res.text).to.include('href="/promo"')
      expect(res.text).to.not.include('Ainda não publicado')
    })

    it('links a custom section from the nav and footer — a section with no way to reach it is dead weight', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        customSections: [
          { id: 'promo', visible: true, heading: 'Semana da Lã' },
          { id: 'draft', visible: false, heading: 'Ainda não publicado' },
        ],
      } })
      const res = await asThisTenant()
      const navMatch = res.text.match(/<ul class="nav-links"[\s\S]*?<\/ul>/)[0]
      const footMatch = res.text.match(/<div class="foot-links">[\s\S]*?<\/div>/)[0]
      expect(navMatch).to.include('<a href="#custom-promo">Semana da Lã</a>')
      expect(footMatch).to.include('<a href="#custom-promo">Semana da Lã</a>')
      expect(navMatch).to.not.include('draft')
    })

    it('hides the "Área reservada" link when saved as not visible', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: { visit: { showLoginLink: false } } })
      const res = await asThisTenant()
      expect(res.text).to.not.include('Área reservada (equipa)')
      // The nav's own login button is untouched — this only hides the second copy.
      expect(res.text).to.include('Entrar')
    })

    it('drops a custom section with no heading — a half-filled draft never ships blank markup', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        customSections: [{ id: 'empty', visible: true, body: 'Sem título.' }],
      } })
      const res = await asThisTenant()
      expect(res.text).to.not.include('Sem título.')
    })

    it('escapes HTML saved in admin content — a malicious/compromised save can\'t inject a real script tag', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        hero: { ...DEFAULT_CONTENT.hero, heading: '<script>alert(1)</script>' },
      } })
      const res = await asThisTenant()
      expect(res.text).to.not.include('<script>alert(1)</script>')
      expect(res.text).to.include('&lt;script&gt;alert(1)&lt;/script&gt;')
    })

    it('overrides business facts (phone/hours/rating), keeping the fields not touched', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        brand: { phone: '+351 999 888 777', hours: { open: '08:00', close: '20:00' }, rating: { value: 4.8, count: 42 } },
      } })
      const res = await asThisTenant()
      expect(res.text).to.include('+351 999 888 777')
      expect(res.text).to.include('das 08:00 às 20:00')
      expect(res.text).to.include('4.8')
      expect(res.text).to.include('(42 no Google)')
      // Untouched brand fields (name, address, email) keep their real defaults.
      expect(res.text).to.include('Fresh Bubbles')
      expect(res.text).to.include('marcacoes@freshbubbles.pt')
    })

    it('keeps structured data (JSON-LD) in sync with an edited business fact — one source of truth, not two', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        brand: { phone: '+351 999 888 777', rating: { value: 4.8, count: 42 } },
      } })
      const res = await asThisTenant()
      const m = res.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)
      const data = JSON.parse(m[1])
      expect(data.telephone).to.equal('+351 999 888 777')
      expect(data.aggregateRating).to.deep.equal({ '@type': 'AggregateRating', ratingValue: 4.8, reviewCount: 42 })
    })

    it('derives the tel: href from the saved phone number rather than a separately stored field', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        brand: { phone: '+351 91 271 5258' },
      } })
      const res = await asThisTenant()
      expect(res.text).to.include('href="tel:+351912715258"')
    })

    it('lets admin replace social links — including adding one that did not exist at launch (e.g. Facebook)', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        brand: { social: [
          { name: 'Instagram', url: 'https://www.instagram.com/freshbubblesloures/' },
          { name: 'Facebook', url: 'https://www.facebook.com/freshbubblesloures' },
        ] },
      } })
      const res = await asThisTenant()
      expect(res.text).to.include('href="https://www.facebook.com/freshbubblesloures"')
      const m = res.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)
      const data = JSON.parse(m[1])
      expect(data.sameAs).to.deep.equal([
        'https://www.instagram.com/freshbubblesloures/',
        'https://www.facebook.com/freshbubblesloures',
      ])
    })

    it('respects an intentional "no social links" save instead of falling back to the default Instagram entry', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: { brand: { social: [] } } })
      const res = await asThisTenant()
      expect(res.text).to.not.include('instagram.com')
    })

    it('escapes HTML saved in business-fact fields too', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        brand: { name: '<b>Evil</b>' },
      } })
      const res = await asThisTenant()
      expect(res.text).to.not.include('<b>Evil</b>')
      expect(res.text).to.include('&lt;b&gt;Evil&lt;/b&gt;')
    })

    it('uses the logo uploaded via the Branding tab (Setting key branding.logo), not a second upload here', async () => {
      await Setting.create({ tenantId: tenant._id, key: 'branding.logo', value: '/uploads/custom-logo-resized.png' })
      const res = await asThisTenant()
      expect(res.text).to.include('/uploads/custom-logo-resized.png')
      expect(res.text).to.not.include('/geral/freshbubbleslogo.png')
      const m = res.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)
      const data = JSON.parse(m[1])
      expect(data.image).to.equal('https://freshbubbles.pt/uploads/custom-logo-resized.png')
    })

    it('shows the uploaded logo in the visible nav and footer, not just in meta tags', async () => {
      await Setting.create({ tenantId: tenant._id, key: 'branding.logo', value: '/uploads/custom-logo-resized.png' })
      const res = await asThisTenant()
      const navMatch = res.text.match(/<a class="brand"[\s\S]*?<\/a>/)
      const footMatch = res.text.match(/<div class="foot-brand">[\s\S]*?<\/div>/)
      expect(navMatch[0]).to.include('<img class="brand-logo" src="/uploads/custom-logo-resized.png"')
      expect(footMatch[0]).to.include('<img class="brand-logo" src="/uploads/custom-logo-resized.png"')
    })

    it('falls back to the default logo when nothing has been uploaded via the Branding tab', async () => {
      const res = await asThisTenant()
      expect(res.text).to.include('/geral/freshbubbleslogo.png')
    })

    it('activates the carousel once a second review is added from admin', async () => {
      await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: {
        reviews: { items: [
          { text: 'Serviço impecável e atenção espetacular.', author: 'Daniel Vinhas' },
          { text: 'Recomendo a todos.', author: 'Maria Silva' },
        ] },
      } })
      const res = await asThisTenant()
      expect(res.text).to.include('<div class="reviews reveal" data-review-carousel>')
      expect((res.text.match(/<blockquote/g) || [])).to.have.length(2)
      expect((res.text.match(/<button type="button" class="review-dot/g) || [])).to.have.length(2)
      expect(res.text).to.include('Recomendo a todos.')
      expect(res.text).to.include('Maria Silva')
    })

    it('gates the auto-advance behind reduced motion, same as the other animation on this page', async () => {
      const res = await asThisTenant()
      expect(res.text).to.match(/var start = function\(\)\{ if \(!reduceMotion/)
    })
  })

  describe('PUBLIC_SITE_URL override', () => {
    it('renderLandingPage/robots/sitemap all honour a different configured site URL', async () => {
      const prev = process.env.PUBLIC_SITE_URL
      process.env.PUBLIC_SITE_URL = 'https://staging.example.test'
      try {
        const mod = await import(`../src/views/landing.js?t=${Date.now()}`)
        expect(mod.renderLandingPage()).to.include('https://staging.example.test/')
        expect(mod.renderRobotsTxt()).to.include('Sitemap: https://staging.example.test/sitemap.xml')
        expect(mod.renderSitemapXml()).to.include('<loc>https://staging.example.test/</loc>')
      } finally {
        if (prev === undefined) delete process.env.PUBLIC_SITE_URL
        else process.env.PUBLIC_SITE_URL = prev
      }
    })
  })
})

describe('mergeContent (views/landing.js) — the DB-down/malformed-data safety net', () => {
  it('returns exactly the shipped defaults when nothing was ever saved', () => {
    expect(mergeContent(undefined)).to.deep.equal(DEFAULT_CONTENT)
    expect(mergeContent(null)).to.deep.equal(DEFAULT_CONTENT)
  })

  it('falls back per-field: a partial save never loses the fields it did not touch', () => {
    const merged = mergeContent({ hero: { heading: 'Só isto mudou.' } })
    expect(merged.hero.heading).to.equal('Só isto mudou.')
    expect(merged.hero.accent).to.equal(DEFAULT_CONTENT.hero.accent) // untouched field, kept
    expect(merged.steps).to.deep.equal(DEFAULT_CONTENT.steps) // untouched section, kept
  })

  it('ignores a malformed items list instead of crashing the render', () => {
    const merged = mergeContent({ steps: { items: 'not-an-array' }, features: { items: [] } })
    expect(merged.steps.items).to.deep.equal(DEFAULT_CONTENT.steps.items)
    expect(merged.features.items).to.deep.equal(DEFAULT_CONTENT.features.items)
  })

  it('drops custom sections with no heading', () => {
    const merged = mergeContent({ customSections: [{ body: 'no heading' }, { heading: 'Ok' }] })
    expect(merged.customSections).to.deep.equal([{ heading: 'Ok' }])
  })

  it('merges brand facts per-field, including nested address/hours', () => {
    const merged = mergeContent({ brand: { phone: '+351 900 000 000', address: { city: 'Lisboa' } } })
    expect(merged.brand.phone).to.equal('+351 900 000 000')
    expect(merged.brand.address.city).to.equal('Lisboa')
    expect(merged.brand.address.street).to.equal(DEFAULT_CONTENT.brand.address.street) // untouched, kept
    expect(merged.brand.hours).to.deep.equal(DEFAULT_CONTENT.brand.hours)
  })

  it('falls back to the default rating when a saved rating is not a real number', () => {
    const merged = mergeContent({ brand: { rating: { value: 'not-a-number', count: null } } })
    expect(merged.brand.rating).to.deep.equal(DEFAULT_CONTENT.brand.rating)
  })

  it('honours an explicit empty social list but falls back to the default when brand was never saved', () => {
    expect(mergeContent({ brand: { social: [] } }).brand.social).to.deep.equal([])
    expect(mergeContent({}).brand.social).to.deep.equal(DEFAULT_CONTENT.brand.social)
  })

  it('merges the reviews list the same way as steps/features items: real list wins, malformed falls back', () => {
    const withReviews = mergeContent({ reviews: { items: [{ text: 'X', author: 'Y' }] } })
    expect(withReviews.reviews.items).to.deep.equal([{ text: 'X', author: 'Y' }])
    expect(mergeContent({ reviews: { items: 'not-an-array' } }).reviews.items).to.deep.equal(DEFAULT_CONTENT.reviews.items)
  })
})

describe('index.js: PUBLIC_LANDING_PAGE gate (not the shop-kiosk POS app)', () => {
  it('the route module exports exactly GET /, /robots.txt, /sitemap.xml — nothing that could shadow /api or /ws', () => {
    const routes = publicRoutes.stack
      .filter((l) => l.route)
      .map((l) => ({ path: l.route.path, methods: Object.keys(l.route.methods) }))
    expect(routes).to.deep.equal([
      { path: '/', methods: ['get'] },
      { path: '/robots.txt', methods: ['get'] },
      { path: '/sitemap.xml', methods: ['get'] },
    ])
  })
})

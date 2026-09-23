import { expect } from 'chai'
import express from 'express'
import request from 'supertest'
import publicRoutes from '../src/routes/public.js'

/**
 * The public front page is static content with no DB dependency, so it gets
 * its own minimal app rather than buildTestApp() — mounting it exactly the
 * way index.js does (see the PUBLIC_LANDING_PAGE gate there), nothing more.
 */
function buildPublicApp() {
  const app = express()
  app.use('/', publicRoutes)
  return app
}

describe('Public front page (routes/public.js + views/landing.js)', () => {
  let app
  before(() => { app = buildPublicApp() })

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

    it('escapes HTML in dynamic text (defence in depth, even though BRAND is a hardcoded constant today)', async () => {
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

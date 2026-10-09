import { expect } from 'chai'
import express from 'express'
import request from 'supertest'
import publicRoutes, { _resetContentCacheForTests } from '../src/routes/public.js'
import { resolveTenant, resetSoleTenantCache } from '../src/middleware/tenant.js'
import { renderLandingPage, renderSitemapXml, mergeContent, DEFAULT_CONTENT, CONTENT_SETTING_KEY } from '../src/views/landing.js'
import { UI, LANGS, TRANSLATED_LANGS } from '../src/views/landingI18n.js'
import { translateBatch, translatorEnabled } from '../src/services/translator.js'
import { collectStrings, applyTranslations, translateLanding, getTranslations, getStatus, numbersIn, guardNumbers, TRANSLATIONS_KEY } from '../src/services/landingTranslate.js'
import Setting from '../src/models/setting.js'
import Tenant from '../src/models/tenant.js'
import { startTestDb, stopTestDb } from './setup.test-helper.js'

/** A LibreTranslate that "translates" by tagging: easy to see what was and was not sent. */
function fakeLibre({ fail = false, badLength = false } = {}) {
  const s = { requests: [] }
  s.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body)
    s.requests.push({ url, body })
    if (fail) return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) }
    const out = body.q.map((t) => `[${body.target}] ${t}`)
    return { ok: true, status: 200, json: async () => ({ translatedText: badLength ? out.slice(1) : out }) }
  }
  return s
}

describe('Machine translation client (services/translator.js)', () => {
  it('translates in order, sends empty strings nowhere, and splits big jobs into batches', async () => {
    const libre = fakeLibre()
    const input = ['Olá', '', 'Adeus', '   ', 'Bom dia']
    const out = await translateBatch(input, { target: 'en', url: 'http://lt.test', fetchImpl: libre.fetch, chunkSize: 2 })
    expect(out).to.deep.equal(['[en] Olá', '', '[en] Adeus', '   ', '[en] Bom dia'])
    expect(libre.requests).to.have.length(2)
    expect(libre.requests[0].body).to.include({ source: 'pt', target: 'en', format: 'text' })
    expect(libre.requests[0].url).to.equal('http://lt.test/translate')
  })

  it('fails loudly (never returns half a translation) when the service errors or answers wrongly', async () => {
    for (const libre of [fakeLibre({ fail: true }), fakeLibre({ badLength: true })]) {
      let err
      try { await translateBatch(['a', 'b'], { target: 'fr', url: 'http://lt.test', fetchImpl: libre.fetch }) } catch (e) { err = e }
      expect(err, 'should have thrown').to.be.an('error')
    }
  })

  it('is off unless TRANSLATE_URL is set', async () => {
    const saved = process.env.TRANSLATE_URL
    delete process.env.TRANSLATE_URL
    expect(translatorEnabled()).to.equal(false)
    let err
    try { await translateBatch(['a'], { target: 'en' }) } catch (e) { err = e }
    expect(err.message).to.match(/not configured/)
    if (saved !== undefined) process.env.TRANSLATE_URL = saved
  })
})

describe('Which text gets translated (services/landingTranslate.js)', () => {
  const content = mergeContent({})

  it('takes the admin-written text only: not the business facts, names, links or switches', () => {
    const { strings } = collectStrings(content)
    expect(strings).to.include(content.hero.heading)
    expect(strings).to.include(content.steps.items[0].t)
    expect(strings).to.include(content.features.items[0].d)
    expect(strings).to.include(content.reviews.items[0].text)
    for (const never of [content.brand.name, content.brand.phone, content.brand.email, content.brand.address.street, content.reviews.items[0].author, content.brand.tagline]) {
      expect(strings, never).to.not.include(never)
    }
  })

  it('puts translations back at the right places without touching the original', () => {
    const before = JSON.stringify(content)
    const { paths, strings } = collectStrings(content)
    const out = applyTranslations(content, paths, strings.map((s) => `EN:${s}`))
    expect(out.hero.heading).to.equal(`EN:${content.hero.heading}`)
    expect(out.features.items[2].t).to.equal(`EN:${content.features.items[2].t}`)
    expect(out.reviews.items[0].author).to.equal(content.reviews.items[0].author) // a person's name stays
    expect(out.brand).to.deep.equal(content.brand)
    expect(out.steps.visible).to.equal(true)
    expect(JSON.stringify(content)).to.equal(before)
  })

  it('also covers sections the admin added', () => {
    const c = mergeContent({ customSections: [{ id: 'x1', heading: 'Promoção', body: 'Leve 2, pague 1', ctaLabel: 'Ver', ctaHref: '/x' }] })
    const { strings } = collectStrings(c)
    expect(strings).to.include.members(['Promoção', 'Leve 2, pague 1', 'Ver'])
    expect(strings).to.not.include('/x')
    expect(strings).to.not.include('x1')
  })
})

describe('The page in other languages (views/landing.js)', () => {
  it('Portuguese is unchanged and shows no switcher while it is the only language', () => {
    const html = renderLandingPage({})
    expect(html).to.include('<html lang="pt-PT">')
    expect(html).to.include('Como funciona')
    expect(html).to.not.include('class="lang-dd"')
    expect(html).to.not.include('hreflang')
  })

  it('fixed labels, title, structured data and hours follow the language', () => {
    const html = renderLandingPage({}, { lang: 'en', available: ['pt', 'en', 'fr'] })
    expect(html).to.include('<html lang="en">')
    expect(html).to.include('How it works')
    expect(html).to.include('Open every day, 07:00 to 23:30')
    expect(html).to.include('Self-Service Laundrette')
    expect(html).to.include('Self-service laundrette, ironing, dry cleaning')
    expect(html).to.include('<link rel="canonical" href="https://freshbubbles.pt/en">')
    expect(html).to.not.include('Saltar para o conteúdo')
    expect(html).to.not.include('Aberto todos os dias')
  })

  it('links every available language to the others, and marks the current one', () => {
    const html = renderLandingPage({}, { lang: 'fr', available: ['pt', 'en', 'fr'] })
    expect(html).to.include('<link rel="alternate" hreflang="pt-PT" href="https://freshbubbles.pt/">')
    expect(html).to.include('<link rel="alternate" hreflang="en" href="https://freshbubbles.pt/en">')
    expect(html).to.include('<link rel="alternate" hreflang="x-default" href="https://freshbubbles.pt/">')
    expect(html).to.not.include('hreflang="de"') // no German page yet
    expect(html).to.include('<details class="lang-dd">')
    expect(html).to.match(/<a href="\/fr"[^>]*aria-current="true"[^>]*>Français<\/a>/)
    expect(html).to.match(/<a href="\/en"[^>]*>English<\/a>/)
    expect(html).to.match(/<summary[^>]*>[\s\S]*<span>FR<\/span>/)
  })

  it('an unknown language falls back to Portuguese instead of breaking', () => {
    expect(renderLandingPage({}, { lang: 'xx' })).to.include('<html lang="pt-PT">')
  })

  it('every language has every label (no undefined or missing text can reach a visitor)', () => {
    const keys = Object.keys(UI.pt)
    for (const l of LANGS) {
      expect(Object.keys(UI[l]).sort(), l).to.deep.equal([...keys].sort())
      for (const k of keys) expect(String(UI[l][k]).length, `${l}.${k}`).to.be.greaterThan(0)
    }
  })

  it('the sitemap lists each available language with its alternates', () => {
    const xml = renderSitemapXml(['pt', 'en'])
    expect(xml).to.include('<loc>https://freshbubbles.pt/en</loc>')
    expect(xml).to.include('xhtml:link rel="alternate" hreflang="en"')
    expect(xml).to.not.include('<loc>https://freshbubbles.pt/fr</loc>')
  })
})

describe('Translating on save and serving /en /fr /de /es', function () {
  let tenant, app
  before(async () => {
    await startTestDb()
    tenant = await Tenant.create({ name: 'Landing I18n', slug: 'landing-i18n' })
    resetSoleTenantCache() // the 'only tenant' lookup is cached across test files
    app = express(); app.use(express.json()); app.use(resolveTenant); app.use('/', publicRoutes)
  })
  after(async () => { await Setting.deleteMany({ tenantId: tenant._id }); await Tenant.deleteOne({ _id: tenant._id }); resetSoleTenantCache(); await stopTestDb() })
  afterEach(async () => { _resetContentCacheForTests(); await Setting.deleteMany({ tenantId: tenant._id }) })
  const tag = async (strings, { target }) => strings.map((s) => `[${target}] ${s}`)

  it('translates every language, stores them, and records the status', async () => {
    await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: { hero: { heading: 'Olá mundo' } } })
    await translateLanding(tenant._id, { translate: tag })
    const stored = await getTranslations(tenant._id)
    expect(Object.keys(stored).sort()).to.deep.equal([...TRANSLATED_LANGS].sort())
    expect(stored.de.content.hero.heading).to.equal('[de] Olá mundo')
    expect(stored.de.content.brand.name).to.equal(DEFAULT_CONTENT.brand.name)
    expect((await getStatus(tenant._id)).state).to.equal('done')
  })

  it('one language failing does not lose the others, and says which one failed', async () => {
    const flaky = async (strings, { target }) => { if (target === 'fr') throw new Error('model missing'); return tag(strings, { target }) }
    await translateLanding(tenant._id, { translate: flaky })
    const stored = await getTranslations(tenant._id)
    expect(Object.keys(stored).sort()).to.deep.equal(['de', 'en', 'es'])
    const st = await getStatus(tenant._id)
    expect(st.state).to.equal('partial')
    expect(st.failed.fr).to.match(/model missing/)
  })

  it('a save that arrives during a run is translated too (the newest text always wins)', async () => {
    await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: { hero: { heading: 'Primeiro' } } })
    let first = true
    const slow = async (strings, { target }) => {
      if (first) { first = false; await Setting.updateOne({ tenantId: tenant._id, key: CONTENT_SETTING_KEY }, { value: { hero: { heading: 'Segundo' } } }); translateLanding(tenant._id, { translate: slow }) }
      return tag(strings, { target })
    }
    await translateLanding(tenant._id, { translate: slow })
    expect((await getTranslations(tenant._id)).en.content.hero.heading).to.equal('[en] Segundo')
  })

  it('serves a stored translation at /en with the current business facts, and Portuguese still at /', async () => {
    await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: { hero: { heading: 'Olá mundo' }, brand: { phone: '+351 999 000 111' } } })
    await translateLanding(tenant._id, { translate: tag })
    _resetContentCacheForTests()
    const en = await request(app).get('/en')
    expect(en.status).to.equal(200)
    expect(en.headers['content-language']).to.equal('en')
    expect(en.text).to.include('<html lang="en">')
    expect(en.text).to.include('[en] Olá mundo')
    expect(en.text).to.include('+351 999 000 111') // the phone is never translated, always the current one
    expect(en.text).to.include('hreflang="de"')
    const pt = await request(app).get('/')
    expect(pt.text).to.include('<html lang="pt-PT">')
    expect(pt.text).to.include('Olá mundo')
    expect(pt.text).to.include('class="lang-dd"')
    const map = await request(app).get('/sitemap.xml')
    expect(map.text).to.include('https://freshbubbles.pt/es')
  })

  it('a language with no translation yet sends the visitor to the Portuguese page', async () => {
    const res = await request(app).get('/de')
    expect(res.status).to.equal(302)
    expect(res.headers.location).to.equal('/')
    expect((await request(app).get('/xx')).status).to.equal(404)
  })

  it('/ shows no language switcher before any translation exists', async () => {
    const res = await request(app).get('/')
    expect(res.text).to.not.include('class="lang-dd"')
  })
})

describe('Numbers are never altered by the translator', () => {
  it('compares numbers whatever the formatting, and ignores words', () => {
    expect(numbersIn('dos 8 aos 20kg')).to.equal(numbersIn('from 8 to 20 kg'))
    expect(numbersIn('4,5 estrelas')).to.equal(numbersIn('4.5 stars'))
    expect(numbersIn('sem números')).to.equal('')
  })

  it('keeps the Portuguese for a sentence whose numbers changed, and uses the others', () => {
    const src = ['Máquinas dos 8 aos 20kg', 'Coloque a roupa', 'Aberto das 07:00 às 23:30']
    const bad = ['Machines from 10 to 20 kilos', 'Put the clothes in', 'Open from 07:00 to 23:30']
    const { out, kept } = guardNumbers(src, bad)
    expect(out).to.deep.equal(['Máquinas dos 8 aos 20kg', 'Put the clothes in', 'Open from 07:00 to 23:30'])
    expect(kept).to.equal(1)
  })
})

describe('A new translation shows on the page at once (no waiting for the cache)', function () {
  let tenant, app
  before(async () => {
    await startTestDb()
    tenant = await Tenant.create({ name: 'Landing Cache', slug: 'landing-cache' })
    resetSoleTenantCache()
    app = express(); app.use(express.json()); app.use(resolveTenant); app.use('/', publicRoutes)
  })
  after(async () => { await Setting.deleteMany({ tenantId: tenant._id }); await Tenant.deleteOne({ _id: tenant._id }); resetSoleTenantCache(); await stopTestDb() })

  it('/en redirects before the translation exists and works right after it was stored', async () => {
    _resetContentCacheForTests()
    expect((await request(app).get('/en')).status).to.equal(302) // loads and caches "no translations"
    await translateLanding(tenant._id, { translate: async (strings, { target }) => strings.map((s) => `[${target}] ${s}`) })
    const after = await request(app).get('/en') // same second: must not be served from the old cache
    expect(after.status).to.equal(200)
    expect(after.text).to.include('[en] ')
  })

  it('a sentence whose numbers the translator changed stays Portuguese on the page, and is counted', async () => {
    await Setting.deleteMany({ tenantId: tenant._id })
    await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: { hero: { subheading: 'Máquinas dos 8 aos 20kg.' } } })
    await translateLanding(tenant._id, { translate: async (strings) => strings.map((s) => s.replace('8', '10')) })
    const en = (await getTranslations(tenant._id)).en
    expect(en.content.hero.subheading).to.equal('Máquinas dos 8 aos 20kg.')
    expect(en.keptPortuguese).to.be.greaterThan(0)
  })
})

describe('Prices table (read from the database)', () => {
  const rows = [
    { type: 'wash', weight: 12, duration: 45, tImp: null, cash: 7, card: 6.5, machines: 2 },
    { type: 'wash', weight: 8, duration: 45, tImp: null, cash: 5, card: 4.5, machines: 1 },
    { type: 'dry', weight: 18, duration: null, tImp: 15, cash: 2, card: 1.8, machines: 5 },
  ]

  it('shows washing and drying with every size, sorted, with real prices and machine counts', () => {
    const html = renderLandingPage({}, { prices: rows })
    expect(html).to.include('id="precos"')
    expect(html).to.include('Lavagem')
    expect(html).to.include('Secagem')
    expect(html.indexOf('8 kg')).to.be.lessThan(html.indexOf('12 kg')) // sorted by size
    expect(html).to.match(/5,00\s€/)
    expect(html).to.match(/4,50\s€/)
    expect(html).to.include('1 máquina<')
    expect(html).to.include('2 máquinas<')
    expect(html).to.include('18 kg')
    expect(html).to.include('15 min') // a dryer shows its time per impulse
    expect(html).to.include('45 min')
  })

  it('is linked from the menu and the footer only when there is something to show', () => {
    expect(renderLandingPage({}, { prices: rows })).to.include('<li><a href="#precos">Preços</a></li>')
    for (const html of [renderLandingPage({}), renderLandingPage({}, { prices: [] })]) {
      expect(html).to.not.include('id="precos"')
      expect(html).to.not.include('href="#precos"')
    }
  })

  it('the admin can hide it, and its words come from the admin text', () => {
    expect(renderLandingPage({ prices: { visible: false } }, { prices: rows })).to.not.include('id="precos"')
    const html = renderLandingPage({ prices: { eyebrow: 'Tarifas', heading: 'O que pagar', description: 'Sem surpresas' } }, { prices: rows })
    expect(html).to.include('Tarifas')
    expect(html).to.include('Sem surpresas')
  })

  it('labels and money follow the language', () => {
    const html = renderLandingPage({}, { lang: 'en', available: ['pt', 'en'], prices: rows })
    expect(html).to.include('Washing')
    expect(html).to.include('Capacity')
    expect(html).to.include('>Cash<')
    expect(html).to.include('€5.00')
    expect(html).to.include('1 machine<')
    const de = renderLandingPage({}, { lang: 'de', available: ['pt', 'de'], prices: rows })
    expect(de).to.include('Waschen')
    expect(de).to.match(/5,00\s€/)
  })

  it('ignores a row with a missing price instead of showing "NaN"', () => {
    const html = renderLandingPage({}, { prices: [{ type: 'wash', weight: 8, duration: 45, cash: null, card: 4.5, machines: 1 }] })
    expect(html).to.not.include('NaN')
    expect(html).to.not.include('id="precos"')
  })

  it('its words are translated with the other admin text, the rows are not text to translate', () => {
    const { strings } = collectStrings(mergeContent({}))
    expect(strings).to.include('Preços claros, sem surpresas')
  })
})

describe('Prices on the live route', function () {
  let tenant, app
  before(async () => {
    await startTestDb()
    tenant = await Tenant.create({ name: 'Landing Prices', slug: 'landing-prices' })
    resetSoleTenantCache()
    app = express(); app.use(express.json()); app.use(resolveTenant); app.use('/', publicRoutes)
    const Price = (await import('../src/models/price.js')).default
    const Machine = (await import('../src/models/machine.js')).default
    await Price.create([
      { tenantId: tenant._id, type: 'wash', weight: 8, duration: 45, cashPrice: 5, cardPrice: 4.5 },
      { tenantId: tenant._id, type: 'wash', weight: 20, duration: 45, cashPrice: 10.5, cardPrice: 10 }, // no machine of this size
      { tenantId: tenant._id, type: 'dry', weight: 18, cashPrice: 2, cardPrice: 1.8 },
    ])
    await Machine.create([
      { tenantId: tenant._id, name: 'W1', type: 'wash', weight: 8 },
      { tenantId: tenant._id, name: 'D1', type: 'dry', weight: 18, tImp: 15 },
      { tenantId: tenant._id, name: 'D2', type: 'dry', weight: 18, tImp: 15 },
    ])
  })
  after(async () => {
    const Price = (await import('../src/models/price.js')).default
    const Machine = (await import('../src/models/machine.js')).default
    await Promise.all([Price, Machine, Setting].map((M) => M.deleteMany({ tenantId: tenant._id })))
    await Tenant.deleteOne({ _id: tenant._id })
    resetSoleTenantCache()
    await stopTestDb()
  })

  it('builds the table from the prices and machines in the database, and leaves out sizes nobody can use', async () => {
    _resetContentCacheForTests()
    const res = await request(app).get('/')
    expect(res.status).to.equal(200)
    expect(res.text).to.include('id="precos"')
    expect(res.text).to.include('8 kg')
    expect(res.text).to.match(/5,00\s€/)
    expect(res.text).to.include('2 máquinas<') // the two dryers
    expect(res.text).to.not.include('20 kg') // a price exists, but there is no 20 kg machine
    expect(res.text).to.include('15 min')
  })

  it('a price changed in the admin shows on the page without a deploy (after the short cache)', async () => {
    const Price = (await import('../src/models/price.js')).default
    await Price.updateOne({ tenantId: tenant._id, type: 'wash', weight: 8 }, { cashPrice: 6, cardPrice: 5.5 })
    _resetContentCacheForTests() // stands in for the 60 s cache expiring
    const res = await request(app).get('/')
    expect(res.text).to.match(/6,00\s€/)
    expect(res.text).to.not.match(/5,00\s€/)
  })

  it('the other languages show the same live rows', async () => {
    await translateLanding(tenant._id, { translate: async (strings, { target }) => strings.map((s) => `[${target}] ${s}`) })
    _resetContentCacheForTests()
    const res = await request(app).get('/en')
    expect(res.status).to.equal(200)
    expect(res.text).to.include('Washing')
    expect(res.text).to.include('€6.00')
    expect(res.text).to.include('[en] Preços claros, sem') // (the last word of a heading is wrapped for its underline)
  })
})

describe('The "how it works" button goes to the price table', () => {
  const rows = [{ type: 'wash', weight: 8, duration: 45, tImp: null, cash: 5, card: 4.5, machines: 1 }]
  it('says "see prices" and jumps to the table when there is one', () => {
    const html = renderLandingPage({}, { prices: rows })
    expect(html).to.match(/<a class="btn-ghost btn-sm" href="#precos">Ver preços<\/a>/)
    expect(renderLandingPage({}, { lang: 'en', available: ['pt', 'en'], prices: rows })).to.match(/href="#precos">See our prices<\/a>/)
  })
  it('without a table it falls back to the services section', () => {
    expect(renderLandingPage({}, { prices: [] })).to.match(/<a class="btn-ghost btn-sm" href="#servicos">Ver serviços<\/a>/)
  })
})

import { expect } from 'chai'
import { DEFAULT_GLOSSARY, GLOSSARY_LANGS, GLOSSARY_KEY, normalizeTerm, sanitizeGlossary, translateWithGlossary, loadGlossary } from '../src/services/landingGlossary.js'
import { translateLanding, getTranslations } from '../src/services/landingTranslate.js'
import { CONTENT_SETTING_KEY } from '../src/views/landing.js'
import Setting from '../src/models/setting.js'
import Tenant from '../src/models/tenant.js'
import { startTestDb, stopTestDb } from './setup.test-helper.js'

/** A "translator" that just tags the text, so we can see exactly what was sent to it and what came back. */
const tagging = (sent = []) => async (list) => { sent.push(...list); return list.map((t) => `[mt] ${t}`) }

describe('The translation dictionary (services/landingGlossary.js)', () => {
  it('the built-in list is complete: every entry has Portuguese plus all four languages, no repeats', () => {
    const seen = new Set()
    for (const e of DEFAULT_GLOSSARY) {
      expect(e.pt, 'portuguese').to.be.a('string').with.length.greaterThan(0)
      for (const l of GLOSSARY_LANGS) expect(e[l], `${e.pt} → ${l}`).to.be.a('string').with.length.greaterThan(0)
      const k = normalizeTerm(e.pt)
      expect(seen.has(k), `repeated: ${e.pt}`).to.equal(false)
      seen.add(k)
    }
    expect(DEFAULT_GLOSSARY.length).to.be.within(20, 60) // small on purpose
  })

  it('a whole text that is an entry skips the translator (any capitals, any final full stop)', async () => {
    const sent = []
    const { out, stats } = await translateWithGlossary(['Escolhe', 'escolhe', 'Retire fresca.', 'Retire fresca'], 'de', DEFAULT_GLOSSARY, tagging(sent))
    expect(out).to.deep.equal(['Wähle', 'Wähle', 'Frisch wieder mitnehmen.', 'Frisch wieder mitnehmen.'])
    expect(sent).to.have.length(0)
    expect(stats.exact).to.equal(4)
  })

  it('words and phrases inside a longer text come out as the dictionary says, in every language', async () => {
    const text = 'Pague em moedas, notas ou cartão bancário.'
    const expected = { en: 'coins', fr: 'pièces', de: 'Münzen', es: 'monedas' }
    for (const lang of GLOSSARY_LANGS) {
      const { out } = await translateWithGlossary([text], lang, DEFAULT_GLOSSARY, tagging())
      expect(out[0], lang).to.include(expected[lang])
      expect(out[0], lang).to.not.match(/XQ\d+X/) // no placeholder ever reaches the page
    }
    const de = (await translateWithGlossary([text], 'de', DEFAULT_GLOSSARY, tagging())).out[0]
    expect(de).to.include('Geldscheine').and.to.include('Bankkarte')
  })

  it('the translator is not asked to translate the dictionary words, only to carry a placeholder for them', async () => {
    const sent = []
    await translateWithGlossary(['Sem filas, sem marcações — chegue'], 'en', DEFAULT_GLOSSARY, tagging(sent))
    expect(sent[0]).to.not.include('filas')
    expect(sent[0]).to.match(/XQ1X/)
  })

  it('the longest phrase wins over the words inside it', async () => {
    const { out } = await translateWithGlossary(['Sem marcações, sem filas — venha.'], 'de', DEFAULT_GLOSSARY, tagging())
    expect(out[0]).to.include('Ohne Termin, ohne Warteschlange') // capital: the sentence starts with it
    expect(out[0]).to.not.include('Terminvereinbarung') // not the shorter "sem marcações" entry
  })

  it('only whole words match ("anotações" is not "notas"), and a capital at the start stays a capital', async () => {
    const a = (await translateWithGlossary(['As anotações ficam aqui'], 'en', DEFAULT_GLOSSARY, tagging())).out[0]
    expect(a).to.not.include('banknotes')
    const b = (await translateWithGlossary(['Notas e moedas aceites'], 'en', DEFAULT_GLOSSARY, tagging())).out[0]
    expect(b).to.include('Banknotes')
    expect(b).to.include('coins')
  })

  it('if the translator loses or doubles a placeholder, that one text is translated plainly instead', async () => {
    const sent = []
    const lossy = async (list) => { sent.push(list.slice()); return list.map((t) => t.replace(/XQ\d+X/g, '')) }
    const { out, stats } = await translateWithGlossary(['Pague em moedas hoje'], 'en', DEFAULT_GLOSSARY, lossy)
    expect(stats.retried).to.equal(1)
    expect(out[0]).to.equal('Pague em moedas hoje') // plain translation of the original (this fake returns it unchanged)
    expect(sent[1]).to.deep.equal(['Pague em moedas hoje'])
    const doubling = async (list) => list.map((t) => `${t} ${t}`)
    const d = await translateWithGlossary(['Pague em moedas'], 'en', DEFAULT_GLOSSARY, doubling)
    expect(d.stats.retried).to.equal(1)
  })

  it('an entry with nothing for that language is ignored, not shown empty', async () => {
    const partial = [{ pt: 'moedas', en: 'coins', fr: '', de: '', es: '' }]
    const { out } = await translateWithGlossary(['Pague em moedas'], 'de', partial, tagging())
    expect(out[0]).to.equal('[mt] Pague em moedas')
  })

  it('texts without any dictionary word go to the translator untouched', async () => {
    const sent = []
    await translateWithGlossary(['Olá mundo'], 'fr', DEFAULT_GLOSSARY, tagging(sent))
    expect(sent).to.deep.equal(['Olá mundo'])
  })

  it('sanitizeGlossary trims, drops empty rows, keeps the last of a repeated term, and refuses nonsense', () => {
    const out = sanitizeGlossary([
      { pt: '  Moedas ', en: ' coins ', fr: 'pièces', de: 'Münzen', es: 'monedas' },
      { pt: '', en: 'x' },
      { pt: 'moedas', en: 'COINS' },
      null,
    ])
    expect(out).to.have.length(1)
    expect(out[0]).to.include({ pt: 'moedas', en: 'COINS', fr: '' })
    expect(() => sanitizeGlossary('nope')).to.throw()
    expect(() => sanitizeGlossary([{ pt: 'x'.repeat(161) }])).to.throw(/too long/)
    expect(() => sanitizeGlossary(new Array(401).fill({ pt: 'a' }))).to.throw(/400/)
  })
})

describe('The dictionary inside the page translation', function () {
  let tenant
  before(async () => { await startTestDb(); tenant = await Tenant.create({ name: 'Glossary Test', slug: `gl-${Date.now()}` }) })
  after(async () => { await Setting.deleteMany({ tenantId: tenant._id }); await Tenant.deleteOne({ _id: tenant._id }); await stopTestDb() })
  afterEach(async () => { await Setting.deleteMany({ tenantId: tenant._id }) })

  it('uses the built-in dictionary when the admin has not saved one', async () => {
    await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: { hero: { heading: 'Coloque. Pague.', subheading: 'Sem filas e pague em moedas.' } } })
    expect((await loadGlossary(Setting, tenant._id)).isDefault).to.equal(true)
    await translateLanding(tenant._id, { langs: ['de'], translate: async (list) => list.map((t) => `[mt] ${t}`) })
    const de = (await getTranslations(tenant._id)).de
    expect(de.content.hero.heading).to.equal('Einlegen. Bezahlen.')
    expect(de.content.hero.subheading).to.include('Ohne Warteschlangen').and.to.include('Münzen')
    expect(de.glossary.exact).to.be.greaterThan(0)
  })

  it('uses the admin\'s own dictionary instead, once saved', async () => {
    await Setting.create({ tenantId: tenant._id, key: GLOSSARY_KEY, value: [{ pt: 'moedas', en: 'coins', fr: 'pièces', de: 'Münzen', es: 'monedas' }] })
    await Setting.create({ tenantId: tenant._id, key: CONTENT_SETTING_KEY, value: { hero: { heading: 'Coloque. Pague.', subheading: 'Sem filas e pague em moedas.' } } })
    expect((await loadGlossary(Setting, tenant._id)).isDefault).to.equal(false)
    await translateLanding(tenant._id, { langs: ['de'], translate: async (list) => list.map((t) => `[mt] ${t}`) })
    const de = (await getTranslations(tenant._id)).de
    expect(de.content.hero.heading).to.equal('[mt] Coloque. Pague.') // the built-in entry is gone with the old list
    expect(de.content.hero.subheading).to.include('Münzen').and.to.not.include('Warteschlangen')
  })
})

/**
 * A small dictionary for the public page's machine translation.
 *
 * The free translator gets everyday laundry words wrong ("sem filas" -> "keine Reihen", "marcações" ->
 * "Markierungen", "notas" -> "Tickets"). This dictionary fixes the common ones, in two ways:
 *   1. A whole string that IS an entry (a heading such as "Escolhe") is not machine translated at all.
 *   2. A word or phrase of an entry inside a longer text is swapped for a placeholder (XQ1X) before the text
 *      goes to the translator and replaced by the dictionary's word afterwards. If the translator drops or
 *      repeats a placeholder, that one text is translated again without the dictionary: never half a sentence.
 *
 * The admin can edit the whole list (Definições > Página Inicial > Traduções automáticas). Once saved it replaces
 * the built-in list; "Repor predefinições" brings the built-in one back. Portuguese is matched whole-word and
 * ignoring capitals. Prefer phrases that include their article ("o seu cartão") for German, French and Spanish,
 * where the article has to agree with the noun.
 */

export const GLOSSARY_KEY = 'landingPage.glossary'
export const GLOSSARY_LANGS = ['en', 'fr', 'de', 'es']

const e = (pt, en, fr, de, es) => ({ pt, en, fr, de, es })

export const DEFAULT_GLOSSARY = [
  // headings of the default steps and hero
  e('Coloque. Pague.', 'Load up. Pay.', 'Chargez. Payez.', 'Einlegen. Bezahlen.', 'Cargue. Pague.'),
  e('Retire fresca.', 'Take it out fresh.', 'Récupérez-le tout frais.', 'Frisch wieder mitnehmen.', 'Retírela fresca.'),
  e('Escolhe', 'Choose', 'Choisis', 'Wähle', 'Elige'),
  e('Prepara', 'Prepare', 'Prépare', 'Bereite vor', 'Prepara'),
  e('Lava & seca', 'Wash & dry', 'Lave & sèche', 'Waschen & trocknen', 'Lava y seca'),
  e('Retira', 'Collect', 'Récupère', 'Abholen', 'Recoge'),
  e('Disfruta', 'Enjoy', 'Profite', 'Genieße', 'Disfruta'),
  // phrases that come up in the marketing text
  e('chegue, lave, siga a sua vida', 'arrive, wash, carry on with your day', 'arrivez, lavez, reprenez votre journée', 'kommen, waschen, weiterziehen', 'llegue, lave y siga con su día'),
  e('sem marcações, sem filas', 'no appointments, no queues', 'sans rendez-vous, sans file d’attente', 'ohne Termin, ohne Warteschlange', 'sin cita previa, sin colas'),
  e('sem marcações', 'no appointments', 'sans rendez-vous', 'ohne Terminvereinbarung', 'sin cita previa'),
  e('sem filas', 'no queues', 'sans file d’attente', 'ohne Warteschlangen', 'sin colas'),
  e('lavandaria self-service', 'self-service laundrette', 'laverie en libre-service', 'Selbstbedienungs-Waschsalon', 'lavandería de autoservicio'),
  e('limpeza a seco', 'dry cleaning', 'nettoyage à sec', 'chemische Reinigung', 'limpieza en seco'),
  e('lavagem de tapetes', 'rug washing', 'lavage de tapis', 'Teppichwäsche', 'lavado de alfombras'),
  e('recolha e entrega ao domicílio', 'home pick-up and delivery', 'collecte et livraison à domicile', 'Abhol- und Lieferservice', 'recogida y entrega a domicilio'),
  e('cartão bancário', 'bank card', 'carte bancaire', 'Bankkarte', 'tarjeta bancaria'),
  e('com o seu cartão fresh bubbles', 'with your Fresh Bubbles card', 'avec votre carte Fresh Bubbles', 'mit Ihrer Fresh-Bubbles-Karte', 'con su tarjeta Fresh Bubbles'),
  e('com o seu cartão freshbubbles', 'with your FreshBubbles card', 'avec votre carte FreshBubbles', 'mit Ihrer FreshBubbles-Karte', 'con su tarjeta FreshBubbles'),
  e('o seu cartão fresh bubbles', 'your Fresh Bubbles card', 'votre carte Fresh Bubbles', 'Ihre Fresh-Bubbles-Karte', 'su tarjeta Fresh Bubbles'),
  e('o seu cartão freshbubbles', 'your FreshBubbles card', 'votre carte FreshBubbles', 'Ihre FreshBubbles-Karte', 'su tarjeta FreshBubbles'),
  e('cartão de cliente', 'customer card', 'carte client', 'Kundenkarte', 'tarjeta de cliente'),
  e('com o seu cartão', 'with your card', 'avec votre carte', 'mit Ihrer Karte', 'con su tarjeta'),
  e('wifi grátis', 'free WiFi', 'WiFi gratuit', 'kostenloses WLAN', 'WiFi gratis'),
  e('máquinas modernas', 'modern machines', 'machines modernes', 'moderne Maschinen', 'máquinas modernas'),
  // everyday words
  e('moedas', 'coins', 'pièces', 'Münzen', 'monedas'),
  e('notas', 'banknotes', 'billets', 'Geldscheine', 'billetes'),
  e('lavagem', 'washing', 'lavage', 'Wäsche', 'lavado'),
  e('secagem', 'drying', 'séchage', 'Trocknen', 'secado'),
  e('engomadoria', 'ironing', 'repassage', 'Bügelservice', 'planchado'),
  e('tapetes', 'rugs', 'tapis', 'Teppiche', 'alfombras'),
  e('serviços', 'services', 'services', 'Leistungen', 'servicios'),
  e('roupa suja', 'dirty laundry', 'linge sale', 'Schmutzwäsche', 'ropa sucia'),
  e('roupa', 'laundry', 'linge', 'Wäsche', 'ropa'),
]

/** Lower case, single spaces, no trailing punctuation: what two spellings of the same entry have in common. */
export const normalizeTerm = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim().replace(/[.!?…:;,\s]+$/u, '')

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Checks and cleans a list coming from the admin. Throws a readable error for anything unusable. */
export function sanitizeGlossary(input) {
  if (!Array.isArray(input)) throw new Error('The dictionary must be a list')
  if (input.length > 400) throw new Error('The dictionary is limited to 400 entries')
  const byKey = new Map()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const pt = String(raw.pt || '').trim()
    if (!pt) continue
    if (pt.length > 160) throw new Error(`"${pt.slice(0, 30)}…" is too long (160 characters at most)`)
    const entry = { pt }
    for (const lang of GLOSSARY_LANGS) {
      const v = String(raw[lang] || '').trim()
      if (v.length > 160) throw new Error(`The ${lang.toUpperCase()} text for "${pt}" is too long (160 characters at most)`)
      entry[lang] = v
    }
    byKey.set(normalizeTerm(pt), entry) // a repeated Portuguese term: the last one wins
  }
  return [...byKey.values()]
}

/** What goes with a tenant: its saved dictionary, or the built-in one. */
export async function loadGlossary(SettingModel, tenantId) {
  const doc = await SettingModel.findOne({ tenantId, key: GLOSSARY_KEY }).lean()
  if (doc && Array.isArray(doc.value)) return { entries: doc.value, isDefault: false }
  return { entries: DEFAULT_GLOSSARY, isDefault: true }
}

const trailing = (s) => (String(s).match(/[.!?…]+$/u) || [''])[0]
const upFirst = (s) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)

/**
 * Translate `strings` into `target`, using the dictionary. `translate(strings)` is the plain machine translation
 * (returns an array of the same length). Returns { out, stats: { exact, protectedTexts, retried } }.
 */
export async function translateWithGlossary(strings, target, entries, translate) {
  const usable = (entries || []).filter((x) => x && x.pt && x[target])
  const exact = new Map(usable.map((x) => [normalizeTerm(x.pt), x[target]]))
  // longest phrases first, so "sem marcações, sem filas" wins over "sem filas"
  const terms = usable
    .map((x) => ({ re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(x.pt.trim()).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu'), to: x[target], len: x.pt.length }))
    .sort((a, b) => b.len - a.len)

  const out = new Array(strings.length)
  const todo = [] // { i, text, tokens }
  const stats = { exact: 0, protectedTexts: 0, retried: 0 }

  strings.forEach((s, i) => {
    if (typeof s !== 'string' || !s.trim()) { out[i] = s; return }
    const whole = exact.get(normalizeTerm(s))
    if (whole !== undefined) {
      const end = trailing(s)
      out[i] = end && !trailing(whole) ? whole + end : whole
      stats.exact += 1
      return
    }
    const tokens = []
    let text = s
    for (const t of terms) {
      text = text.replace(t.re, (m) => {
        const token = `XQ${tokens.length + 1}X`
        const first = m.charAt(0)
        const capital = first !== first.toLocaleLowerCase() && first === first.toLocaleUpperCase()
        tokens.push({ token, to: capital ? upFirst(t.to) : t.to })
        return token
      })
    }
    todo.push({ i, text, tokens })
  })

  if (todo.length) {
    const translated = await translate(todo.map((x) => x.text))
    const retry = []
    todo.forEach((item, k) => {
      let t = translated[k]
      const ok = item.tokens.every((tk) => t.split(tk.token).length === 2) // each placeholder came back exactly once
      if (item.tokens.length && !ok) { retry.push(item); return }
      for (const tk of item.tokens) t = t.split(tk.token).join(tk.to)
      if (item.tokens.length) stats.protectedTexts += 1
      out[item.i] = t
    })
    if (retry.length) {
      // The translator lost a placeholder: translate those texts the plain way instead of showing a broken sentence.
      const plain = await translate(retry.map((x) => strings[x.i]))
      retry.forEach((item, k) => { out[item.i] = plain[k]; stats.retried += 1 })
    }
  }
  return { out, stats }
}

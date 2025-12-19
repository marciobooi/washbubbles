import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import pt from '../locales/pt/pos.json'
import en from '../locales/en/pos.json'
import fr from '../locales/fr/pos.json'
import de from '../locales/de/pos.json'

const resources = {
  pt: { pos: pt },
  en: { pos: en },
  fr: { pos: fr },
  de: { pos: de },
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'pt',
    fallbackLng: 'pt',
    ns: ['pos'],
    defaultNS: 'pos',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })

export default i18n

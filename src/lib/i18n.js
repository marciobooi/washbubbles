import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import pt from '../locales/pt/pos.json'
import en from '../locales/en/pos.json'
import fr from '../locales/fr/pos.json'
import de from '../locales/de/pos.json'

import ptHelp from '../locales/pt/help.json'
import enHelp from '../locales/en/help.json'
import frHelp from '../locales/fr/help.json'
import deHelp from '../locales/de/help.json'

const resources = {
  pt: { pos: pt, help: ptHelp },
  en: { pos: en, help: enHelp },
  fr: { pos: fr, help: frHelp },
  de: { pos: de, help: deHelp },
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'pt',
    fallbackLng: 'pt',
    ns: ['pos', 'help'],
    defaultNS: 'pos',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })

export default i18n

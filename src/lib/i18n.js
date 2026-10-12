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

import ptCart from '../locales/pt/cart.json'
import enCart from '../locales/en/cart.json'
import frCart from '../locales/fr/cart.json'
import deCart from '../locales/de/cart.json'

import ptBuy from '../locales/pt/buycard.json'
import enBuy from '../locales/en/buycard.json'
import frBuy from '../locales/fr/buycard.json'
import deBuy from '../locales/de/buycard.json'

const resources = {
  pt: { pos: pt, help: ptHelp, cart: ptCart, buycard: ptBuy },
  en: { pos: en, help: enHelp, cart: enCart, buycard: enBuy },
  fr: { pos: fr, help: frHelp, cart: frCart, buycard: frBuy },
  de: { pos: de, help: deHelp, cart: deCart, buycard: deBuy },
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'pt',
    fallbackLng: 'pt',
    ns: ['pos', 'help', 'cart', 'buycard'],
    defaultNS: 'pos',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })

export default i18n

import React from 'react'
import { useTranslation } from 'react-i18next'
import flagPt from '@/assets/flags/pt.png'
import flagEn from '@/assets/flags/en.png'
import flagFr from '@/assets/flags/fr.png'
import flagDe from '@/assets/flags/de.png'

const LANGS = [
  { code: 'pt', label: 'PT', name: 'Português', flagSrc: flagPt },
  { code: 'en', label: 'EN', name: 'English', flagSrc: flagEn },
  { code: 'fr', label: 'FR', name: 'Français', flagSrc: flagFr },
  { code: 'de', label: 'DE', name: 'Deutsch', flagSrc: flagDe },
]

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const current = LANGS.find((l) => l.code === i18n.language) || LANGS[0]

  function setLang(code) {
    i18n.changeLanguage(code)
    try { localStorage.setItem('i18nextLng', code) } catch { /* localStorage throws in private mode; the preference is optional */ }
    setOpen(false)
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((s)=>!s)} className="inline-flex items-center p-3 rounded-lg hover:bg-white/60 focus:outline-none">
        <img src={current.flagSrc} alt={current.name} className="w-9 h-9 rounded-md mr-3 object-cover" />
        <span className="hidden sm:inline text-xl font-semibold">{current.label}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 bg-white border rounded-lg shadow-md z-50 w-60">
          {LANGS.map((l) => (
            <button key={l.code} onClick={() => setLang(l.code)} className="w-full text-left px-4 py-3 hover:bg-neutral-50 flex items-center gap-4">
              <img src={l.flagSrc} alt={l.name} className="w-8 h-8 rounded-md object-cover" />
              <div>
                <div className="text-lg font-medium">{l.name}</div>
                <div className="text-xs text-neutral-500 hidden sm:block">{l.label}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

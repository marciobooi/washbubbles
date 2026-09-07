import React from 'react'
import { useTranslation } from 'react-i18next'

const LANGS = [
  { code: 'pt', label: 'PT', name: 'Português', flagSrc: '/flags/pt.png' },
  { code: 'en', label: 'EN', name: 'English', flagSrc: '/flags/en.png' },
  { code: 'fr', label: 'FR', name: 'Français', flagSrc: '/flags/fr.png' },
  { code: 'de', label: 'DE', name: 'Deutsch', flagSrc: '/flags/de.png' },
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
      <button onClick={() => setOpen((s)=>!s)} className="inline-flex items-center p-2 rounded-md hover:bg-white/60 focus:outline-none">
        <img src={current.flagSrc} alt={current.name} className="w-5 h-5 rounded-sm mr-2 object-cover" />
        <span className="hidden sm:inline text-sm font-medium">{current.label}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 bg-white border rounded shadow-md z-50 w-44">
          {LANGS.map((l) => (
            <button key={l.code} onClick={() => setLang(l.code)} className="w-full text-left px-3 py-2 hover:bg-neutral-50 flex items-center gap-3">
              <img src={l.flagSrc} alt={l.name} className="w-5 h-5 rounded-sm object-cover" />
              <div>
                <div className="text-sm font-medium">{l.name}</div>
                <div className="text-xs text-neutral-500 hidden sm:block">{l.label}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

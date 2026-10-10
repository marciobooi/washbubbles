import React from 'react'
import { createPortal } from 'react-dom'
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
  const [pos, setPos] = React.useState({ top: 0, right: 0 })
  const btnRef = React.useRef(null)

  const current = LANGS.find((l) => l.code === i18n.language) || LANGS[0]

  function setLang(code) {
    i18n.changeLanguage(code)
    try { localStorage.setItem('i18nextLng', code) } catch { /* localStorage throws in private mode; the preference is optional */ }
    setOpen(false)
  }

  function toggle() {
    // Where to put the list: just under the button, right-aligned with it.
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
    setOpen((s) => !s)
  }

  // Close on Escape.
  React.useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative">
      <button ref={btnRef} onClick={toggle} className="inline-flex items-center p-3 rounded-lg hover:bg-white/60 focus:outline-none">
        <img src={current.flagSrc} alt={current.name} className="w-9 h-9 rounded-md mr-3 object-cover" />
        <span className="hidden sm:inline text-xl font-semibold">{current.label}</span>
      </button>

      {/* Rendered at the top level of the page: inside the header it was covered by the machine list. */}
      {open && createPortal(
        <>
        <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
        <div className="fixed z-[9999] bg-white border rounded-lg shadow-xl w-60" style={{ top: pos.top, right: pos.right }}>
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
        </>,
        document.body
      )}
    </div>
  )
}

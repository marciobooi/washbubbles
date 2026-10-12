import React, { useEffect } from 'react'
import i18n from '@/lib/i18n'

export default function Modal({ open, onClose, children, title, hideClose = false, wide = false, maxWidth = null, shiftDownVh = 0 }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={shiftDownVh ? { paddingTop: `${shiftDownVh * 2}vh` } : undefined}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} style={maxWidth ? { maxWidth } : undefined} className={`relative bg-white rounded-xl shadow-2xl ${maxWidth ? '' : (wide ? 'max-w-6xl' : 'max-w-3xl')} w-full z-10 p-6 max-h-[96vh] overflow-y-auto`}>
        {!hideClose && (
          <button aria-label={i18n.t('closeBtn', { ns: 'cart' })} onClick={onClose} className="absolute right-4 top-4 w-12 h-12 flex items-center justify-center rounded-xl bg-slate-100 text-xl text-neutral-600 active:bg-slate-200">✕</button>
        )}
        {children}
      </div>
    </div>
  )
}

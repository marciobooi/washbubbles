import React, { useEffect } from 'react'

export default function Modal({ open, onClose, children, title, hideClose = false, wide = false }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={`relative bg-white rounded-xl shadow-2xl ${wide ? 'max-w-6xl' : 'max-w-3xl'} w-full z-10 p-6 max-h-[96vh] overflow-y-auto`}>
        {!hideClose && (
          <button aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 text-neutral-600 hover:text-neutral-900">✕</button>
        )}
        {children}
      </div>
    </div>
  )
}

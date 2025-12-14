import React, { useEffect } from 'react'

export default function Toast({ open, message, onClose, duration = 2500, type = 'info' }) {
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => onClose && onClose(), duration)
    return () => clearTimeout(id)
  }, [open, duration, onClose])

  if (!open) return null

  return (
    <div className="fixed top-6 right-6 z-50">
      <div className={`flex items-center gap-3 px-4 py-2 rounded shadow-lg ${type === 'success' ? 'bg-green-600 text-white' : 'bg-neutral-800 text-white'}`} role="status" aria-live="polite">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={type === 'success' ? 'M5 13l4 4L19 7' : 'M13 16h-1v-4h-1'} />
        </svg>
        <div>{message}</div>
      </div>
    </div>
  )
}

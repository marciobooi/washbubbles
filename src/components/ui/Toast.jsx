import React, { createContext, useContext } from 'react'
import { Toaster, toast as sonnerToast } from 'sonner'

// Lightweight adapter so existing `toast()` calls keep working while using Sonner under the hood
const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  return (
    <ToastContext.Provider value={{}}>
      {children}
      {/* Top middle, just under the header, and big: the kiosk is read from a distance. */}
      <Toaster
        position="top-center"
        offset="104px"
        richColors
        style={{ "--width": "min(94vw, 780px)" }}
        toastOptions={{
          // Gone after 5 s, whatever it carries.
          duration: 5000,
          style: { fontSize: "1.6rem", lineHeight: 1.3, padding: "22px 26px", fontWeight: 600, borderRadius: "16px" },
          // The action button ("Ver carrinho") is pressed with a finger: make it a real touch target.
          actionButtonStyle: { fontSize: "1.5rem", fontWeight: 700, padding: "16px 26px", height: "auto", minHeight: "64px", borderRadius: "14px", marginLeft: "16px" },
          cancelButtonStyle: { fontSize: "1.5rem", padding: "16px 26px", height: "auto", minHeight: "64px", borderRadius: "14px" },
        }}
      />
    </ToastContext.Provider>
  )
}

/**
 * "Machine added to cart" banner, same layout as the design mock: machine badge, title + subtitle,
 * dark "view cart" button with the item count, close button and a 5 s countdown bar.
 */
export function cartAddedToast({ badge, title, subtitle, viewLabel, count, dismissLabel, onView }) {
  const DURATION = 5000
  return sonnerToast.custom((id) => (
    <div
      style={{ width: '100%', touchAction: 'manipulation' }}
      className="bg-white/95 backdrop-blur-md rounded-full border border-emerald-100 overflow-hidden"
    >
      <div style={{ boxShadow: '0 24px 48px -12px rgba(15,23,42,.18), 0 8px 24px -6px rgba(5,150,105,.15)' }} className="rounded-full">
        <div className="px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="shrink-0 w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-bold text-2xl shadow-sm">
              {badge}
            </div>
            <div className="flex flex-col text-left min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-xl leading-tight tracking-tight">{title}</span>
                <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M4.5 12.75l6 6 9-13.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              </div>
              {subtitle ? <p className="text-base text-slate-500 font-medium leading-snug">{subtitle}</p> : null}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => { sonnerToast.dismiss(id); onView && onView() }}
              className="min-h-[60px] px-6 bg-slate-900 active:scale-[0.98] text-white font-bold text-lg rounded-full flex items-center justify-center gap-2.5 shadow-md"
            >
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span>{viewLabel}</span>
              {count ? <span className="bg-slate-800 text-emerald-300 text-sm px-2.5 py-0.5 rounded-full font-semibold">{count}</span> : null}
            </button>
            <button
              type="button"
              aria-label={dismissLabel}
              onClick={() => sonnerToast.dismiss(id)}
              className="shrink-0 w-14 h-14 rounded-full active:bg-slate-200 text-slate-400 flex items-center justify-center"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
        <div className="w-full h-1.5 bg-slate-100 overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ animation: `wbToastCountdown ${DURATION}ms linear forwards` }} />
        </div>
      </div>
      <style>{'@keyframes wbToastCountdown{from{width:100%}to{width:0%}}'}</style>
    </div>
  ), { duration: DURATION })
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside a ToastProvider')
  return {
    toast: (opts) => sonnerToast(opts.description || opts.title || '', { type: opts.variant === 'destructive' ? 'error' : opts.variant }),
  }
}

export function toast(opts) {
  sonnerToast(opts.description || opts.title || '', { type: opts.variant === 'destructive' ? 'error' : opts.variant })
}

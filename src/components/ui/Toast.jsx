import React, { createContext, useContext } from 'react'
import { Toaster, toast as sonnerToast } from 'sonner'
import i18n from '@/lib/i18n'

// Lightweight adapter so existing `toast()` calls keep working while using Sonner under the hood
const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  return (
    <ToastContext.Provider value={{}}>
      {children}
      {/* Top middle, just under the header, and big: the kiosk is read from a distance. */}
      <Toaster
        position="top-center"
        expand
        visibleToasts={4}
        gap={16}
        offset="104px"
        richColors
        style={{ "--width": "min(96vw, 1000px)" }}
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

const DURATION = 5000
const TONES = {
  success: { badge: 'bg-emerald-600', chip: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', border: 'border-emerald-100', glow: 'rgba(5,150,105,.15)', icon: 'M4.5 12.75l6 6 9-13.5' },
  warning: { badge: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', border: 'border-amber-100', glow: 'rgba(217,119,6,.18)', icon: 'M12 8v5m0 3.5h.01' },
  error: { badge: 'bg-rose-600', chip: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500', border: 'border-rose-100', glow: 'rgba(225,29,72,.18)', icon: 'M6 18L18 6M6 6l12 12' },
  info: { badge: 'bg-slate-700', chip: 'bg-slate-100 text-slate-700', bar: 'bg-slate-500', border: 'border-slate-200', glow: 'rgba(15,23,42,.12)', icon: 'M12 11v5m0-8.5h.01' },
}
const toneOf = (variant) => TONES[variant === 'destructive' ? 'error' : variant] || TONES.info

/**
 * The one kiosk notification: machine/status badge, title + optional subtitle, optional action
 * button (with a count) and close button, and a 5 s countdown bar. Colour follows the variant
 * (success / warning / error|destructive / info).
 *   showToast({ variant, title, description, badge, action: { label, count, onClick }, dismissLabel })
 */
export function showToast({ variant = 'info', title, description, badge, action, dismissLabel, duration = DURATION }) {
  const tone = toneOf(variant)
  const closeLabel = dismissLabel || i18n.t('dismissNotice', { ns: 'cart' })
  return sonnerToast.custom((id) => (
    <div
      style={{ width: '100%', touchAction: 'manipulation', boxShadow: `0 24px 48px -12px rgba(15,23,42,.18), 0 8px 24px -6px ${tone.glow}` }}
      className={`bg-white/95 backdrop-blur-md rounded-full border overflow-hidden ${tone.border}`}
    >
      <div className="px-9 py-6 flex items-center justify-between gap-8">
        <div className="flex items-center gap-6 min-w-0">
          <div className={`shrink-0 w-16 h-16 rounded-2xl text-white flex items-center justify-center font-bold text-3xl shadow-sm ${tone.badge}`}>
            {badge || (
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.75" viewBox="0 0 24 24"><path d={tone.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </div>
          <div className="flex flex-col text-left min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-2xl leading-snug tracking-tight">{title}</span>
              {badge ? (
                <span className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full ${tone.chip}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d={tone.icon} strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              ) : null}
            </div>
            {description ? <p className="text-lg text-slate-500 font-medium leading-snug mt-1.5">{description}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {action ? (
            <button
              type="button"
              onClick={() => { sonnerToast.dismiss(id); action.onClick && action.onClick() }}
              className="min-h-[68px] px-8 bg-slate-900 active:scale-[0.98] text-white font-bold text-xl rounded-full flex items-center justify-center gap-3 shadow-md"
            >
              {action.icon === 'bag' ? (
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : null}
              <span>{action.label}</span>
              {action.count ? <span className="bg-slate-800 text-emerald-300 text-base px-3 py-0.5 rounded-full font-semibold">{action.count}</span> : null}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => sonnerToast.dismiss(id)}
            className="shrink-0 w-16 h-16 rounded-full active:bg-slate-200 text-slate-400 flex items-center justify-center"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>
      <div className="w-full h-1.5 bg-slate-100 overflow-hidden">
        <div className={`h-full ${tone.bar}`} style={{ animation: `wbToastCountdown ${duration}ms linear forwards` }} />
      </div>
      <style>{'@keyframes wbToastCountdown{from{width:100%}to{width:0%}}'}</style>
    </div>
  ), { id: [variant, title].join(":"), duration, unstyled: true, style: { padding: 0, background: 'transparent', border: 'none', boxShadow: 'none', width: 'var(--width)' } })
}

/** "Machine added to cart": the same toast with the machine number as badge and a view-cart action. */
export function cartAddedToast({ badge, title, subtitle, viewLabel, count, dismissLabel, onView }) {
  return showToast({ variant: 'success', badge, title, description: subtitle, dismissLabel, action: { label: viewLabel, count, icon: 'bag', onClick: onView } })
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside a ToastProvider')
  return {
    toast: (opts) => showToast({ variant: opts.variant, title: opts.title || opts.description || '', description: opts.title ? opts.description : undefined, action: opts.action }),
  }
}

export function toast(opts) {
  showToast({ variant: opts.variant, title: opts.title || opts.description || '', description: opts.title ? opts.description : undefined, action: opts.action })
}

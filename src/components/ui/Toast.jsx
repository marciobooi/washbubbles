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
        style={{ "--width": "min(92vw, 640px)" }}
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

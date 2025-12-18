import React, { createContext, useContext } from 'react'
import { Toaster, toast as sonnerToast } from 'sonner'

// Lightweight adapter so existing `toast()` calls keep working while using Sonner under the hood
const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  return (
    <ToastContext.Provider value={{}}>
      {children}
      <Toaster position="top-right" richColors toastOptions={{ duration: 3500 }} />
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

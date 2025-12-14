import React, { createContext, useContext, useState } from 'react'

const PaymentContext = createContext()

export function usePayment() {
  return useContext(PaymentContext)
}

export function PaymentProvider({ children }) {
  const [fidelityEnabled] = useState(true) // mock: fidelity available

  async function processPayment(items = [], opts = { useFidelity: false }) {
    // Mock payment processing
    const total = items.reduce((s, i) => s + (i.price || 0), 0)
    const discounted = items.reduce((s, i) => s + (Math.max(0, (i.price || 0) - (opts.useFidelity ? 0.5 : 0))), 0)

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ success: true, total, discounted, method: opts.useFidelity ? 'fidelity' : 'card' })
      }, 600)
    })
  }

  const value = { fidelityEnabled, processPayment }
  return <PaymentContext.Provider value={value}>{children}</PaymentContext.Provider>
}

import React, { createContext, useContext, useState } from 'react'
import api from '@/services/api'
import CardGateway from '@/services/payment/cardGateway'
import CashGateway from '@/services/payment/cashGateway'

const PaymentContext = createContext()

export function usePayment() {
  return useContext(PaymentContext)
}

export function PaymentProvider({ children }) {
  const [fidelityEnabled] = useState(true) // mock: fidelity available

  // processPayment delegates to gateways based on opts.method (card|cash)
  async function processPayment(items = [], opts = { useFidelity: false, method: 'card' }) {
    const method = opts.method === 'cash' ? 'cash' : 'card'

    // compute kiosk API key fallback if not passed explicitly
    const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
    const kioskKeyFinal = opts.kioskKey || electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY

    if (method === 'cash') {
      // Use server-side gateway for cash
      try {
        const payload = { items, inserted: opts.inserted, batchId: opts.batchId }
        const resp = await api.gatewayCashPay(payload, { apiKey: kioskKeyFinal })
        // `changeDispensed` / `changeError` tell us whether the hopper actually
        // paid out. Dropping them here is how a jam became a silent short-change.
        return {
          success: true, method: 'cash', total: resp.total, inserted: resp.inserted,
          change: resp.change, sales: resp.sales,
          changeDispensed: resp.changeDispensed, changeError: resp.changeError,
        }
      } catch (e) {
        return { success: false, error: e }
      }
    }

    if (method === 'card') {
      // If cardCode provided, call server-side gateway which persists recharges and spends atomically
      if (opts.cardCode) {
        try {
          const payload = { items, cardCode: opts.cardCode, batchId: opts.batchId }
          const resp = await api.gatewayCardPay(payload, { apiKey: kioskKeyFinal })
          return { success: true, method: 'card', total: items.reduce((s,i)=>s+(i.price||i.amount||0),0), results: resp.sales, card: resp.card }
        } catch (e) {
          return { success: false, error: e }
        }
      }

      // No cardCode — if useFidelity flag is set, we can simulate discount as card payment
      if (opts.useFidelity) {
        const total = items.reduce((s, i) => s + (i.price || 0) - 0.5, 0)
        return { success: true, method: 'card', total, discounted: true }
      }

      // No cardCode and no fidelity — nothing was actually charged, so this must not report success
      return { success: false, method: 'card', error: 'No card provided' }
    }

    return { success: false, error: 'Unsupported payment method' }
  }

  const value = { fidelityEnabled, processPayment, CardGateway, CashGateway }
  return <PaymentContext.Provider value={value}>{children}</PaymentContext.Provider>
}

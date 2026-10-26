import React, { createContext, useContext, useState, useEffect } from 'react'
import { subscribe } from '@/services/websocket'
import api from '@/services/api'
import i18n from '@/lib/i18n'
import { isKioskScreen } from '@/lib/kioskContext'
import { checkForUpdateNow, reloadWhenIdle } from '@/lib/autoReload'

// The kiosk authenticates with its own API key, same as the other kiosk pages.
function kioskHeaders() {
  try {
    const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
    const key = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
    return key ? { Authorization: `ApiKey ${key}` } : undefined
  } catch { return undefined }
}

export const CartContext = createContext()

export const useCart = () => useContext(CartContext)

// Longest dryer purchase in blocks (8 x 15 min = 2 h). The server clamps to the same limit.
const MAX_BLOCKS = 8

export const CartProvider = ({ children }) => {
  const [cart, setCart] = useState([])

  // Cash (coins/bills) the customer has put in and not yet spent. Lives here, not in the
  // cart window, so it shows from the moment the first coin lands — before any machine is
  // chosen — and survives opening and closing the cart.
  const [credit, setCredit] = useState(0)
  // Unspent cash is paid back by the shop after the kiosk has been left alone. `refundAt` is
  // when that will happen (ms), restarted by every coin/bill and every touch of the screen.
  const [refundAfter, setRefundAfter] = useState(120)
  const [refundAt, setRefundAt] = useState(null)
  const refundAfterRef = React.useRef(120)
  const restartCountdown = React.useCallback(() => setRefundAt(Date.now() + refundAfterRef.current * 1000), [])
  const adoptRefundTiming = React.useCallback((s) => {
    const after = Number(s?.refundAfterSeconds)
    if (Number.isFinite(after) && after >= 0) { refundAfterRef.current = after; setRefundAfter(after) }
    const left = Number(s?.refundInSeconds)
    if (Number.isFinite(left) && s?.refundInSeconds !== null) setRefundAt(Date.now() + left * 1000)
  }, [])

  // Make the badge match what the shop really holds (used after a reconnect and while credit is showing).
  const syncFromShop = React.useCallback(() => {
    if (!isKioskScreen()) return Promise.resolve()
    return api.request('/middleware/client/balance', { method: 'GET', expect: 'json', headers: kioskHeaders(), skipAuth: true })
      .then((s) => {
        const cash = Math.round((Number(s?.cash) || 0) * 100) / 100
        setCredit(cash)
        if (cash > 0) adoptRefundTiming(s); else setRefundAt(null)
      })
      .catch(() => {})
  }, [adoptRefundTiming])

  useEffect(() => {
    return subscribe((data) => {
      if (!data || typeof data !== 'object') return
      if (data.type === 'ws:open') { syncFromShop(); checkForUpdateNow(); return } // the backend restarts when the PC updates
      if (data.type === 'screen:reload') { reloadWhenIdle(); return } // the admin asked for a refresh
      const toast = (opts) => import('@/components/ui/Toast').then((m) => m.toast(opts)).catch(() => {})
      if (data.type === 'peripheral:credit') {
        const amount = Number(data.payload?.amount)
        if (!(amount > 0)) return
        setCredit((c) => Math.round((c + amount) * 100) / 100)
        restartCountdown()
        toast({ title: i18n.t('cashInserted', { ns: 'cart', amount: `${amount.toFixed(2)}€` }), variant: 'success' })
      } else if (data.type === 'credit:refunded') {
        // The shop paid the unspent cash back from the hopper.
        setCredit(0)
        setRefundAt(null)
        toast({ title: i18n.t('refunded', { ns: 'cart', amount: `${Number(data.payload?.refunded || 0).toFixed(2)}€` }), description: i18n.t('takeCoins', { ns: 'cart' }), variant: 'success' })
      } else if (data.type === 'change:shortfall') {
        // The machine could not pay all the change: the customer is owed money; the staff has been e-mailed.
        const owed = Number(data.payload?.remaining || 0)
        toast({ title: i18n.t('changeShortfall', { ns: 'cart' }), description: i18n.t('changeShortfallHint', { ns: 'cart', amount: `${owed.toFixed(2)}€` }), variant: 'destructive' })
      } else if (data.type === 'credit:refund-failed') {
        const left = Number(data.payload?.remaining || 0)
        setCredit(Math.round(left * 100) / 100)
        restartCountdown()
        toast({ title: i18n.t('refundFailed', { ns: 'cart' }), description: i18n.t('refundFailedHint', { ns: 'cart', amount: `${left.toFixed(2)}€` }), variant: 'destructive' })
      }
    })
  }, [restartCountdown, syncFromShop])

  // Cash already in the machine when this page loads (page reloaded, or coins put in before
  // it opened) — the backend is the one that actually holds it.
  useEffect(() => {
    if (!isKioskScreen()) return undefined
    let alive = true
    api.request('/middleware/client/balance', { method: 'GET', expect: 'json', headers: kioskHeaders(), skipAuth: true })
      .then((s) => {
        if (!alive) return
        const cash = Number(s?.cash)
        if (cash > 0) setCredit((c) => Math.max(c, Math.round(cash * 100) / 100))
        adoptRefundTiming(s)
      })
      .catch(() => { /* offline or not a shop PC: the badge simply starts at 0 */ })
    return () => { alive = false }
  }, [adoptRefundTiming])

  // While there is credit, touching the screen means the customer is still here: tell the shop
  // (so it does not pay the money back mid-choice) and restart the countdown. At most every 3 s.
  useEffect(() => {
    if (!(credit > 0)) { setRefundAt(null); return undefined }
    let last = 0
    const onTouch = () => {
      const now = Date.now()
      if (now - last < 3000) return
      last = now
      restartCountdown()
      api.request('/middleware/client/keepalive', { method: 'POST', expect: 'json', headers: kioskHeaders(), skipAuth: true }).catch(() => {})
    }
    window.addEventListener('pointerdown', onTouch, true)
    window.addEventListener('keydown', onTouch, true)
    return () => {
      window.removeEventListener('pointerdown', onTouch, true)
      window.removeEventListener('keydown', onTouch, true)
    }
  }, [credit > 0, restartCountdown])

  // Safety net: while credit shows, ask the shop every 10 s, so a missed message can never leave a stale badge.
  useEffect(() => {
    if (!(credit > 0)) return undefined
    const t = setInterval(() => { syncFromShop() }, 10000)
    return () => clearInterval(t)
  }, [credit > 0, syncFromShop])

  // After a cash payment the money is spent: clear it here AND in the backend, otherwise it
  // would come back as phantom credit the next time the page loads.
  const resetCredit = () => {
    setCredit(0)
    setRefundAt(null)
    api.request('/middleware/client/reset', { method: 'POST', expect: 'json', headers: kioskHeaders(), skipAuth: true }).catch(() => {})
  }

  function addToCart(item) {
    // If item represents a machine (has an _id or id and is not a recharge), disallow adding the same
    // machine twice — it's physically impossible to run the same machine concurrently in the kiosk.
    const isRecharge = item.id && String(item.id).startsWith('recharge')
    const baseId = item._id || item.id

    if (!isRecharge && baseId) {
      // If cart already contains the same product, show a toast and skip adding
      const already = cart.some((c) => (c.productId || c._id || c.id) === String(baseId))
      if (already) {
        // Dynamic import to avoid eager dependency on Toast provider at module load
        import('@/components/ui/Toast').then(({ toast }) => toast({ title: i18n.t('alreadyInCart', { ns: 'cart' }), description: i18n.t('alreadyInCartHint', { ns: 'cart' }), variant: 'warning' })).catch(() => {})
        return false
      }
    }

    // Generate a unique cart item id so multiple adds of the same product don't produce duplicate React keys.
    // Preserve 'recharge-...' ids (used for card recharges) so the payment flow detects them, and keep original
    // product id in `productId` for backend persistence.
    const id = isRecharge ? item.id : `${baseId || 'cart'}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
    const normalized = { ...item, id, productId: baseId }

    setCart((c) => [...c, normalized])
    return true
  }

  // Dryers are sold in blocks of `tImp` minutes (15): the customer picks how many, 1..MAX_BLOCKS.
  function setQuantity(id, q) {
    setCart((c) => c.map((i) => {
      if (i.id !== id || i.type !== 'dry') return i
      const n = Math.max(1, Math.min(MAX_BLOCKS, Math.floor(Number(q)) || 1))
      return { ...i, quantity: n }
    }))
  }

  function removeFromCart(id) {
    setCart((c) => c.filter((i) => i.id !== id))
  }

  // A recharge only makes sense while its card is in the reader: when the card goes, its pending top-ups go too.
  function removeRecharges() {
    let removed = false
    setCart((c) => { const rest = c.filter((i) => !(i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge')))); removed = rest.length !== c.length; return rest })
    return removed
  }

  function clearCart() {
    setCart([])
  }

  function openCart() {
    // Emit browser event consumed by App to open the cart modal
    try { window.dispatchEvent(new CustomEvent('open-cart')) } catch (e) { console.warn('openCart event failed', e) }
  }

  const value = { cart, addToCart, setQuantity, removeFromCart, removeRecharges, clearCart, openCart, credit, resetCredit, refundAt, refundAfter }
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

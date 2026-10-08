import React, { createContext, useContext, useState, useEffect } from 'react'
import { subscribe } from '@/services/websocket'

const CartContext = createContext()

export const useCart = () => useContext(CartContext)

export const CartProvider = ({ children }) => {
  const [cart, setCart] = useState([])

  // Cash (coins/bills) the customer has put in and not yet spent. Lives here, not in the
  // cart window, so it shows from the moment the first coin lands — before any machine is
  // chosen — and survives opening and closing the cart.
  const [credit, setCredit] = useState(0)
  useEffect(() => {
    return subscribe((data) => {
      if (!data || data.type !== 'peripheral:credit') return
      const amount = Number(data.payload?.amount)
      if (!(amount > 0)) return
      setCredit((c) => Math.round((c + amount) * 100) / 100)
      import('@/components/ui/Toast').then(({ toast }) => toast({ title: `Dinheiro inserido: ${amount.toFixed(2)}€`, variant: 'success' })).catch(() => {})
    })
  }, [])
  const resetCredit = () => setCredit(0)

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
        import('@/components/ui/Toast').then(({ toast }) => toast({ title: 'Máquina já no carrinho', description: 'Não é possível adicionar a mesma máquina duas vezes', variant: 'warning' })).catch(() => {})
        return
      }
    }

    // Generate a unique cart item id so multiple adds of the same product don't produce duplicate React keys.
    // Preserve 'recharge-...' ids (used for card recharges) so the payment flow detects them, and keep original
    // product id in `productId` for backend persistence.
    const id = isRecharge ? item.id : `${baseId || 'cart'}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
    const normalized = { ...item, id, productId: baseId }

    setCart((c) => [...c, normalized])
  }

  function removeFromCart(id) {
    setCart((c) => c.filter((i) => i.id !== id))
  }

  function clearCart() {
    setCart([])
  }

  function openCart() {
    // Emit browser event consumed by App to open the cart modal
    try { window.dispatchEvent(new CustomEvent('open-cart')) } catch (e) { console.warn('openCart event failed', e) }
  }

  const value = { cart, addToCart, removeFromCart, clearCart, openCart, credit, resetCredit }
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

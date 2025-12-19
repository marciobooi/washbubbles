import React, { createContext, useContext, useState } from 'react'

const CartContext = createContext()

export const useCart = () => useContext(CartContext)

export const CartProvider = ({ children }) => {
  const [cart, setCart] = useState([])

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

  const value = { cart, addToCart, removeFromCart, clearCart, openCart }
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

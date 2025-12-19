import React, { createContext, useContext, useState } from 'react'

const CartContext = createContext()

export function useCart() {
  return useContext(CartContext)
}

export function CartProvider({ children }) {
  const [cart, setCart] = useState([])

  function addToCart(item) {
    // Ensure every cart item has a stable `id` for React keying and removal
    const normalized = { ...item, id: item.id || item._id || `cart-${Date.now()}-${Math.random().toString(36).slice(2,8)}` }
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

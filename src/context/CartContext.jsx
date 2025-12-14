import React, { createContext, useContext, useState } from 'react'

const CartContext = createContext()

export function useCart() {
  return useContext(CartContext)
}

export function CartProvider({ children }) {
  const [cart, setCart] = useState([])

  function addToCart(item) {
    setCart((c) => [...c, item])
  }

  function removeFromCart(id) {
    setCart((c) => c.filter((i) => i.id !== id))
  }

  function clearCart() {
    setCart([])
  }

  const value = { cart, addToCart, removeFromCart, clearCart }
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

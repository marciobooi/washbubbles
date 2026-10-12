import React from 'react'
import { CartContext } from '@/context/CartContext'
import CartModal from '@/components/CartModal'

/**
 * DEV ONLY (route /dev/cart, not registered in production builds): the payment window with a fake cart and a
 * fake cash credit, to look at the design without the shop hardware. Coins are simulated with the buttons.
 */
export default function DevCartPreview() {
  const [kind, setKind] = React.useState('dry')
  const [credit, setCredit] = React.useState(0)
  const [cart, setCart] = React.useState([])

  React.useEffect(() => {
    setCart(kind === 'dry'
      ? [{ id: 'dry-1', _id: 'dry-1', productId: 'dry-1', name: 'Secar 8', number: 8, type: 'dry', weight: 18, tImp: 15, cashPrice: 2, cardPrice: 1.8, price: 1.8, quantity: 4 }]
      : kind === 'wash'
        ? [{ id: 'w-1', _id: 'w-1', productId: 'w-1', name: 'Lavar 4', number: 4, type: 'wash', weight: 12, cashPrice: 7, cardPrice: 6.5, price: 6.5 }]
        : [
            { id: 'dry-1', _id: 'dry-1', productId: 'dry-1', name: 'Secar 8', number: 8, type: 'dry', weight: 18, tImp: 15, cashPrice: 2, cardPrice: 1.8, price: 1.8, quantity: 2 },
            { id: 'w-1', _id: 'w-1', productId: 'w-1', name: 'Lavar 4', number: 4, type: 'wash', weight: 12, cashPrice: 7, cardPrice: 6.5, price: 6.5 },
          ])
  }, [kind])

  const value = {
    cart,
    addToCart: () => {},
    removeFromCart: (id) => setCart((c) => c.filter((i) => i.id !== id)),
    clearCart: () => setCart([]),
    openCart: () => {},
    setQuantity: (id, q) => setCart((c) => c.map((i) => (i.id === id && i.type === 'dry' ? { ...i, quantity: Math.max(1, Math.min(8, q)) } : i))),
    credit,
    resetCredit: () => setCredit(0),
    refundAt: null,
    refundAfter: 120,
  }

  return (
    <CartContext.Provider value={value}>
      <div className="p-4 flex flex-wrap gap-2 items-center bg-neutral-100">
        <b>Preview:</b>
        {['dry', 'wash', 'mixed'].map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`px-3 py-1 rounded border ${kind === k ? 'bg-teal-600 text-white' : 'bg-white'}`}>{k}</button>
        ))}
        <span className="mx-2">| insert:</span>
        {[0.5, 1, 2, 5, 10].map((v) => (
          <button key={v} onClick={() => setCredit((c) => Math.round((c + v) * 100) / 100)} className="px-3 py-1 rounded border bg-white">+{v}€</button>
        ))}
        <button onClick={() => setCredit(0)} className="px-3 py-1 rounded border bg-white">reset</button>
      </div>
      <CartModal
        open
        onClose={() => {}}
        onPay={async (items, opts) => { alert('onPay ' + JSON.stringify({ opts, items: items.map((i) => ({ name: i.name, q: i.quantity })) })) }}
      />
    </CartContext.Provider>
  )
}

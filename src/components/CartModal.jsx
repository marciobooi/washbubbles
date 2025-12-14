import React from 'react'
import Modal from './Modal'
import { useCart } from '../context/CartContext'

export default function CartModal({ open, onClose, onPay = () => {}, onClear = () => {} }) {
  const { cart, removeFromCart, clearCart } = useCart()
  const total = cart.reduce((s, i) => s + (i.price || 0), 0)

  function handlePay() {
    onPay(cart)
    clearCart()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Carrinho">
      <div className="flex flex-col gap-4">
        {cart.length === 0 ? (
          <div className="text-neutral-600">Carrinho vazio</div>
        ) : (
          cart.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{i.name}</div>
                <div className="text-sm text-neutral-600">{i.price.toFixed(2)}€</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-1 rounded border" onClick={() => removeFromCart(i.id)}>Remover</button>
              </div>
            </div>
          ))
        )}

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="text-lg font-semibold">Total</div>
          <div className="text-lg font-semibold">{total.toFixed(2)}€</div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={handlePay} className="btn-primary px-4 py-2 rounded">Pagar</button>
          <button onClick={() => { clearCart(); onClear() }} className="px-4 py-2 rounded border">Limpar</button>
        </div>
      </div>
    </Modal>
  )
}

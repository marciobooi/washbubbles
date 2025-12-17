import React from 'react'
import Modal from './Modal'
import { useCart } from '../context/CartContext'

export default function CartModal({ open, onClose, onPay = () => {}, onClear = () => {} }) {
  const { cart, removeFromCart, clearCart } = useCart()
  const [useFidelity, setUseFidelity] = React.useState(false)
  const total = cart.reduce((s, i) => s + (i.price || 0), 0)
  const discountedTotal = cart.reduce((s, i) => s + Math.max(0, (i.price || 0) - (useFidelity ? 0.5 : 0)), 0)
  
  // Check if cart contains recharge items
  const hasRecharge = cart.some(item => item.type === 'Recarga de Cartão')

  function handlePay() {
    onPay(cart, { useFidelity: hasRecharge ? false : useFidelity })
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
                <div className="text-sm text-neutral-600">
                  {useFidelity ? `${Math.max(0, i.price - 0.5).toFixed(2)}€ (fidelidade)` : `${i.price.toFixed(2)}€`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-1 rounded border" onClick={() => removeFromCart(i.id)}>Remover</button>
              </div>
            </div>
          ))
        )}

        {!hasRecharge && (
          <div className="flex items-center justify-between pt-2 border-t">
            <label className="flex items-center gap-2">
              <input 
                type="checkbox" 
                checked={useFidelity} 
                onChange={(e) => setUseFidelity(e.target.checked)} 
              />
              <span className="text-sm">Pagar com cartão fidelidade (-0,50€ por item)</span>
            </label>
            <div className="text-lg font-semibold">{(useFidelity ? discountedTotal : total).toFixed(2)}€</div>
          </div>
        )}

        {hasRecharge && (
          <div className="pt-2 border-t">
            <div className="text-lg font-semibold text-right">{total.toFixed(2)}€</div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={handlePay} className="btn-primary px-4 py-2 rounded">Pagar</button>
          <button onClick={() => { clearCart(); onClear() }} className="px-4 py-2 rounded border">Limpar</button>
        </div>
      </div>
    </Modal>
  )
}

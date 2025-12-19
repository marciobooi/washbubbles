import React from 'react'
import Modal from './ui/Modal'
import { useCart } from '../context/CartContext'
import CashModal from './CashModal'

export default function CartModal({ open, onClose, onPay = () => {}, onClear = () => {} }) {
  const { cart, removeFromCart, clearCart } = useCart()
  const [useFidelity, setUseFidelity] = React.useState(false)
  const [showCash, setShowCash] = React.useState(false)
  const total = cart.reduce((s, i) => s + (i.price || 0), 0)
  const discountedTotal = cart.reduce((s, i) => s + Math.max(0, (i.price || 0) - (useFidelity ? 0.5 : 0)), 0)
  
  // Check if cart contains recharge items
  const hasRecharge = cart.some(item => item.type === 'Recarga de Cartão')

  function handleCardPay() {
    // Pay immediately with card (or fidelity) — close cart
    onPay(cart, { useFidelity: hasRecharge ? false : useFidelity, method: 'card' })
    onClose()
  }

  function openCashModal() {
    setShowCash(true)
  }

  async function handleCashConfirm(inserted) {
    const finalTotal = Number(!hasRecharge && useFidelity ? discountedTotal : total)
    // Call onPay with cash method and inserted amount
    onPay(cart, { useFidelity: hasRecharge ? false : useFidelity, method: 'cash', inserted })
    setShowCash(false)
    onClose()
  }

  return (
    <>
    <Modal open={open} onClose={onClose} title="Carrinho" hideClose={true}>
      <div className="flex flex-col gap-6">
        {cart.length === 0 ? (
          <div className="text-center py-8">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-3 opacity-20 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="text-neutral-400 mb-6">Carrinho vazio</p>
            <button 
              onClick={onClose}
              className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-semibold transition-all"
            >
              Fechar
            </button>
          </div>
        ) : (
          <>
            {/* Items List */}
            <div className="space-y-3">
              {cart.map((i) => (
                <div key={i.id} className="bg-neutral-50 p-4 rounded-lg relative group">
                  <button 
                    onClick={() => removeFromCart(i.id)}
                    className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-7 h-7 flex items-center justify-center shadow-lg transition-all active:scale-90"
                    aria-label="Remover item"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-neutral-800 pr-6">{i.name || i.type}</div>
                    <div className="text-lg font-bold text-neutral-800">
                      {!hasRecharge && useFidelity ? Math.max(0, i.price - 0.5).toFixed(2) : i.price.toFixed(2)}€
                    </div>
                  </div>
                  {!hasRecharge && useFidelity && (
                    <div className="text-xs text-green-600 mt-1">-0.50€ desconto fidelidade</div>
                  )}
                </div>
              ))}
            </div>

            {/* Fidelity Option */}
            {!hasRecharge && (
              <label className="flex items-center gap-3 p-4 bg-teal-50 rounded-lg cursor-pointer hover:bg-teal-100 transition-colors">
                <input 
                  type="checkbox" 
                  checked={useFidelity} 
                  onChange={(e) => setUseFidelity(e.target.checked)}
                  className="w-5 h-5"
                />
                <span className="text-sm font-medium text-neutral-700">
                  Pagar com cartão fidelidade <span className="text-teal-600 font-bold">(-0,50€ por item)</span>
                </span>
              </label>
            )}

            {/* Total */}
            <div className="flex items-center justify-between pt-4 border-t-2 border-neutral-200">
              <span className="text-xl font-bold text-neutral-700">Total</span>
              <span className="text-3xl font-bold text-teal-600">
                {(!hasRecharge && useFidelity ? discountedTotal : total).toFixed(2)}€
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button 
                onClick={handleCardPay} 
                className="flex-1 bg-teal-600 hover:bg-teal-700 text-white py-4 rounded-xl font-bold text-lg shadow-lg transition-all active:scale-[0.98]"
              >
                Pagar com Cartão
              </button>
              <button 
                onClick={openCashModal} 
                className="flex-1 bg-white border border-neutral-300 text-neutral-700 py-4 rounded-xl font-bold text-lg shadow-sm transition-all hover:bg-neutral-50"
              >
                Pagar (Dinheiro)
              </button>
              <button 
                onClick={() => { clearCart(); onClear() }} 
                className="px-6 py-4 rounded-xl border-2 border-neutral-300 text-neutral-600 hover:bg-neutral-50 font-semibold transition-all"
              >
                Limpar
              </button>
              <button 
                onClick={onClose}
                className="px-6 py-4 rounded-xl bg-neutral-100 text-neutral-700 hover:bg-neutral-200 font-semibold transition-all"
              >
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
    {/* cash insert modal */}
    <CashModal open={showCash} total={(!hasRecharge && useFidelity ? discountedTotal : total)} onClose={() => setShowCash(false)} onConfirm={handleCashConfirm} />
    </>
  )
}

import React from 'react'
import Modal from './ui/Modal'
import { useCart } from '../context/CartContext'
import CashModal from './CashModal'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'

export default function CartModal({ open, onClose, onPay = () => {}, onClear = () => {} }) {
  const { cart, removeFromCart, clearCart } = useCart()
  const [showCash, setShowCash] = React.useState(false)
  const [cardError, setCardError] = React.useState(null)

  // Card-pay flow (loyalty card)
  const [showCardPrompt, setShowCardPrompt] = React.useState(false)
  const [cardCode, setCardCode] = React.useState('')
  const [checkingCard, setCheckingCard] = React.useState(false)
  const [cardBalance, setCardBalance] = React.useState(null)
  const [cardNeedsTopup, setCardNeedsTopup] = React.useState(false)
  const [topupAmount, setTopupAmount] = React.useState(0)

  // Separate purchase items (machines/services) from recharge items
  const purchaseTotal = cart.reduce((s, i) => (i.type === 'Recarga de Cartão' ? s : s + (i.price || i.amount || 0)), 0)
  const rechargeTotal = cart.reduce((s, i) => (i.type === 'Recarga de Cartão' ? s + (i.price || i.amount || 0) : s), 0)
  const total = purchaseTotal + rechargeTotal

  // Check if cart contains recharge items
  const hasRecharge = rechargeTotal > 0

  async function handleCardPay() {
    // If recharges already cover purchases, keep old behaviour (no external card required)
    const short = Math.max(0, Math.round((purchaseTotal - rechargeTotal) * 100) / 100)
    if (short <= 0) {
      // proceed with card payment using cart recharges
      onPay(cart, { method: 'card' })
      onClose()
      return
    }

    // Otherwise, prompt for card code so we can attempt to use a loyalty card
    setCardError(null)
    setCardCode('')
    setCardBalance(null)
    setCardNeedsTopup(false)
    setTopupAmount(0)
    setShowCardPrompt(true)
  }

  async function checkCardAndPay() {
    // Use central checkout to persist recharges and charge via card gateway
    setCheckingCard(true)
    setCardError(null)
    try {
      if (!cardCode) {
        setCardError('Insira o código do cartão')
        setCheckingCard(false)
        return
      }

      // Delegate payment to the main handler — it will persist recharges and charge machines using cardCode
      await onPay(cart, { method: 'card', cardCode })
      setShowCardPrompt(false)
      onClose()
    } catch (e) {
      console.error('Card payment failed', e)
      setCardError(e?.message || 'Erro ao processar pagamento com cartão')
    } finally {
      setCheckingCard(false)
    }
  }

  async function topupCardAndRetry() {
    // Attempt to recharge the card by topupAmount, then retry payment
    setCheckingCard(true)
    try {
      const amount = Number(topupAmount)
      if (!amount || amount <= 0) {
        setCardError('Insira um valor de recarga válido')
        setCheckingCard(false)
        return
      }

      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
      const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY

      // Use gateways topup for card code
      await api.gatewayTopupCard(cardCode, { amount }, { apiKey: kioskKey })

      toast({ title: `Cartão recarregado: +${amount.toFixed(2)}€`, variant: 'success' })
      // Now attempt payment again
      await checkCardAndPay()
    } catch (e) {
      console.error('Topup failed', e)
      setCardError('Erro ao recarregar cartão')
    } finally {
      setCheckingCard(false)
    }
  }

  function openCashModal() {
    setCardError(null)
    setShowCash(true)
  }

  async function handleCashConfirm(inserted) {
    // Call onPay with cash method and inserted amount
    onPay(cart, { method: 'cash', inserted })
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
                    onClick={(e) => {
                      e.stopPropagation()
                      // Remove item and close modal only if it was the last item
                      const remaining = cart.filter((x) => x.id !== i.id).length
                      removeFromCart(i.id)
                      if (remaining === 0) onClose()
                    }}
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
                      {(i.price || i.amount || 0).toFixed(2)}€
                    </div>
                  </div>
                </div>
              ))}
            </div>



            {/* Total */}
            <div className="flex items-center justify-between pt-4 border-t-2 border-neutral-200">
              <div>
                <div className="text-sm text-neutral-500">Total a pagar</div>
                <div className="text-2xl font-bold text-neutral-800">{purchaseTotal.toFixed(2)}€</div>
                {hasRecharge && <div className="text-sm text-neutral-600">Saldo no carrinho: <span className="font-semibold">{rechargeTotal.toFixed(2)}€</span></div>}
                {cardError && <div className="text-sm text-red-600 font-semibold mt-2">{cardError}</div>}
              </div>

              <div className="text-3xl font-bold text-teal-600">{total.toFixed(2)}€</div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button 
                onClick={handleCardPay} 
                className={`flex-1 py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3 ${purchaseTotal > rechargeTotal ? 'bg-teal-500 hover:bg-teal-600 text-white shadow-lg' : 'bg-teal-600 hover:bg-teal-700 text-white shadow-lg'}`}
              >
                {/* Card icon */}
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 6h18M5 14h.01M9 14h6" />
                </svg>
                <span>Cartão</span>
              </button>

              <button 
                onClick={openCashModal} 
                className="flex-1 bg-white border border-neutral-300 text-neutral-700 py-4 rounded-xl font-bold text-lg shadow-sm transition-all hover:bg-neutral-50 flex items-center justify-center gap-3"
              >
                {/* Note: Cash payments will open a cash modal that accepts inserted amount. */}
                {/* Cash icon */}
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6M7 10h10M7 6h10" />
                </svg>
                <span>Dinheiro</span>
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
      {/* Card pay prompt */}
      {showCardPrompt && (
        <Modal open={showCardPrompt} onClose={() => setShowCardPrompt(false)} title="Pagar com Cartão">
          <div className="flex flex-col gap-4">
            <label className="text-sm">Código do cartão</label>
            <input value={cardCode} onChange={(e) => setCardCode(e.target.value)} className="p-3 rounded-lg border" placeholder="Insira o código do cartão" />
            {checkingCard && <div className="text-sm text-neutral-500">A verificar...</div>}
            {cardError && <div className="text-sm text-red-600 font-semibold">{cardError}</div>}
            {cardBalance != null && <div className="text-sm text-neutral-600">Saldo do cartão: <span className="font-semibold">{cardBalance.toFixed(2)}€</span></div>}

            {cardNeedsTopup ? (
              <div className="flex flex-col gap-2">
                <label className="text-sm">Recarregar cartão</label>
                <div className="flex gap-2">
                  {[5,10,20].map((a)=> (
                    <button key={a} onClick={() => setTopupAmount(a)} className={`py-2 px-3 rounded-lg ${topupAmount===a?'bg-teal-600 text-white':'bg-neutral-100'}`}>{a}€</button>
                  ))}
                </div>
                <input value={topupAmount} onChange={(e)=>setTopupAmount(Number(e.target.value))} className="p-3 rounded-lg border" />
                <div className="flex gap-2">
                  <button onClick={() => setShowCardPrompt(false)} className="flex-1 py-2 rounded-lg border">Cancelar</button>
                  <button onClick={topupCardAndRetry} disabled={checkingCard} className={`flex-1 py-2 rounded-lg ${checkingCard ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}>Recarregar e pagar</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setShowCardPrompt(false)} className="flex-1 py-2 rounded-lg border">Cancelar</button>
                <button onClick={checkCardAndPay} disabled={checkingCard} className={`flex-1 py-2 rounded-lg ${checkingCard ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}>Confirmar pagamento</button>
              </div>
            )}
          </div>
        </Modal>
      )}

    </Modal>
    {/* cash insert modal */}
    <CashModal open={showCash} total={total} onClose={() => setShowCash(false)} onConfirm={handleCashConfirm} />
    </>
  )
}

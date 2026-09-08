import React, { useEffect, useState } from 'react'
import { useCart } from '../context/CartContext'
import { useTranslation } from 'react-i18next'
import washIcon from '@/assets/washingmashine/L1.png'
import dryIcon from '@/assets/drymachine/S1.png'
import cardIcon from '@/assets/card/card.png'

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getTxIcon(type) {
  const t = type.toLowerCase()
  if (t.includes('lavagem')) return washIcon
  if (t.includes('secagem')) return dryIcon
  return cardIcon
}

// `onRecharge` used to be accepted here and never called — Pos.jsx passed a real
// handler that could therefore never fire. The cart-based flow superseded it.
export default function CardModal({ open, onClose, transactions = [], balance = 0 }) {
  const { addToCart } = useCart()
  const { t } = useTranslation('pos')
  const [selectedAmount, setSelectedAmount] = useState(10)
  const [addedToCart, setAddedToCart] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Prevent page scroll when CardModal is open, and restore on close
  React.useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    try { document.body.style.overflow = 'hidden' } catch { /* scroll-lock is cosmetic */ }
    return () => {
      try { document.body.style.overflow = prev } catch { /* scroll-lock is cosmetic */ }
    }
  }, [open])

  const handleAddToCart = () => {
    if (!selectedAmount || selectedAmount <= 0) return
    
    addToCart({
      id: `recharge-${Date.now()}`,
      name: `Recarga de Cartão - ${selectedAmount}€`,
      type: 'Recarga de Cartão',
      amount: selectedAmount,
      price: selectedAmount
    })
    
    // Visual feedback
    setAddedToCart(true)
    setTimeout(() => {
      setAddedToCart(false)
    }, 1500)
  }

  const incrementAmount = () => {
    setSelectedAmount(prev => Math.min(prev + 1, 100))
  }

  const decrementAmount = () => {
    setSelectedAmount(prev => Math.max(prev - 1, 1))
  }

  const handleQuickAmount = (amount) => {
    setSelectedAmount(amount)
  }

  // The manual "insert money / show change" widget was removed: nothing ever
  // called handleInsertMoney, so insertedMoney and showChange never changed and
  // the Troco block below could not render. Change is dispensed and reported by
  // the server (see the changeDispensed flag on the payment response).

  if (!open) return null

  return (
    <div className="fixed bg-white  inset-0 z-50 flex flex-col animate-fade-in-up overflow-hidden">
      {/* Header */}
      <div className="bg-white shadow-sm px-6 py-4 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-xl">
            <img src={cardIcon} alt="Card" className="w-8 h-8 object-contain" />
          </div>
          <h2 className="text-2xl font-bold text-neutral-800 tracking-tight">{t('card.title')}</h2>
        </div>
        <button 
          onClick={() => {
            if (window.electronAPI?.hideKeyboard) {
              window.electronAPI.hideKeyboard()
            }
            onClose()
          }}
          className="p-3 bg-neutral-100 hover:bg-neutral-200 active:bg-neutral-300 rounded-xl transition-colors group"
          aria-label="Fechar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-neutral-500 group-hover:text-neutral-800 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-grow overflow-hidden p-4 lg:p-6 ">
        <div className="h-full flex flex-col lg:grid lg:grid-cols-12 gap-4 lg:gap-8 max-w-7xl mx-auto">
          
          {/* Left Column: Balance & Actions */}
          <div className="shrink-0 ">
            <div className="bg-white rounded-3xl p-6 lg:p-8 shadow-xl border border-neutral-100 relative overflow-hidden group shrink-0 flex flex-col justify-between gap-6 h-full">
              <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-primary-50 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700"></div>
              
              {/* Balance & Info Section */}
              <div className="relative z-10 grid grid-cols-2 gap-4 items-center flex-grow">
                
                <div className="flex flex-col justify-center gap-4 border-r border-neutral-100 pr-4">
                  <div className="flex flex-col">
                    <span className="text-neutral-400 text-xs uppercase tracking-wider font-bold mb-1">{t('card.idLabel')}</span>
                    <span className="font-mono font-bold text-neutral-700 text-lg">**** 8821</span>
                  </div>
                  <div>
                    <span className="inline-flex items-center px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full text-xs font-bold shadow-sm gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                      {t('card.active')}
                    </span>
                  </div>
                </div>

                <div className="text-right flex flex-col justify-center h-full">
                  <p className="text-neutral-400 text-xs font-bold uppercase tracking-wider mb-1">{t('card.balanceLabel')}</p>
                  <p className="text-4xl lg:text-5xl font-bold tracking-tight text-primary-600">{balance.toFixed(2)}€</p>
                </div>

              </div>

              {/* Amount Selection with +/- Controls */}
              <div className="relative z-10 space-y-4">
                {/* Custom Amount with +/- */}
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={decrementAmount}
                    className="w-12 h-12 rounded-xl bg-neutral-100 hover:bg-neutral-200 active:bg-neutral-300 text-neutral-700 font-bold text-2xl transition-colors flex items-center justify-center"
                  >
                    −
                  </button>
                  
                  <div className="flex flex-col items-center">
                    <span className="text-neutral-400 text-xs uppercase tracking-wider font-bold mb-1">Valor de Recarga</span>
                    <span className="text-5xl font-bold text-primary-600">{selectedAmount}€</span>
                  </div>
                  
                  <button
                    onClick={incrementAmount}
                    className="w-12 h-12 rounded-xl bg-neutral-100 hover:bg-neutral-200 active:bg-neutral-300 text-neutral-700 font-bold text-2xl transition-colors flex items-center justify-center"
                  >
                    +
                  </button>
                </div>

                {/* Quick Amount Buttons */}
                <div className="flex items-center gap-2">
                  {[5, 10, 20, 50].map((amount) => (
                    <button
                      key={amount}
                      onClick={() => handleQuickAmount(amount)}
                      className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all ${
                        selectedAmount === amount
                          ? 'bg-teal-600 text-white shadow-md'
                          : 'border border-teal-600 text-teal-600 hover:bg-teal-50'
                      }`}
                    >
                      {amount}€
                    </button>
                  ))}
                </div>

                
                {/* Add to Cart Button */}
                <button 
                  onClick={handleAddToCart}
                  disabled={!selectedAmount || selectedAmount <= 0 || addedToCart}
                  className={`w-full py-3 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 ${
                    addedToCart
                      ? 'bg-green-600 text-white shadow-lg shadow-green-600/30'
                      : selectedAmount > 0
                      ? 'bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-600/20 active:scale-[0.98]'
                      : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                  }`}
                >
                  {addedToCart ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {t('card.added')}
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      {t('card.addToCart')}
                    </>
                  )}
                </button>

                {/* Back/Close Button */}
                <button
                  onClick={() => {
                    if (window.electronAPI?.hideKeyboard) {
                      window.electronAPI.hideKeyboard()
                    }
                    onClose()
                  }}
                  className="w-full py-3 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border border-neutral-300 active:scale-[0.98]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Voltar
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Transactions */}
          <div className="flex-grow lg:col-span-7 bg-white rounded-3xl shadow-sm border border-neutral-100 flex flex-col overflow-hidden min-h-0">
            <div className="p-4 lg:p-6 border-b border-neutral-100 bg-neutral-50/50 shrink-0">
              <h3 className="text-lg lg:text-xl font-bold text-neutral-800">{t('card.transactionsTitle')}</h3>
            </div>
            
            <div className="flex-grow overflow-y-auto p-3 lg:p-4 custom-scrollbar">
              {transactions.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-neutral-400 gap-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p>Sem transações recentes</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {transactions.map((tx) => {
                    const isPositive = tx.amount >= 0
                    return (
                      <div key={tx.id} className="group bg-white p-4 rounded-2xl border border-neutral-100 border-primary-200 shadow-md transition-all duration-200 flex items-center gap-5">
                        {/* Icon Box */}
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${isPositive ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                          <img 
                            src={getTxIcon(tx.type)} 
                            alt="" 
                            className="w-9 h-9 object-contain tealFilter"
                          />
                        </div>

                        {/* Details */}
                        <div className="flex-grow min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="font-bold text-neutral-800 text-lg truncate">{t(`transactions.${tx.type}`)}</h4>
                            <span className={`font-bold text-xl ${isPositive ? 'text-green-600' : 'text-neutral-800'}`}>
                              {isPositive ? '+' : ''}{tx.amount.toFixed(2)}€
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-neutral-500">
                            <span className="flex items-center gap-1.5 tealFilter">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              {formatDate(tx.ts)}
                            </span>
                            <span className="flex items-center gap-1.5 tealFilter">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {formatTime(tx.ts)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    
  )
}

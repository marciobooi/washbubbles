import React, { useEffect } from 'react'

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
  if (t.includes('lavagem')) return '/washingmashine/L1.png'
  if (t.includes('secagem')) return '/drymachine/S1.png'
  return '/card/card.png'
}

export default function CardModal({ open, onClose, transactions = [], balance = 0, onRecharge = () => {} }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-neutral-50 flex flex-col animate-fade-in-up overflow-hidden">
      {/* Header */}
      <div className="bg-white shadow-sm px-6 py-4 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-xl">
            <img src="/card/card.png" alt="Card" className="w-8 h-8 object-contain" />
          </div>
          <h2 className="text-2xl font-bold text-neutral-800 tracking-tight">Meu Cartão</h2>
        </div>
        <button 
          onClick={onClose}
          className="p-3 bg-neutral-100 hover:bg-neutral-200 active:bg-neutral-300 rounded-xl transition-colors group"
          aria-label="Fechar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-neutral-500 group-hover:text-neutral-800 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-grow overflow-hidden p-4 lg:p-6">
        <div className="h-full flex flex-col lg:grid lg:grid-cols-12 gap-4 lg:gap-8 max-w-7xl mx-auto">
          
          {/* Left Column: Balance & Actions */}
          <div className="shrink-0 lg:col-span-5 flex flex-col gap-4 lg:gap-6 overflow-y-auto lg:overflow-visible custom-scrollbar max-h-[40vh] lg:max-h-none">
            <div className="bg-gradient-to-br from-primary-600 to-primary-800 rounded-3xl p-6 lg:p-8 text-white shadow-xl relative overflow-hidden group shrink-0">
              <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
              
              <p className="text-primary-100 text-base lg:text-lg font-medium uppercase tracking-wider mb-1 lg:mb-2">Saldo Disponível</p>
              <p className="text-4xl lg:text-6xl font-bold tracking-tight mb-6 lg:mb-8">{balance.toFixed(2)}€</p>
              
              <button 
                onClick={() => {
                  const v = window.prompt('Valor para recarregar (€)', '10')
                  const amount = Number(v)
                  if (!isNaN(amount) && amount > 0) onRecharge(amount)
                }} 
                className="w-full bg-white text-primary-700 hover:bg-primary-50 active:scale-[0.98] py-3 lg:py-4 rounded-xl font-bold text-base lg:text-lg shadow-lg transition-all flex items-center justify-center gap-3"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Recarregar Saldo
              </button>
            </div>

            <div className="bg-white rounded-3xl p-4 lg:p-6 shadow-sm border border-neutral-100 shrink-0">
              <h3 className="text-lg font-bold text-neutral-800 mb-3 lg:mb-4">Informações</h3>
              <div className="space-y-3 lg:space-y-4">
                <div className="flex items-center justify-between p-3 lg:p-4 bg-neutral-50 rounded-xl">
                  <span className="text-neutral-500 text-sm lg:text-base">ID do Cartão</span>
                  <span className="font-mono font-semibold text-neutral-700 text-sm lg:text-base">**** 8821</span>
                </div>
                <div className="flex items-center justify-between p-3 lg:p-4 bg-neutral-50 rounded-xl">
                  <span className="text-neutral-500 text-sm lg:text-base">Estado</span>
                  <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs lg:text-sm font-medium">Ativo</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Transactions */}
          <div className="flex-grow lg:col-span-7 bg-white rounded-3xl shadow-sm border border-neutral-100 flex flex-col overflow-hidden min-h-0">
            <div className="p-4 lg:p-6 border-b border-neutral-100 bg-neutral-50/50 shrink-0">
              <h3 className="text-lg lg:text-xl font-bold text-neutral-800">Histórico de Transações</h3>
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
                  {transactions.map((t) => {
                    const isPositive = t.amount >= 0
                    return (
                      <div key={t.id} className="group bg-white p-4 rounded-2xl border border-neutral-100 hover:border-primary-200 hover:shadow-md transition-all duration-200 flex items-center gap-5">
                        {/* Icon Box */}
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${isPositive ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                          <img 
                            src={getTxIcon(t.type)} 
                            alt="" 
                            className="w-9 h-9 object-contain"
                            style={{ filter: isPositive ? 'none' : 'grayscale(20%)' }}
                          />
                        </div>

                        {/* Details */}
                        <div className="flex-grow min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="font-bold text-neutral-800 text-lg truncate">{t.type}</h4>
                            <span className={`font-bold text-xl ${isPositive ? 'text-green-600' : 'text-neutral-800'}`}>
                              {isPositive ? '+' : ''}{t.amount.toFixed(2)}€
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-neutral-500">
                            <span className="flex items-center gap-1.5">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              {formatDate(t.ts)}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {formatTime(t.ts)}
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

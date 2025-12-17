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
    <div className="fixed inset-0 z-50 bg-neutral-100 flex flex-col animate-fade-in-up overflow-hidden">
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
          <div className="shrink-0 ">
            <div className="bg-white rounded-3xl p-6 lg:p-8 shadow-xl border border-neutral-100 relative overflow-hidden group shrink-0 flex flex-col justify-between gap-6 h-full">
              <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-primary-50 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700"></div>
              
              {/* Balance & Info Section */}
              <div className="relative z-10 grid grid-cols-2 gap-4 items-center flex-grow">
                
                <div className="flex flex-col justify-center gap-4 border-r border-neutral-100 pr-4">
                  <div className="flex flex-col">
                    <span className="text-neutral-400 text-xs uppercase tracking-wider font-bold mb-1">ID do Cartão</span>
                    <span className="font-mono font-bold text-neutral-700 text-lg">**** 8821</span>
                  </div>
                  <div>
                    <span className="inline-flex items-center px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full text-xs font-bold shadow-sm gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                      Ativo
                    </span>
                  </div>
                </div>

                <div className="text-right flex flex-col justify-center h-full">
                  <p className="text-neutral-400 text-xs font-bold uppercase tracking-wider mb-1">Saldo Disponível</p>
                  <p className="text-4xl lg:text-5xl font-bold tracking-tight text-primary-600">{balance.toFixed(2)}€</p>
                </div>

              </div>

              {/* Recharge Button */}
              <button 
                onClick={() => {
                  const v = window.prompt('Valor para recarregar (€)', '10')
                  const amount = Number(v)
                  if (!isNaN(amount) && amount > 0) onRecharge(amount)
                }} 
                className="relative z-10 w-full bg-teal-600 hover:bg-primary-700 text-white active:scale-[0.98] py-4 rounded-2xl font-bold text-lg shadow-lg shadow-primary-600/20 transition-all flex items-center justify-center gap-3 group/btn"
              >
         
                Recarregar Saldo
              </button>
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
                      <div key={t.id} className="group bg-white p-4 rounded-2xl border border-neutral-100 border-primary-200 shadow-md transition-all duration-200 flex items-center gap-5">
                        {/* Icon Box */}
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${isPositive ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                          <img 
                            src={getTxIcon(t.type)} 
                            alt="" 
                            className="w-9 h-9 object-contain tealFilter"
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
                            <span className="flex items-center gap-1.5 tealFilter">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              {formatDate(t.ts)}
                            </span>
                            <span className="flex items-center gap-1.5 tealFilter">
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

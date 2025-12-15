import React from 'react'
import Modal from './Modal'

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString()
}

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function CardModal({ open, onClose, transactions = [], balance = 0, onRecharge = () => {} }) {
  return (
    <Modal open={open} onClose={onClose} title="Meu Cartão">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold">Saldo: <span className="text-primary-800">{balance.toFixed(2)}€</span></div>
          <button onClick={() => {
            const v = window.prompt('Valor para recarregar (€)', '10')
            const amount = Number(v)
            if (!isNaN(amount) && amount > 0) onRecharge(amount)
          }} className="btn-primary px-3 py-2 rounded inline-flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v8m-4-4h8" />
            </svg>
            Recarregar
          </button>
        </div>

        <div className="overflow-auto max-h-80 rounded-md border bg-white">
          <table className="w-full table-fixed text-left">
            <thead className="bg-neutral-50">
              <tr className="text-sm text-neutral-600">
                <th className="w-1/4 p-3">Data</th>
                <th className="w-1/6 p-3">Hora</th>
                <th className="w-1/2 p-3">Tipo</th>
                <th className="w-1/6 p-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan={4} className="py-6 text-center text-neutral-600">Sem transações</td></tr>
              ) : (
                transactions.map((t) => (
                  <tr key={t.id} className="border-b hover:bg-neutral-50">
                    <td className="py-3 px-3 text-sm align-top">{formatDate(t.ts)}</td>
                    <td className="py-3 px-3 text-sm align-top">{formatTime(t.ts)}</td>
                    <td className="py-3 px-3 text-sm align-top flex items-center gap-2">
                      {t.amount >= 0 ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v8m-4-4h8" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                        </svg>
                      )}
                      <span>{t.type}</span>
                    </td>
                    <td className={`py-3 px-3 text-sm font-semibold text-right ${t.amount >= 0 ? 'text-green-700' : 'text-red-600'}`}>{t.amount >= 0 ? `+${t.amount.toFixed(2)}€` : `-${Math.abs(t.amount).toFixed(2)}€`}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}

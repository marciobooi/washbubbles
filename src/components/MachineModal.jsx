import React from 'react'
import Modal from './ui/Modal'
import useFrameAnimation from '../hooks/useFrameAnimation'

export default function MachineModal({ open, machine, frames, onClose, onAddToCart = () => {}, onPay = () => {} }) {
  const uid = machine? (machine._id || machine.id) : ''
  const seed = uid ? Array.from(String(uid)).reduce((s, c) => s * 31 + c.charCodeAt(0), 0) : 0
  const frame = useFrameAnimation(frames, 300, { seed })
  const [useFidelity, setUseFidelity] = React.useState(false)
  const [method, setMethod] = React.useState('card')
  const [inserted, setInserted] = React.useState('')

  if (!machine) return null

  return (
    <Modal open={open} onClose={onClose} title={machine.name}>
      <div className="flex flex-col items-center gap-4">
        {frame && <img src={frame} alt={machine.name} className="w-36 h-36 object-contain tealFilter" />}
        <div className="text-xl font-semibold">{machine.name}</div>
        <div className="text-neutral-600">{machine.weight} kg • {machine.price.toFixed(2)}€ por ciclo {useFidelity ? `(fidelidade ${Math.max(0, machine.price - 0.5).toFixed(2)}€)` : ''}</div>
        <div className={`py-1 px-3 rounded text-sm ${machine.status === 'free' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{machine.statusText || (machine.status === 'free' ? 'Livre' : 'Ocupado')}</div>

        <div className="flex gap-4 mt-3 items-center">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useFidelity} onChange={(e) => setUseFidelity(e.target.checked)} />
            <span className="text-sm">Pagar com cartão fidelidade (-0,50€)</span>
          </label>

          <div className="flex items-center gap-2">
            <label className="text-sm">Pagamento:</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="border rounded px-2 py-1">
              <option value="card">Cartão</option>
              <option value="cash">Dinheiro</option>
            </select>
          </div>
        </div>

        {method === 'cash' && (
          <div className="flex items-center gap-2">
            <label className="text-sm">Valor inserido (€)</label>
            <input value={inserted} onChange={(e) => setInserted(e.target.value)} type="number" step="0.01" min="0" className="border rounded px-3 py-1 w-28" />
          </div>
        )}

        <div className="flex gap-3 mt-3">
          <button onClick={() => { onAddToCart(machine); onClose() }} className="btn-primary px-4 py-2 rounded inline-flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4m1.6 8L5 21h14" />
            </svg>
            Adicionar ao carrinho
          </button>
          <button onClick={() => onPay(machine, { useFidelity, method, inserted: method === 'cash' ? Number(inserted || 0) : null })} className="px-4 py-2 rounded border inline-flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 6h18M7 14h10v6H7z" />
            </svg>
            Pagar
          </button>
        </div>
      </div>
    </Modal>
  )
}

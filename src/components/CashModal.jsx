import React from 'react'
import Modal from './ui/Modal'

export default function CashModal({ open, total = 0, onClose = () => {}, onConfirm = (inserted) => {} }) {
  const [inserted, setInserted] = React.useState(0)

  React.useEffect(() => {
    if (!open) setInserted(0)
  }, [open])

  const coins = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20]
  const formatted = (v) => (Math.round(v * 100) / 100).toFixed(2)

  const add = (v) => setInserted((s) => Math.round((s + v) * 100) / 100)
  const clear = () => setInserted(0)

  const change = Math.max(0, Math.round((inserted - total) * 100) / 100)
  const canConfirm = inserted + 0.0001 >= total // allow float fuzz

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="Inserir Dinheiro">
      <div className="flex flex-col gap-4">
        <div className="text-sm text-neutral-500">Total a pagar</div>
        <div className="text-3xl font-bold text-neutral-800">{formatted(total)}€</div>

        <div className="grid grid-cols-4 gap-3 mt-2">
          {coins.map((c) => (
            <button key={c} onClick={() => add(c)} className="py-2 px-3 rounded-lg bg-neutral-100 hover:bg-neutral-200 font-semibold">{formatted(c)}€</button>
          ))}
        </div>

        <div className="flex items-center justify-between mt-4">
          <div>
            <div className="text-xs text-neutral-500">Inserido</div>
            <div className="text-xl font-bold">{formatted(inserted)}€</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-neutral-500">Troco</div>
            <div className="text-xl font-bold text-green-600">{formatted(change)}€</div>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={clear} className="flex-1 py-2 rounded-lg border">Limpar</button>
          <button onClick={() => { if (canConfirm) { onConfirm(inserted); onClose() } }} disabled={!canConfirm} className={`flex-1 py-2 rounded-lg font-bold ${canConfirm ? 'bg-teal-600 text-white' : 'bg-neutral-100 text-neutral-400'}`}>
            Confirmar pagamento
          </button>
        </div>
      </div>
    </Modal>
  )
}
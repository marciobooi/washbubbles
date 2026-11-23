import React from 'react'
import { Sparkles, X } from 'lucide-react'

export default function CalibrationOverlay({ calibrating, onSkip, onCancel }) {
  if (!calibrating) return null
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center">
        <div className="text-xs font-semibold text-[#8a8478] uppercase tracking-wide mb-1">
          Calibração de {calibrating.type === 'coin' ? 'moedas' : 'notas'} — passo {calibrating.index + 1} de {calibrating.denoms.length}
        </div>
        <div className="w-16 h-16 rounded-full bg-[#a9e0bc] mx-auto my-4 flex items-center justify-center">
          <Sparkles className="h-7 w-7 text-[#0f2a2c]" />
        </div>
        <div className="text-2xl font-extrabold text-[#1c2530] mb-1">
          Insira {calibrating.type === 'coin' ? 'uma moeda de' : 'uma nota de'} {calibrating.denoms[calibrating.index]}€
        </div>
        <p className="text-sm text-[#8a8478] mb-1">A aguardar o aceitador detetar…</p>
        {calibrating.lastLearned && (
          <p className="text-xs text-emerald-600 font-medium mb-4">
            ✓ Último detetado: {calibrating.lastLearned.hexKey} → {calibrating.lastLearned.denomValue}€
          </p>
        )}
        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onSkip}
            className="flex-1 h-10 rounded-lg border border-black/[0.12] text-sm font-semibold text-[#1c2530] hover:bg-white hover:border-[var(--primary,#0d9488)] hover:text-[var(--primary,#0d9488)] transition"
          >
            Saltar esta {calibrating.type === 'coin' ? 'moeda' : 'nota'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-10 rounded-lg border border-black/[0.12] bg-white hover:bg-white hover:border-[var(--primary,#0d9488)] hover:text-[var(--primary,#0d9488)] text-sm font-semibold text-[#1c2530] transition inline-flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-[var(--primary,#0d9488)]"
          >
            <X className="h-3.5 w-3.5" /> Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

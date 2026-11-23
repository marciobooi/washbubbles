import React from 'react'
import { Cpu, Settings } from 'lucide-react'

function getStatusText(status) {
  switch (status) {
    case 'ok': return 'OK'
    case 'fault': return 'Avaria'
    case 'offline': return 'Offline'
    default: return 'Desconhecido'
  }
}

function getStatusDotColor(status) {
  switch (status) {
    case 'ok': return 'bg-green-500'
    case 'fault': return 'bg-red-500'
    case 'offline': return 'bg-neutral-400'
    default: return 'bg-yellow-400'
  }
}

export default function PeripheralCard({ peripheral, typeInfo, onToggle, onConfig }) {
  return (
    <div className="bg-white rounded-[20px] p-6 shadow-[0_1px_2px_rgba(20,25,30,0.04),0_8px_20px_-12px_rgba(20,25,30,0.08)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-[#eef2f5] flex items-center justify-center shrink-0">
          <Cpu className="h-5 w-5 text-[#4b5573]" strokeWidth={1.8} />
        </div>
        <div className="font-extrabold text-lg text-[#1c2530] truncate">{peripheral.name}</div>
      </div>

      <div className="bg-[#f7f5f1] rounded-2xl h-40 flex items-center justify-center mb-4 overflow-hidden">
        {typeInfo?.image ? (
          <img src={typeInfo.image} alt="" className="h-full w-full object-contain p-4" />
        ) : (
          <Cpu className="h-12 w-12 text-neutral-400" />
        )}
      </div>

      <div className="flex items-center gap-2 pb-4 mb-4 border-b border-black/[0.06]">
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${peripheral.enabled === false ? 'bg-neutral-400' : getStatusDotColor(peripheral.status)}`} />
        <span className="text-sm font-medium text-[#1c2530]">{peripheral.enabled === false ? 'Desativada (fora de serviço)' : getStatusText(peripheral.status)}</span>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          role="switch"
          aria-checked={peripheral.enabled}
          onClick={() => onToggle(peripheral)}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${peripheral.enabled ? 'bg-[#a9e0bc]' : 'bg-neutral-300'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${peripheral.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>

        <button
          onClick={() => onConfig(peripheral)}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-black/[0.12] bg-white hover:bg-white hover:border-[var(--primary,#0d9488)] hover:text-[var(--primary,#0d9488)] text-sm font-semibold text-[#1c2530] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[var(--primary,#0d9488)]"
        >
          <Settings className="h-4 w-4" strokeWidth={1.8} />
          Configurar
        </button>
      </div>
    </div>
  )
}

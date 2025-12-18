import React from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import useFrameAnimation from '../hooks/useFrameAnimation'
import Wave from '../components/ui/wave'

export default function MachineDetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type') || 'wash'
  const navigate = useNavigate()

  const frames = type === 'wash'
    ? ['/washingmashine/L1.png', '/washingmashine/L2.png', '/washingmashine/L3.png', '/washingmashine/L4.png']
    : ['/drymachine/S1.png', '/drymachine/S2.png', '/drymachine/S3.png', '/drymachine/S4.png']

  const machines = [
    { id: 'm1', name: 'Maquina Lavar 1', weight: 12, price: 3.5, status: 'free', statusText: 'Livre' },
    { id: 'm2', name: 'Maquina Lavar 2', weight: 8, price: 2.5, status: 'working', statusText: 'Ocupado' },
    { id: 'm3', name: 'Maquina Lavar 3', weight: 18, price: 4.5, status: 'free', statusText: 'Livre' },
  ]

  const machine = machines.find((m) => m.id === id) || machines[0]
  const seed = Array.from(String(machine.id)).reduce((s, c) => s * 31 + c.charCodeAt(0), 0)
  const frame = useFrameAnimation(frames, 300, { seed })

  return (
    <div className='flex-1 container mx-auto p-4'>
    <div className="relative pb-[12vh] z-10">
      <div className="glass-card p-6 flex flex-col items-center gap-4">
        {frame && <img src={frame} alt={machine.name} className="w-40 h-40 object-contain" />}
        <div className="text-2xl font-semibold">{machine.name}</div>
        <div className="text-neutral-600">{machine.weight} kg • {machine.price.toFixed(2)}€ por ciclo • {Math.max(0, machine.price - 0.5).toFixed(2)}€ fidelidade</div>
        <div className={`py-2 px-4 rounded ${machine.status === 'free' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{machine.statusText || (machine.status === 'free' ? 'Livre' : 'Ocupado')}</div>
      </div>
      <Wave height="12vh" className="mt-2" />
    </div>
    </div>
  )
}

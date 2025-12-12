import React from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import MachineCard from '../components/MachineCard'
import Wave from '../components/wave'

export default function Machines() {
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type') || 'wash'
  const navigate = useNavigate()

  const frames = type === 'wash'
    ? ['/washingmashine/L1.png', '/washingmashine/L2.png', '/washingmashine/L3.png', '/washingmashine/L4.png']
    : ['/drymachine/S1.png', '/drymachine/S2.png', '/drymachine/S3.png', '/drymachine/S4.png']

  // Mock machines — replace with API call later
  const machines = [
    { id: 'm1', name: 'Maquina Lavar 1', weight: 12, price: 3.5, status: 'free' },
    { id: 'm2', name: 'Maquina Lavar 2', weight: 8, price: 2.5, status: 'working' },
    { id: 'm3', name: 'Maquina Lavar 3', weight: 18, price: 4.5, status: 'free' },
  ]

  return (
    <div className="relative pb-[12vh] z-10">
      <h2 className="p-4 text-center text-xl font-semibold mb-4">Selecionar máquina ({type})</h2>
      <div className="grid gap-4">
        {machines.map((m) => (
          <MachineCard key={m.id} m={m} frames={frames} onSelect={(id) => navigate(`/pos/machines/${id}?type=${type}`)} />
        ))}
      </div>
      <Wave height="12vh" className="mt-2" />
    </div>
  )
}

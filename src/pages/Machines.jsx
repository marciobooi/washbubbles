import React from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import MachineCard from '../components/MachineCard'
import MachineModal from '../components/MachineModal'
import Toast from '../components/Toast'
import Wave from '../components/wave'
import { useCart } from '../context/CartContext'

export default function Machines() {
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type') || 'wash'
  const navigate = useNavigate()

  const frames = type === 'wash'
    ? ['/washingmashine/L1.png', '/washingmashine/L2.png', '/washingmashine/L3.png', '/washingmashine/L4.png']
    : ['/drymachine/S1.png', '/drymachine/S2.png', '/drymachine/S3.png', '/drymachine/S4.png']

  // Mock machines — replace with API call later
  const machines = [
    { id: 'm1', name: 'Maquina Lavar 1', weight: 12, price: 3.5, status: 'free', statusText: 'Livre' },
    { id: 'm2', name: 'Maquina Lavar 2', weight: 8, price: 2.5, status: 'working', statusText: 'Ocupado' },
    { id: 'm3', name: 'Maquina Lavar 3', weight: 18, price: 4.5, status: 'free', statusText: 'Livre' },
  ]

  const [selected, setSelected] = React.useState(null)
  const { addToCart, clearCart } = useCart()
  const [modalOpen, setModalOpen] = React.useState(false)
  const [toastOpen, setToastOpen] = React.useState(false)
  const [toastMessage, setToastMessage] = React.useState('')
  const [toastType, setToastType] = React.useState('success')

  function openModalFor(m) {
    setSelected(m)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setSelected(null)
  }

  function handleAddToCart(m) {
    addToCart(m)
    // Simple feedback for now
    setToastMessage(`${m.name} adicionado ao carrinho`)
    setToastType('success')
    setToastOpen(true)
    console.log('Added to cart', m)
  }

  function pay(m) {
    console.log('Pay for', m)
    // For now, emulate payment by clearing cart and closing modal
    clearCart()
    closeModal()
    setToastMessage(`Pagamento efetuado`)
    setToastType('success')
    setToastOpen(true)
  }

  return (
    <div className="relative pb-[12vh] z-10">
      <h2 className="p-4 text-center text-xl font-semibold mb-4">Selecionar máquina ({type})</h2>
      <div className="grid gap-4">
        {machines.map((m) => (
          <MachineCard key={m.id} m={m} frames={frames} onSelect={(id) => { const mFound = machines.find((x) => x.id === id); if (mFound) openModalFor(mFound) }} />
        ))}
      </div>
      <MachineModal open={modalOpen} machine={selected} frames={frames} onClose={closeModal} onAddToCart={handleAddToCart} onPay={pay} />
      <Toast open={toastOpen} message={toastMessage} type={toastType} onClose={() => setToastOpen(false)} />
      <Wave height="12vh" className="mt-2" />
    </div>
  )
}

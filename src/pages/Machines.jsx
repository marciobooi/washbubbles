import React from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { usePayment } from '../context/PaymentContext'
import MachineCard from '../components/MachineCard'
import MachineModal from '../components/MachineModal'
import Toast from '../components/ui/Toast'
import Wave from '../components/ui/wave'
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
  const { processPayment } = usePayment()
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

  async function pay(m, opts = { useFidelity: false }) {
    try {
      const res = await processPayment([m], opts)
      if (res.success) {
        closeModal()
        setToastMessage(`Pagamento efetuado (${res.method})`)
        setToastType('success')
        setToastOpen(true)
      }
    } catch (e) {
      setToastMessage('Erro no pagamento')
      setToastType('error')
      setToastOpen(true)
    }
  }

  return (
    <div className='flex-1 container mx-auto p-4'>
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
    </div>
  )
}

import { Link, Routes, Route, Navigate } from 'react-router-dom'
import React from 'react'
import Pos from './pages/Pos'
import Machines from './pages/Machines'
import MachineDetail from './pages/MachineDetail'
import Admin from './pages/Admin'
import { CartProvider, useCart } from './context/CartContext'
import { PaymentProvider, usePayment } from './context/PaymentContext'
import CartModal from './components/CartModal'
import Toast from './components/Toast'

export default function App() {
  return (
    <PaymentProvider>
      <CartProvider>
        <AppInner />
      </CartProvider>
    </PaymentProvider>
  )
}

function AppInner() {
  const { cart } = useCart()
  const cartCount = cart.length
  const [cartOpen, setCartOpen] = React.useState(false)
  const [toastOpen, setToastOpen] = React.useState(false)
  const [toastMessage, setToastMessage] = React.useState('')

  const { processPayment } = usePayment()
  const { clearCart } = useCart()

  async function handlePay(items, opts = { useFidelity: false }) {
    try {
      const res = await processPayment(items, opts)
      if (res.success) {
        setToastMessage(`Pagamento efetuado (${res.method})`)
        setToastOpen(true)
        clearCart()
        setCartOpen(false)
        console.log('Paid for', items, res)
      }
    } catch (e) {
      setToastMessage('Erro no pagamento')
      setToastOpen(true)
      console.error(e)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary-50 via-primary-100 to-primary-200">
      <header className="p-4 border-b border-primary-100 bg-white/70 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-primary-800">Washstore</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/pos" className="inline-flex items-center p-2 rounded-md hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Home">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.75L12 3l9 6.75V20a1 1 0 0 1-1 1h-5.5a1 1 0 0 1-1-1V14a1 1 0 0 0-1-1H10a1 1 0 0 0-1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9.75z" />
              </svg>
              <span className="sr-only">Home</span>
            </Link>

            <button aria-label="Open cart" className="relative inline-flex items-center p-2 rounded-md hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" onClick={() => setCartOpen(true)}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4m1.6 8L5 21h14" />
              </svg>
              <span className="sr-only">Cart</span>
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-semibold leading-none text-white bg-red-600 rounded-full">{cartCount}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto p-4">
        <Routes>
          <Route path="/pos" element={<Pos />} />
          <Route path="/pos/machines" element={<Machines />} />
          <Route path="/pos/machines/:id" element={<MachineDetail />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/" element={<Navigate to="/pos" replace />} />
        </Routes>
      </main>

      <CartModal open={cartOpen} onClose={() => setCartOpen(false)} onPay={handlePay} />
      <Toast open={toastOpen} message={toastMessage} type="success" onClose={() => setToastOpen(false)} />
    </div>
  )
}

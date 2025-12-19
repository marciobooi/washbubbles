import { Link, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import React from 'react'
import Pos from './pages/Pos'
import Machines from './pages/Machines'
import MachineDetail from './pages/MachineDetail'
import Admin from './pages/Admin'
import { CartProvider, useCart } from './context/CartContext'
import { PaymentProvider, usePayment } from './context/PaymentContext'
import CartModal from './components/CartModal'
import { ToastProvider, toast } from './components/ui/Toast'
import HelpTutorial from './components/HelpTutorial'
import AdminDashboard from './pages/AdminDashboard'
import AdminUsers from './pages/AdminUsers'
import AdminMachines from './pages/AdminMachines'
import AdminTransactions from './pages/AdminTransactions'
import AdminOperations from './pages/AdminOperations'
import AdminSettings from './pages/AdminSettings'
import AdminProfile from './pages/AdminProfile'
import RequireAdmin from './components/RequireAdmin'

export default function App() {
  return (
    <PaymentProvider>
      <CartProvider>
        <ToastProvider>
          <AppInner />
        </ToastProvider>
      </CartProvider>
    </PaymentProvider>
  )
}

function AppInner() {
  const { cart } = useCart()
  const cartCount = cart.length
  const [cartOpen, setCartOpen] = React.useState(false)

  // Close the cart modal automatically when the cart becomes empty
  React.useEffect(() => {
    if (cartCount === 0) setCartOpen(false)
  }, [cartCount])

  const [helpOpen, setHelpOpen] = React.useState(false)
  const location = useLocation()

  const { processPayment } = usePayment()
  const { clearCart } = useCart()

  async function handlePay(items, opts = { useFidelity: false }) {
    try {
      const res = await processPayment(items, opts)
      if (res.success) {
        toast({ title: `Pagamento efetuado (${res.method})`, variant: 'success' })
        clearCart()
        setCartOpen(false)
        console.log('Paid for', items, res)
      }
    } catch (e) {
      toast({ title: 'Erro no pagamento', variant: 'destructive' })
      console.error(e)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary-50 via-primary-100 to-primary-200">
      {!location.pathname.startsWith('/admin') && (
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

              <button aria-label="Ajuda" className="inline-flex items-center p-2 rounded-md hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" onClick={() => setHelpOpen(true)} title="Ajuda">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="sr-only">Ajuda</span>
              </button>

              {cartCount > 0 && (
                <button aria-label="Open cart" className="relative inline-flex items-center p-2 rounded-md hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" onClick={() => setCartOpen(true)}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4m1.6 8L5 21h14" />
                  </svg>
                  <span className="sr-only">Cart</span>
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-semibold leading-none text-white bg-red-600 rounded-full">{cartCount}</span>
                </button>
              )}
            </div>
          </div>
        </header>
      )}

      <main className="">
        <Routes>
          <Route path="/pos" element={<Pos />} />
          <Route path="/pos/machines" element={<Machines />} />
          <Route path="/pos/machines/:id" element={<MachineDetail />} />

          {/* Admin login (public) */}
          <Route path="/admin/login" element={<Admin />} />

          {/* Protected admin area */}
          <Route path="/admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>}>
            <Route index element={<Navigate to="operations" replace />} />
            {/* Backwards-compat: support legacy /admin/dashboard URLs */}
            <Route path="dashboard" element={<Navigate to="operations" replace />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="machines" element={<AdminMachines />} />
            <Route path="transactions" element={<AdminTransactions />} />
            <Route path="operations" element={<AdminOperations />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="profile" element={<AdminProfile />} />
          </Route>
          <Route path="/" element={<Navigate to="/pos" replace />} />
        </Routes>
      </main>

      <CartModal open={cartOpen} onClose={() => setCartOpen(false)} onPay={handlePay} />
      <HelpTutorial run={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

import { Link, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import React from 'react'
import Pos from './pages/Pos'
import api from './services/api'
import { Home } from 'lucide-react'
import Machines from './pages/Machines'
import MachineDetail from './pages/MachineDetail'
import Admin from './pages/Admin'
import { CartProvider, useCart } from './context/CartContext'
import { PaymentProvider, usePayment } from './context/PaymentContext'
import CartModal from './components/CartModal'
import { ToastProvider, toast } from './components/ui/Toast'
import HelpTutorial from './components/HelpTutorial'
import LanguageSwitcher from './components/LanguageSwitcher'
import Modal from './components/ui/Modal'
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
  const { cart, clearCart } = useCart()
  const { processPayment } = usePayment()
  const cartCount = cart.length
  const [cartOpen, setCartOpen] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)
  // Count of externally-dispatched modal opens (e.g., CardModal in `Pos`)
  const [externalModalCount, setExternalModalCount] = React.useState(0)

  React.useEffect(() => {
    const onExternalOpen = () => setExternalModalCount((c) => c + 1)
    const onExternalClose = () => setExternalModalCount((c) => Math.max(0, c - 1))
    window.addEventListener('modal-open', onExternalOpen)
    window.addEventListener('modal-close', onExternalClose)
    return () => {
      window.removeEventListener('modal-open', onExternalOpen)
      window.removeEventListener('modal-close', onExternalClose)
    }
  }, [])

  const anyModalOpen = externalModalCount > 0 || cartOpen || helpOpen
  const location = useLocation()
  // Show compact Home button when any modal is open or when viewing machines (e.g. /pos/machines)
  const showHome = anyModalOpen || location.pathname.startsWith('/pos/machines')

  // Machine start notification state
  const [machineNotice, setMachineNotice] = React.useState({ open: false, names: [] })
  const noticeTimer = React.useRef(null)

  function closeMachineNotice() {
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current)
      noticeTimer.current = null
    }
    setMachineNotice({ open: false, names: [] })
  }

  function showMachineNotice(names = []) {
    if (!Array.isArray(names) || names.length === 0) return
    // normalize names
    const uniq = Array.from(new Set(names.filter(Boolean)))
    setMachineNotice({ open: true, names: uniq })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => {
      setMachineNotice({ open: false, names: [] })
      noticeTimer.current = null
    }, 20000)
  }

  React.useEffect(() => {
    const onEvent = (e) => {
      const names = (e && e.detail && e.detail.names) || []
      showMachineNotice(names)
    }
    window.addEventListener('machine-notice', onEvent)
    return () => window.removeEventListener('machine-notice', onEvent)
  }, [])

  // Close the cart modal automatically when the cart becomes empty
  React.useEffect(() => {
    if (cartCount === 0) setCartOpen(false)
  }, [cartCount])

  // Listen for open-cart events emitted by CartContext.openCart
  React.useEffect(() => {
    const onOpen = () => setCartOpen(true)
    window.addEventListener('open-cart', onOpen)
    return () => window.removeEventListener('open-cart', onOpen)
  }, [])

  async function handlePay(items, opts = { useFidelity: false }) {
    try {
      const method = opts && opts.method === 'cash' ? 'cash' : 'card'
      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
      const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY

      // generate a batch id to group these related sales
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2,8)}`

      if (method === 'cash') {
        // Validate cash via CashGateway (server-side gateway will persist sales atomically)
        const res = await processPayment(items, { method: 'cash', inserted: opts.inserted })
        if (!res.success) {
          // Forward meaningful errors to the user
          const msg = res.error?.message || (res.error && res.error.body && res.error.body.error) || 'Erro no pagamento com dinheiro'
          toast({ title: 'Pagamento falhou', description: msg, variant: 'destructive' })
          return
        }

        // Success: server already created sales and updated machines
        toast({ title: `Pagamento efetuado (Dinheiro)`, variant: 'success' })
        // Show machine notification for machines purchased (if any)
        try {
          const machineNames = items.filter(i => !(i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge')))).map(i => i.name).filter(Boolean)
          if (machineNames.length) showMachineNotice(machineNames)
        } catch (e) {}
        clearCart()
        setCartOpen(false)
        return
      }

      // Generic failure handling for gateways (only valid if `res` exists)
      if (typeof res !== 'undefined' && !res.success) {
        const status = res.error?.status || res.error?.response?.status
        const bodyError = res.error?.body?.error || res.error?.message || res.error
        if (status === 409) {
          toast({ title: 'Máquina já em uso', description: String(bodyError), variant: 'destructive' })
        } else {
          toast({ title: 'Falha no pagamento', description: String(bodyError), variant: 'destructive' })
        }
        return
      }

      // Card flow
      // If a cardCode is provided, use CardGateway to charge machines and post recharges server-side first
      const cardCode = opts.cardCode || null

      // first persist recharges (if any) — recharges are always card-based
      try {
        for (const it of items.filter(i => (i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge'))))) {
          const json = { amount: Number(it.amount), items: it, method: 'card', inserted: Number(it.amount), change: 0, batchId, cardCode }
          await api.request('/pos/recharge', { method: 'POST', json, headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined, skipAuth: true, expect: 'json' })
        }

        const machineItems = items.filter(i => !(i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge'))))

        if (cardCode && machineItems.length) {
          // Charge via CardGateway (calls /pos/cards/:code/spend per item)
          const res = await processPayment(machineItems, { method: 'card', cardCode, batchId, kioskKey })
          if (!res.success) {
            const status = res.error?.status || res.error?.response?.status
            const msg = res.error?.message || (res.error && res.error.body && res.error.body.error) || res.error || 'Erro desconhecido'
            if (status === 409) {
              toast({ title: 'Máquina já em uso', description: String(msg), variant: 'destructive' })
            } else {
              toast({ title: 'Erro no pagamento com cartão', description: String(msg), variant: 'destructive' })
            }
            return
          }

          // Show machine notification for machines purchased (if any)
          try {
            const machineNames = machineItems.map(i => i.name).filter(Boolean)
            if (machineNames.length) showMachineNotice(machineNames)
          } catch (e) {}

          toast({ title: `Pagamento efetuado (Cartão)`, variant: 'success' })
          clearCart()
          setCartOpen(false)
          return
        }

        // Fallback: no cardCode provided — persist machine sales as card payments using cart recharges
        for (const it of machineItems) {
          const machineId = it._id || it.id
          const payload = { machineId, amount: Number(it.price || it.amount || 0), items: [it], method: 'card', inserted: Number(it.price || it.amount || 0), change: 0, batchId }
          await api.request('/pos/sale', { method: 'POST', json: payload, headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined, skipAuth: true, expect: 'json' })
        }

        // Show machine notification for machines purchased (if any)
        try {
          const machineNames = machineItems.map(i => i.name).filter(Boolean)
          if (machineNames.length) showMachineNotice(machineNames)
        } catch (e) {}

        toast({ title: `Pagamento efetuado (Cartão)`, variant: 'success' })
        clearCart()
        setCartOpen(false)
      } catch (e) {
        console.warn('Failed to persist card transactions', e)
        const status = e?.status || e?.response?.status || (e?.body && e.body.status)
        const bodyError = (e && e.body && e.body.error) || e?.message || e
        if (status === 409 || String(bodyError).toLowerCase().includes('already in use')) {
          toast({ title: 'Máquina já em uso', description: String(bodyError), variant: 'destructive' })
        } else {
          toast({ title: 'Erro ao persistir transacções', variant: 'destructive' })
        }
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
              <Link to="/" className="inline-flex items-center gap-2 p-2 rounded-md hover:bg-white/60 focus:outline-none" title="Home">
                <Home className="h-5 w-5 text-primary-800" />
                <span className="text-xl font-semibold text-primary-800">Washstore</span>
              </Link>
            </div>
            <div className="flex items-center gap-3">
         


              {showHome && (
                <Link to="/pos" className="inline-flex items-center p-2 rounded-md hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Home">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.75L12 3l9 6.75V20a1 1 0 0 1-1 1h-5.5a1 1 0 0 1-1-1V14a1 1 0 0 0-1-1H10a1 1 0 0 0-1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9.75z" />
                  </svg>
                  <span className="sr-only">Home</span>
                </Link>
              )}

                         {cartCount > 0 && (
                <button aria-label="Abrir carrinho" className="relative inline-flex items-center p-2 rounded-md hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" onClick={() => setCartOpen(true)}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4m1.6 8L5 21h14" />
                  </svg>
                  <span className="sr-only">Carrinho</span>
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-semibold leading-none text-white bg-red-600 rounded-full">{cartCount}</span>
                </button>
              )}
     {location.pathname.startsWith('/pos') && <LanguageSwitcher />}

              <button aria-label="Ajuda" className="inline-flex items-center p-2 rounded-md hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" onClick={() => setHelpOpen(true)} title="Ajuda">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="sr-only">Ajuda</span>
              </button>

   
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

      <Modal open={machineNotice.open} onClose={closeMachineNotice} title={machineNotice.names.length === 1 ? `Máquina ${machineNotice.names[0]}` : 'Máquina Iniciada'}>
        <div className="p-4">
          {machineNotice.names.length === 1 ? (
            <div className="space-y-3">
              <p className="text-lg font-semibold">Dirija-se à máquina <span className="font-bold">{machineNotice.names[0]}</span></p>
              <p>Escolha o programa desejado e carregue <strong>Start</strong>. A máquina iniciará automaticamente.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-lg font-semibold">Dirija-se às máquinas <span className="font-bold">{machineNotice.names.join(', ')}</span></p>
              <p>Escolham o programa desejado e carreguem <strong>Start</strong>. As máquinas iniciarão automaticamente.</p>
            </div>
          )}
          <div className="mt-4 text-right">
            <button onClick={closeMachineNotice} className="px-4 py-2 bg-neutral-100 rounded-md hover:bg-neutral-200">Fechar</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

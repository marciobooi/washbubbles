import { Link, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Pos from './pages/Pos'
import api from './services/api'
import * as localApi from './services/local-api'
import { Home } from 'lucide-react'
import Machines from './pages/Machines'
import MachineDetail from './pages/MachineDetail'
import Admin from './pages/Admin'
import { CartProvider, useCart } from './context/CartContext'
import { PaymentProvider, usePayment } from './context/PaymentContext'
import CartModal from './components/CartModal'
import WifiQrModal from './components/WifiQrModal'
import ReceiptPrompt from './components/ReceiptPrompt'
import { ToastProvider, toast } from './components/ui/Toast'
import HelpTutorial from './components/HelpTutorial'
import LanguageSwitcher from './components/LanguageSwitcher'
import DevCartPreview from './pages/DevCartPreview'
import TenantSelector from './components/TenantSelector'
import { useTenant } from './context/TenantContext'
import Modal from './components/ui/Modal'
import AdminDashboard from './pages/AdminDashboard'
import AdminUsers from './pages/AdminUsers'
import AdminMachines from './pages/AdminMachines'
import AdminTransactions from './pages/AdminTransactions'
import AdminOperations from './pages/AdminOperations'
import AdminOverview from './pages/AdminOverview'
import AdminSettings from './pages/AdminSettings'
import AdminProfile from './pages/AdminProfile'
import AdminInterfaces from './pages/AdminInterfaces'
import AdminPeripherals from './pages/AdminPeripherals'
import AdminPrices from './pages/AdminPrices'
import AdminCards from './pages/AdminCards'
import AdminDayClose from './pages/AdminDayClose'
import AdminAuditLog from './pages/AdminAuditLog'
import AdminMaintenance from './pages/AdminMaintenance'
import AdminCoupons from './pages/AdminCoupons'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import RequireAdmin from './components/RequireAdmin'

import { BrandingProvider } from './context/BrandingContext'
import { KioskLockProvider } from './context/KioskLockContext'
import StaffMenu from './components/StaffMenu'
import KioskLockOverlay from './components/KioskLockOverlay'
import { TenantProvider } from './context/TenantContext'
import { useAuth } from './context/AuthContext'
import AdminTenants from './pages/AdminTenants'

// Set only for the public/cloud site build (docker-compose's frontend
// service). Local kiosk builds (electron, or the shop PC single-process
// install) leave this unset and keep landing on /pos as before.
const isPublicSite = import.meta.env.VITE_PUBLIC_SITE === 'true'

/**
 * A checkout id that is stable for a given cart, so a retried payment attempt is
 * recognisable as a replay rather than a new purchase.
 *
 * Cart item ids are already unique and stable for the life of the cart (see
 * CartContext), so hashing them identifies "this exact cart" without a clock or
 * a random suffix. Changing the cart — adding, removing, or editing a line —
 * legitimately produces a new id and therefore a genuinely new transaction.
 */
function checkoutBatchId(items) {
  const key = items.map((i) => `${i.id}:${i.price ?? i.amount ?? 0}`).sort().join('|')
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  }
  return `batch-${Math.abs(hash).toString(36)}`
}

export default function App() {
  return (
    <BrandingProvider>
      <TenantProvider>
        <PaymentProvider>
        <CartProvider>
          <ToastProvider>
            <KioskLockProvider>
              <AppInner />
            </KioskLockProvider>
          </ToastProvider>
        </CartProvider>
        </PaymentProvider>
      </TenantProvider>
    </BrandingProvider>
  )
}

// "devolução em 1:45": ticks once a second, only while there is credit waiting to be paid back.
function RefundCountdown({ at }) {
  const { t } = useTranslation('cart')
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!at) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [at])
  if (!at) return null
  const s = Math.max(0, Math.ceil((at - now) / 1000))
  return <span className="ml-2 text-sm font-medium text-white/90">· {t('refundIn', { time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` })}</span>
}

function AppInner() {
  const { cart, clearCart, credit, resetCredit, refundAt } = useCart()
  const { t } = useTranslation('cart')
  const tr = (key, opts) => t(key, opts)
  const { processPayment } = usePayment()
  const cartCount = cart.length
  const [cartOpen, setCartOpen] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)
  // Screens (machine list) can ask for the same tutorial the ? button opens
  React.useEffect(() => {
    const open = () => setHelpOpen(true)
    window.addEventListener('kiosk:open-help', open)
    return () => window.removeEventListener('kiosk:open-help', open)
  }, [])
  const [wifiVoucher, setWifiVoucher] = React.useState(null)
  const [receiptBatchId, setReceiptBatchId] = React.useState(null)
  const [receiptItems, setReceiptItems] = React.useState(null)
  // Auto-dismiss so a previous customer's "want a receipt?" card doesn't sit
  // in the corner through the next customer's whole visit.
  React.useEffect(() => {
    if (!receiptBatchId && !receiptItems) return
    const t = setTimeout(() => { setReceiptBatchId(null); setReceiptItems(null) }, 30000)
    return () => clearTimeout(t)
  }, [receiptBatchId, receiptItems])
  // Count of externally-dispatched modal opens (e.g., CardModal in `Pos`)
  const [externalModalCount, setExternalModalCount] = React.useState(0)

  // Branding (companyName / logo) pulled from settings
  const [branding, setBranding] = React.useState({ companyName: null, logo: null })

  // Tenant and auth hooks must be called at top-level
  const { tenantId, tenants } = useTenant()
  const { token } = useAuth()
  const tenant = React.useMemo(() => (tenants || []).find(t => t._id === tenantId) || null, [tenants, tenantId])

  React.useEffect(() => {
    const onExternalOpen = () => setExternalModalCount((c) => c + 1)
    const onExternalClose = () => setExternalModalCount((c) => Math.max(0, c - 1))
    window.addEventListener('modal-open', onExternalOpen)
    window.addEventListener('modal-close', onExternalClose)

    // Load branding only after a tenant is selected or after login
    async function loadBrandingConditional() {
    try {
      if (!token && !tenantId) return // do not load branding on public login page

      let nameResp = null
      let logoResp = null
      if (tenantId) {
        nameResp = await api.getSetting('branding.companyName').catch(() => null)
        logoResp = await api.getSetting('branding.logo').catch(() => null)
      } else {
        // If logged in but no tenant selected, fall back to public settings
        nameResp = await api.getPublicSetting('branding.companyName').catch(() => null)
        logoResp = await api.getPublicSetting('branding.logo').catch(() => null)
      }

      const companyName = nameResp && nameResp.value ? String(nameResp.value) : null
      setBranding({ companyName, logo: logoResp && logoResp.value ? String(logoResp.value) : null })
      if (companyName) {
        try { document.title = companyName } catch { /* document.title is cosmetic; a sandboxed frame can refuse it */ }
      }
      try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { company: companyName, logo: logoResp && logoResp.value ? String(logoResp.value) : null }})) } catch { /* document.title is cosmetic; a sandboxed frame can refuse it */ }
    } catch (e) {
      console.debug('Failed to load branding', e)
    }
  }

  loadBrandingConditional()

    const onBrandEvent = (e) => {
      const d = e && e.detail ? e.detail : {}
      setBranding({ companyName: d.company || null, logo: d.logo || null })
      if (d.company) try { document.title = d.company } catch { /* document.title is cosmetic; a sandboxed frame can refuse it */ }
    }
    window.addEventListener('branding:update', onBrandEvent)

    return () => {
      window.removeEventListener('modal-open', onExternalOpen)
      window.removeEventListener('modal-close', onExternalClose)
      window.removeEventListener('branding:update', onBrandEvent)
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

  /**
   * Best-effort: a wash/dry purchase earns a guest-WiFi voucher when the
   * feature is turned on (Admin > Definições > WiFi). Never lets a voucher
   * problem look like the purchase itself failed — the money already moved
   * by the time this runs, so any failure here is silently swallowed.
   *
   * Tries the LOCAL engine first (straight to the UniFi controller over the
   * shop's LAN, no cloud backend involved) — this is what makes the voucher
   * actually available when the kiosk's own internet is down, which is
   * exactly when a customer wants it most. Falls back to the remote API only
   * when the local engine reports this batch wasn't settled locally at all
   * (it went through the network gateway instead) — any other local failure
   * (feature off, controller unreachable) is the real answer and isn't
   * retried against the cloud.
   */
  async function tryShowWifiVoucher(machineItems, batchId, kioskKey) {
    if (!machineItems.some((i) => i.type === 'wash' || i.type === 'dry')) return
    if (localApi.isElectron) {
      try {
        const voucher = await localApi.issueWifiVoucher(batchId)
        if (voucher?.code) setWifiVoucher(voucher)
        return
      } catch (e) {
        if (e?.message !== 'No matching machine purchase for this batch') {
          console.warn('[WiFi] Local voucher not issued', e)
          return
        }
        // Not a local sale — it was settled through the network gateway. Fall through.
      }
    }
    try {
      const voucher = await api.wifiVoucher(batchId, { apiKey: kioskKey })
      if (voucher?.code) setWifiVoucher(voucher)
    } catch (e) {
      console.warn('[WiFi] Voucher not issued', e)
    }
  }

  async function handlePay(items, opts = { useFidelity: false }) {
    try {
      const method = opts && opts.method === 'cash' ? 'cash' : 'card'
      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
      const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY

      // Batch id groups these related sales. It is derived from the cart's own
      // stable per-item ids rather than the clock, so a retry after a partial
      // failure (a 409 on one busy machine) reuses the SAME batch. Combined with
      // the per-item `localId` below, the server recognises the replay and does
      // not credit the recharges a second time — which is what happened every
      // time a customer tapped "pay" again after an error.
      const batchId = checkoutBatchId(items)

      if (method === 'cash') {
        // Offline-first path: a single machine, no card recharges bundled in, and
        // the kiosk's own local engine already holds enough real cash credit for
        // it (physically inserted through the embedded hardware agent) — settle
        // it entirely against the local session, no network round trip at all.
        // Anything the local engine doesn't cover (bundled recharges, several
        // machines, or simply not enough local credit yet — e.g. a site with no
        // physical coin acceptor wired up) falls straight through to the
        // existing network path below, exactly as before.
        const machineItems = items.filter(i => !(i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge'))))
        const hasRecharge = machineItems.length !== items.length
        // A coupon can only be validated and redeemed server-side (see
        // services/coupons.js) — the local/offline engine has no idea a
        // coupon exists, so a cart carrying one must always go over the
        // network, never settle silently at full price through a fast path.
        if (localApi.isElectron && !opts.couponCode && !hasRecharge && machineItems.length === 1) {
          const only = machineItems[0]
          const price = Number(only.price || only.amount || 0)
          try {
            const session = await localApi.getSession()
            if (session && session.credits >= price) {
              await localApi.processSale(only._id || only.id, price, 'cash', null, batchId, null)
              toast({ title: tr('paidCash'), variant: 'success' })
              try { if (only.name) showMachineNotice([only.name]) } catch { /* the notice is cosmetic; the payment already succeeded */ }
              tryShowWifiVoucher([only], batchId, kioskKey)
              setReceiptItems([only])
              resetCredit()
              clearCart()
              setCartOpen(false)
              return
            }
          } catch (e) {
            const msg = e?.message || tr('payErrorCash')
            toast({ title: tr('payFailed'), description: msg, variant: 'destructive' })
            return
          }
        }

        // Offline-first, multi-item: several machines and/or recharges in
        // this same cart. Same idea as above, one step broader — settles the
        // whole batch locally when the session already holds enough credit.
        if (localApi.isElectron && !opts.couponCode && (hasRecharge || machineItems.length > 1)) {
          const total = items.reduce((s, i) => s + Number(i.price || i.amount || 0), 0)
          try {
            const session = await localApi.getSession()
            if (session && session.credits >= total) {
              await localApi.processCart(items, 'cash', null, batchId)
              toast({ title: tr('paidCash'), variant: 'success' })
              try { if (machineItems.length) showMachineNotice(machineItems.map(i => i.name).filter(Boolean)) } catch { /* the notice is cosmetic; the payment already succeeded */ }
              tryShowWifiVoucher(machineItems, batchId, kioskKey)
              setReceiptItems(items)
              resetCredit()
              clearCart()
              setCartOpen(false)
              return
            }
          } catch (e) {
            const msg = e?.message || tr('payErrorCash')
            toast({ title: tr('payFailed'), description: msg, variant: 'destructive' })
            return
          }
        }

        // Validate cash via CashGateway (server-side gateway will persist sales atomically)
        const res = await processPayment(items, { method: 'cash', inserted: opts.inserted, couponCode: opts.couponCode })
        if (!res.success) {
          // Forward meaningful errors to the user
          const msg = res.error?.message || (res.error && res.error.body && res.error.body.error) || tr('payErrorCash')
          toast({ title: tr('payFailed'), description: msg, variant: 'destructive' })
          return
        }

        // Success: server already created sales and updated machines.
        // The sale is recorded either way, but if the hopper could not pay the
        // change out we must say so rather than let the customer walk away short.
        if (res.change > 0 && res.changeDispensed === false) {
          toast({
            title: tr('changeNotDelivered'),
            description: tr('changeNotDeliveredHint', { amount: `${Number(res.change).toFixed(2)}€` }),
            variant: 'destructive',
          })
        } else {
          toast({ title: tr('paidCash'), variant: 'success' })
        }
        // Show machine notification for machines purchased (if any)
        try {
          const machineNames = items.filter(i => !(i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge')))).map(i => i.name).filter(Boolean)
          if (machineNames.length) showMachineNotice(machineNames)
        } catch { /* the notice is cosmetic; the payment already succeeded */ }
        tryShowWifiVoucher(items.filter(i => !(i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge')))), batchId, kioskKey)
        setReceiptBatchId(batchId)
        setReceiptItems(items)
        resetCredit()
        clearCart()
        setCartOpen(false)
        return
      }

      // Card flow
      // If a cardCode is provided, use CardGateway to charge machines and post recharges server-side first
      const cardCode = opts.cardCode || null

      // Offline-first: a single machine, no recharges bundled into this same
      // batch, and the local mirror of this specific card already holds
      // enough balance — settle it entirely against the local engine, no
      // network call at all. Anything the local engine doesn't cover (bundled
      // recharges, several machines, an unknown/not-yet-synced card, or not
      // enough local balance) falls straight through to the existing network
      // path below, unchanged.
      if (localApi.isElectron && cardCode && !opts.couponCode) {
        const rechargeItems = items.filter(i => (i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge'))))
        const machineItemsOnly = items.filter(i => !(i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge'))))
        if (rechargeItems.length === 0 && machineItemsOnly.length === 1) {
          const only = machineItemsOnly[0]
          const price = Number(only.price || only.amount || 0)
          try {
            const card = await localApi.getCard(cardCode)
            if (card && card.status === 'active' && Number(card.balance || 0) >= price) {
              await localApi.processSale(only._id || only.id, price, 'card', cardCode, batchId, null)
              try { if (only.name) showMachineNotice([only.name]) } catch { /* the notice is cosmetic; the payment already succeeded */ }
              tryShowWifiVoucher(machineItemsOnly, batchId, kioskKey)
              setReceiptItems(machineItemsOnly)
              toast({ title: tr('paidCard'), variant: 'success' })
              clearCart()
              setCartOpen(false)
              return
            }
          } catch (e) {
            const msg = e?.message || 'Erro no pagamento com cartão'
            toast({ title: tr('payErrorCard'), description: msg, variant: 'destructive' })
            return
          }
        }

        // Offline-first, multi-item: several machines and/or recharges onto
        // this same card in one batch — same idea as above, one step broader.
        if (rechargeItems.length > 0 || machineItemsOnly.length > 1) {
          const machineTotal = machineItemsOnly.reduce((s, i) => s + Number(i.price || i.amount || 0), 0)
          const rechargeTotal = rechargeItems.reduce((s, i) => s + Number(i.price || i.amount || 0), 0)
          try {
            const card = await localApi.getCard(cardCode)
            if (card && card.status === 'active' && Number(card.balance || 0) + rechargeTotal >= machineTotal) {
              await localApi.processCart(items, 'card', cardCode, batchId)
              try { if (machineItemsOnly.length) showMachineNotice(machineItemsOnly.map(i => i.name).filter(Boolean)) } catch { /* the notice is cosmetic; the payment already succeeded */ }
              tryShowWifiVoucher(machineItemsOnly, batchId, kioskKey)
              setReceiptItems(items)
              toast({ title: tr('paidCard'), variant: 'success' })
              clearCart()
              setCartOpen(false)
              return
            }
          } catch (e) {
            const msg = e?.message || 'Erro no pagamento com cartão'
            toast({ title: tr('payErrorCard'), description: msg, variant: 'destructive' })
            return
          }
        }
      }

      // first persist recharges (if any) — recharges are always card-based
      try {
        for (const it of items.filter(i => (i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge'))))) {
          const json = { amount: Number(it.amount), items: it, method: 'card', inserted: Number(it.amount), batchId, cardCode, localId: `${batchId}:${it.id}` }
          await api.request('/pos/recharge', { method: 'POST', json, headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined, skipAuth: true, expect: 'json' })
        }

        const machineItems = items.filter(i => !(i.type === 'Recarga de Cartão' || (i.id && String(i.id).startsWith('recharge'))))

        if (cardCode && machineItems.length) {
          // Charge via CardGateway (calls /pos/cards/:code/spend per item)
          const res = await processPayment(machineItems, { method: 'card', cardCode, batchId, kioskKey, couponCode: opts.couponCode })
          if (!res.success) {
            const status = res.error?.status || res.error?.response?.status
            const msg = res.error?.message || (res.error && res.error.body && res.error.body.error) || res.error || 'Erro desconhecido'
            if (status === 409) {
              toast({ title: tr('machineBusy'), description: String(msg), variant: 'destructive' })
            } else {
              toast({ title: tr('payErrorCard'), description: String(msg), variant: 'destructive' })
            }
            return
          }

          // Show machine notification for machines purchased (if any)
          try {
            const machineNames = machineItems.map(i => i.name).filter(Boolean)
            if (machineNames.length) showMachineNotice(machineNames)
          } catch { /* the notice is cosmetic; the payment already succeeded */ }
          tryShowWifiVoucher(machineItems, batchId, kioskKey)
          setReceiptBatchId(batchId)
          setReceiptItems(machineItems)

          toast({ title: tr('paidCard'), variant: 'success' })
          clearCart()
          setCartOpen(false)
          return
        }

        // Fallback: no cardCode provided — persist machine sales as card payments using cart recharges
        for (const it of machineItems) {
          const machineId = it._id || it.id
          const payload = { machineId, amount: Number(it.price || it.amount || 0), items: [it], method: 'card', inserted: Number(it.price || it.amount || 0), batchId, localId: `${batchId}:${it.id}` }
          await api.request('/pos/sale', { method: 'POST', json: payload, headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined, skipAuth: true, expect: 'json' })
        }

        // Show machine notification for machines purchased (if any)
        try {
          const machineNames = machineItems.map(i => i.name).filter(Boolean)
          if (machineNames.length) showMachineNotice(machineNames)
        } catch { /* the notice is cosmetic; the payment already succeeded */ }
        tryShowWifiVoucher(machineItems, batchId, kioskKey)
        setReceiptBatchId(batchId)
        setReceiptItems(machineItems)

        toast({ title: tr('paidCard'), variant: 'success' })
        clearCart()
        setCartOpen(false)
      } catch (e) {
        console.warn('Failed to persist card transactions', e)
        const status = e?.status || e?.response?.status || (e?.body && e.body.status)
        const bodyError = (e && e.body && e.body.error) || e?.message || e
        if (status === 409 || String(bodyError).toLowerCase().includes('already in use')) {
          toast({ title: tr('machineBusy'), description: String(bodyError), variant: 'destructive' })
        } else {
          toast({ title: tr('persistError'), variant: 'destructive' })
        }
      }
    } catch (e) {
      toast({ title: tr('payError'), variant: 'destructive' })
      console.error(e)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-linear-to-br from-primary-50 via-primary-100 to-primary-200">
      {!location.pathname.startsWith('/admin') && (
        <header className="p-4 border-b border-primary-100 bg-white/70 backdrop-blur">
          <div className="container mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/" className="inline-flex items-center gap-2 p-3 rounded-lg hover:bg-white/60 focus:outline-none" title="Home">
                {branding.logo ? (
                  <img src={branding.logo} alt={branding.companyName || 'Company'} className="h-12 w-12 object-contain rounded-md" />
                ) : (
                  <Home className="h-9 w-9 text-primary-800" />
                )}
                <span className="text-3xl font-semibold text-primary-800">{branding.companyName || 'Washstore'}</span>
              </Link>
            </div>
            <div className="flex items-center gap-3">
         


              {showHome && (
                <Link to="/pos" className="inline-flex items-center p-3 rounded-lg hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Home">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-primary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.75L12 3l9 6.75V20a1 1 0 0 1-1 1h-5.5a1 1 0 0 1-1-1V14a1 1 0 0 0-1-1H10a1 1 0 0 0-1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9.75z" />
                  </svg>
                  <span className="sr-only">Home</span>
                </Link>
              )}

              {credit > 0 && location.pathname.startsWith('/pos') && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-4 py-2 text-lg font-bold text-white shadow"
                  title={t('creditTitle')}
                  aria-live="polite"
                >
                  {t('creditBadge', { amount: `${credit.toFixed(2)}€` })}
                  <RefundCountdown at={refundAt} />
                </span>
              )}

                         {cartCount > 0 && (
                <button aria-label="Abrir carrinho" className="relative inline-flex items-center p-3 rounded-lg hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" onClick={() => setCartOpen(true)}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-primary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4m1.6 8L5 21h14" />
                  </svg>
                  <span className="sr-only">Carrinho</span>
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-2 py-1 text-sm font-bold leading-none text-white bg-red-600 rounded-full">{cartCount}</span>
                </button>
              )}
     {location.pathname.startsWith('/admin') && <TenantSelector className="mr-2" />}
     {location.pathname.startsWith('/admin') && tenant && (
       <div className="text-sm text-primary-700 mr-2">{tenant.name}</div>
     )}
    {location.pathname.startsWith('/pos') && <LanguageSwitcher />}

              <button aria-label="Ajuda" className="inline-flex items-center p-3 rounded-lg hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" onClick={() => setHelpOpen(true)} title="Ajuda">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-primary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
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
          {/* The kiosk sale UI only ships in local kiosk builds (electron, or
              the shop PC's single-process install). The public/cloud site
              (VITE_PUBLIC_SITE=true) is admin-only — it has no hardware to
              sell against, so these routes bounce to the admin login. */}
          {import.meta.env.DEV && <Route path="/dev/cart" element={<DevCartPreview />} />}
          <Route path="/pos" element={isPublicSite ? <Navigate to="/admin/login" replace /> : <Pos />} />
          <Route path="/pos/machines" element={isPublicSite ? <Navigate to="/admin/login" replace /> : <Machines />} />
          <Route path="/pos/machines/:id" element={isPublicSite ? <Navigate to="/admin/login" replace /> : <MachineDetail />} />

          {/* Admin login (public) */}
          <Route path="/admin/login" element={<Admin />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Protected admin area. Widened to every dashboard role — STAFF and
              TECHNICIAN (Round 14) need to enter the shell too; individual
              admin-only pages below re-wrap themselves more tightly. The
              backend's requireAdmin/requireStaffRead/requireTechnician guards
              are the real enforcement — this is just so the wrong role lands
              on an explicit "not allowed" redirect instead of a broken page. */}
          <Route path="/admin" element={<RequireAdmin roles={['ADMIN', 'SUPERADMIN', 'STAFF', 'TECHNICIAN']}><AdminDashboard /></RequireAdmin>}>
            <Route index element={<Navigate to="overview" replace />} />
            {/* Backwards-compat: support legacy /admin/dashboard URLs */}
            <Route path="dashboard" element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<AdminOverview />} />
            <Route path="users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
            <Route path="tenants" element={<RequireAdmin roles={['SUPERADMIN']}><AdminTenants /></RequireAdmin>} />
            <Route path="machines" element={<AdminMachines />} />
            <Route path="maintenance" element={<RequireAdmin roles={['ADMIN', 'SUPERADMIN', 'TECHNICIAN']}><AdminMaintenance /></RequireAdmin>} />
            <Route path="interfaces" element={<RequireAdmin><AdminInterfaces /></RequireAdmin>} />
            <Route path="peripherals" element={<RequireAdmin><AdminPeripherals /></RequireAdmin>} />
            <Route path="prices" element={<RequireAdmin><AdminPrices /></RequireAdmin>} />
            <Route path="coupons" element={<RequireAdmin><AdminCoupons /></RequireAdmin>} />
            <Route path="cards" element={<AdminCards />} />
            <Route path="transactions" element={<AdminTransactions />} />
            <Route path="day-close" element={<AdminDayClose />} />
            <Route path="operations" element={<RequireAdmin><AdminOperations /></RequireAdmin>} />
            <Route path="settings" element={<RequireAdmin><AdminSettings /></RequireAdmin>} />
            <Route path="audit-log" element={<RequireAdmin><AdminAuditLog /></RequireAdmin>} />
            <Route path="profile" element={<AdminProfile />} />
          </Route>
          <Route path="/" element={<Navigate to={isPublicSite ? '/admin/login' : '/pos'} replace />} />
        </Routes>
      </main>

      <CartModal open={cartOpen} onClose={() => setCartOpen(false)} onPay={handlePay} />
      <WifiQrModal open={Boolean(wifiVoucher)} onClose={() => setWifiVoucher(null)} voucher={wifiVoucher} />
      <ReceiptPrompt
        items={receiptItems}
        batchId={receiptBatchId}
        kioskKey={(typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null) || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY}
        onClose={() => { setReceiptBatchId(null); setReceiptItems(null) }}
      />
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

      {/* Staff-only kiosk actions (day-close, maintenance lock) — not on the
          admin dashboard, which has its own equivalent pages/auth. */}
      {!location.pathname.startsWith('/admin') && <StaffMenu />}
      {!location.pathname.startsWith('/admin') && <KioskLockOverlay />}
    </div>
  )
}

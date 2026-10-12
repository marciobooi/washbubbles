import React from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import MachineCard from '../components/MachineCard'
import { toast } from '@/components/ui/Toast'
import Wave from '../components/ui/wave'
import api from '@/services/api'
import { connect, subscribe } from '@/services/websocket'
import { useCart } from '../context/CartContext'
import { useTranslation } from 'react-i18next'
import washL1 from '@/assets/washingmashine/L1.png'
import washL2 from '@/assets/washingmashine/L2.png'
import washL3 from '@/assets/washingmashine/L3.png'
import washL4 from '@/assets/washingmashine/L4.png'
import dryS1 from '@/assets/drymachine/S1.png'
import dryS2 from '@/assets/drymachine/S2.png'
import dryS3 from '@/assets/drymachine/S3.png'
import dryS4 from '@/assets/drymachine/S4.png'
export default function Machines() {
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type') || 'wash'
  const navigate = useNavigate()

  const frames = type === 'wash'
    ? [washL1, washL2, washL3, washL4]
    : [dryS1, dryS2, dryS3, dryS4]

  const [machines, setMachines] = React.useState([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        // Prefer kiosk/public machines endpoint (requires kiosk API key)
        const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
        const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
        const data = await api.getPublicMachines({ type }, { apiKey: kioskKey })
        if (mounted && Array.isArray(data)) {
          setMachines(data)
        } else if (mounted && !kioskKey) {
          // No kiosk key available locally — inform admin to configure one
          toast({ title: 'Kiosk API key missing. Configure `kiosk_api_key` in localStorage or set VITE_KIOSK_API_KEY / pass via Electron', variant: 'warning' })
        }
      } catch (e) {
        console.error('Failed to fetch machines', e)
        // Provide specific guidance if the kiosk key is invalid or missing
        if (e instanceof Error && (e.message?.includes('Invalid apiKey') || e.message?.includes('Invalid token') || e.status === 401)) {
          toast({ title: 'Kiosk key inválida ou expirada. Verifique a chave em localStorage / VITE_KIOSK_API_KEY', variant: 'destructive' })
        } else {
          toast({ title: 'Erro ao carregar máquinas — usando dados locais', variant: 'destructive' })
        }

        // Fallback to local mock
        setMachines([
          { id: 'm1', name: 'Maquina Lavar 1', weight: 12, price: 3.5, status: 'free', statusText: 'Livre', type: 'wash', icon: washL1 },
          { id: 'm2', name: 'Maquina Lavar 2', weight: 8, price: 2.5, statusText: 'Ocupado', status: 'working', type: 'wash', icon: washL1 },
          { id: 'm3', name: 'Maquina Lavar 3', weight: 18, price: 4.5, status: 'free', statusText: 'Livre', type: 'wash', icon: washL1 },
        ].filter(m => m.type === type))
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()

    // subscribe to websocket updates so POS refreshes automatically
    connect()
    const unsub = subscribe((message) => {
      console.debug('[ws] Machines received message', message)
      if (typeof message === 'object' && message.type === 'machine-status') {
        const data = Array.isArray(message.payload) ? message.payload.filter((m) => (m.type || 'wash') === type) : []
        if (data.length) setMachines(data)
      } else if (typeof message === 'object' && message.type === 'machine-update') {
        const m = message.payload
        if (!m) return
        // If update matches current type, upsert it; otherwise remove it from the view
        if ((m.type || 'wash') === type) {
          setMachines((prev) => {
            const found = prev.find((x) => (x._id || x.id) === (m._id || m.id))
            if (found) return prev.map((x) => ((x._id || x.id) === (m._id || m.id) ? m : x))
            return [...prev, m]
          })
        } else {
          setMachines((prev) => prev.filter((x) => (x._id || x.id) !== (m._id || m.id)))
        }
      }
    })

    return () => { mounted = false; unsub() }
  }, [type])

  const { cart, addToCart, clearCart, openCart } = useCart()
  const { t: tc } = useTranslation('cart')

  async function openForAdd(m) {
    // Fetch fresh price data before adding to cart
    let machineWithPrice = { ...m }
    if (m.type && m.weight) {
      try {
        const priceData = await api.getPriceByTypeWeightPublic(m.type, m.weight)
        if (priceData) {
          // Add calculated prices to the machine object
          const { getEffectivePrice } = await import('@/lib/promo')
          machineWithPrice.cashPrice = getEffectivePrice(priceData, 'cash')
          machineWithPrice.cardPrice = getEffectivePrice(priceData, 'card')
          machineWithPrice.price = priceData.cardPrice || priceData.cashPrice || m.price || 0
        }
      } catch (e) {
        console.error('Failed to fetch price for cart', e)
      }
    }
    
    addToCart(machineWithPrice)
    // Don't auto-open cart; show the banner with a button to view it
    const base = Number(m.tImp) || 15
    const price = Number(machineWithPrice.cashPrice ?? machineWithPrice.price ?? 0)
    const numMatch = String(m.number ?? '').trim() || (String(m.name || '').match(/(\d+)\s*$/) || [])[1] || ''
    try {
      const { cartAddedToast } = await import('@/components/ui/Toast')
      cartAddedToast({
        badge: numMatch || '🛒',
        title: tc('cartAdded', { name: m.name }),
        subtitle: tc('cartAddedHint', { min: base, price: `${price.toFixed(2).replace('.', ',')}€` }),
        viewLabel: tc('viewCart'),
        dismissLabel: tc('dismissNotice'),
        count: cart.length + 1,
        onView: () => openCart(),
      })
    } catch (e) {
      toast({ title: tc('cartAdded', { name: m.name }), variant: 'success' })
    }
  }

  // NOTE: the old `pay()` and `handleAddToCart()` lived here and were never
  // called by anything. `pay()` also called an undeclared `closeModal()` (an
  // instant ReferenceError had it ever run) and duplicated the checkout in
  // App.jsx — including totalling prices client-side, which the server now
  // ignores. Checkout has one home: `App.jsx:handlePay`.

  const { t } = useTranslation('pos')

  const typeLabel = t(`machines.type.${type}`)

  return (
    <div className='flex-1 container mx-auto p-4'>
    <div className="relative pb-[12vh] z-10">
      <h2 className="p-4 text-center text-4xl font-semibold mb-6">{t('machines.select', { type: typeLabel })}</h2>
      {loading ? (
        <div className="text-center text-neutral-500">Carregando máquinas...</div>
      ) : (
        <div className="grid gap-6">
          {machines.map((m) => (
            <MachineCard key={m._id || m.id} m={m} frames={frames} onSelect={(id) => { const mFound = machines.find((x) => String(x._id || x.id) === String(id)); if (mFound) openForAdd(mFound) }} />
          ))}
        </div>
      )}
      {/* MachineModal removed — clicking a machine adds directly to cart */}

      <Wave height="12vh" className="mt-2" />
    </div>
    </div>
  )
}

import React from 'react'
import i18n from '@/lib/i18n'
import { useSearchParams, useNavigate } from 'react-router-dom'
import MachineCard from '../components/MachineCard'
import MachineChoiceModal from '../components/MachineChoiceModal'
import { getEffectivePrice } from '@/lib/promo'
import { toast } from '@/components/ui/Toast'
import Wave from '../components/ui/wave'
import Loading from '../components/ui/loading'
import api from '@/services/api'
import { connect, subscribe } from '@/services/websocket'
import { useCart } from '../context/CartContext'
import { useTranslation } from 'react-i18next'
export default function Machines() {
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type') || 'wash'
  const navigate = useNavigate()

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
          toast({ title: i18n.t('machinesLoadError', { ns: 'cart' }), variant: 'destructive' })
        }

        // Fallback to local mock
        setMachines([
          { id: 'm1', name: 'Maquina Lavar 1', weight: 12, price: 3.5, status: 'free', statusText: 'Livre', type: 'wash' },
          { id: 'm2', name: 'Maquina Lavar 2', weight: 8, price: 2.5, statusText: 'Ocupado', status: 'working', type: 'wash' },
          { id: 'm3', name: 'Maquina Lavar 3', weight: 18, price: 4.5, status: 'free', statusText: 'Livre', type: 'wash' },
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

  const { cart, addToCart, removeFromCart, clearCart, openCart } = useCart()
  const { t: tc } = useTranslation('cart')

  async function openForAdd(m, { notice = true, priceData: known = null } = {}) {
    // Fetch fresh price data before adding to cart (the choice popup has just loaded it: then it is reused)
    let machineWithPrice = { ...m }
    if (m.type && m.weight) {
      try {
        const priceData = known || await api.getPriceByTypeWeightPublic(m.type, m.weight)
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
    
    // Already in the basket: the cart context shows the warning, so no "added" banner here
    if (addToCart(machineWithPrice) === false) return false
    if (!notice) return true // the choice popup already told the customer what happened
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

  const inCartItem = (m) => cart.find((c) => String(c.productId || c._id) === String(m._id || m.id))
  // Tapping a machine opens a popup: add it to the cart (and keep choosing) or pay now. Both continue in the normal cart / payment flow.
  const [choice, setChoice] = React.useState(null) // the machine that was tapped
  const [choicePrice, setChoicePrice] = React.useState(null)
  const [choicePriceData, setChoicePriceData] = React.useState(null)
  const toggle = (id) => {
    const found = machines.find((x) => String(x._id || x.id) === String(id))
    if (!found) return
    setChoicePrice(null)
    setChoicePriceData(null)
    setChoice(found)
    if (found.type && found.weight) {
      api.getPriceByTypeWeightPublic(found.type, found.weight)
        .then((p) => { if (p) { setChoicePriceData(p); setChoicePrice(getEffectivePrice(p, 'cash')) } })
        .catch(() => {})
    }
  }
  const closeChoice = () => setChoice(null)
  const choiceItem = choice ? inCartItem(choice) : null
  const choiceAdd = async () => { const m = choice; const priceData = choicePriceData; setChoice(null); if (m) await openForAdd(m, { notice: false, priceData }) }
  const choicePay = async () => {
    const m = choice
    const priceData = choicePriceData
    setChoice(null)
    if (!m) return
    if (!inCartItem(m)) await openForAdd(m, { notice: false, priceData })
    setTimeout(() => openCart(), 0) // after the basket update, so the cart modal does not close itself as "empty"
  }
  const choiceRemove = () => { const item = choice && inCartItem(choice); setChoice(null); if (item) removeFromCart(item.id) }

  return (
    <div className='flex-1 container mx-auto p-4'>
    <div className="relative pb-[12vh] z-10">
      <div className="px-2 pt-2 mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-5xl font-extrabold text-slate-900 tracking-tight">{t('machines.select', { type: typeLabel })}</h2>
          <p className="text-2xl text-slate-600 mt-3">{t('machines.subtitle')}</p>
        </div>
        <div className="shrink-0 flex items-center gap-5 bg-white px-5 py-3 rounded-xl border border-slate-200 text-lg font-medium text-slate-600">
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-500" />{t('machines.legendFree')}</span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-rose-400" />{t('machines.legendBusy')}</span>
        </div>
      </div>
      {loading ? (
        <Loading label={t('machines.loading')} />
      ) : (
        <div className="grid gap-6">
          {machines.map((m) => (
            <MachineCard key={m._id || m.id} m={m} inCart={Boolean(inCartItem(m))} onSelect={toggle} />
          ))}
        </div>
      )}
      <div className="mt-8 bg-slate-100/90 rounded-2xl p-6 border border-slate-200 flex items-center justify-between gap-5 text-xl text-slate-600">
        <div className="flex items-center gap-4">
          <span className="shrink-0 w-11 h-11 rounded-full bg-white flex items-center justify-center border border-slate-200">💡</span>
          <p>{t('machines.tip')}</p>
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('kiosk:open-help'))}
          className="text-emerald-700 font-bold shrink-0 min-h-[56px] px-4 rounded-xl active:bg-emerald-50"
        >{t('machines.howTo')}</button>
      </div>
      <MachineChoiceModal open={Boolean(choice)} machine={choice} price={choicePrice} inCart={Boolean(choiceItem)} onAdd={choiceAdd} onPay={choicePay} onRemove={choiceRemove} onClose={closeChoice} />

      <Wave height="12vh" className="mt-2" />
    </div>
    </div>
  )
}

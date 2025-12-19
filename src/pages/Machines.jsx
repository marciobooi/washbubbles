import React from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { usePayment } from '../context/PaymentContext'
import MachineCard from '../components/MachineCard'
import MachineModal from '../components/MachineModal'
import { toast } from '@/components/ui/Toast'
import Wave from '../components/ui/wave'
import api from '@/services/api'
import { connect, subscribe } from '@/services/websocket'
import { useCart } from '../context/CartContext'

export default function Machines() {
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type') || 'wash'
  const navigate = useNavigate()

  const frames = type === 'wash'
    ? ['/washingmashine/L1.png', '/washingmashine/L2.png', '/washingmashine/L3.png', '/washingmashine/L4.png']
    : ['/drymachine/S1.png', '/drymachine/S2.png', '/drymachine/S3.png', '/drymachine/S4.png']

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
          { id: 'm1', name: 'Maquina Lavar 1', weight: 12, price: 3.5, status: 'free', statusText: 'Livre', type: 'wash', icon: '/washingmashine/L1.png' },
          { id: 'm2', name: 'Maquina Lavar 2', weight: 8, price: 2.5, statusText: 'Ocupado', status: 'working', type: 'wash', icon: '/washingmashine/L1.png' },
          { id: 'm3', name: 'Maquina Lavar 3', weight: 18, price: 4.5, status: 'free', statusText: 'Livre', type: 'wash', icon: '/washingmashine/L1.png' },
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

  const [selected, setSelected] = React.useState(null)
  const { addToCart, clearCart } = useCart()
  const { processPayment } = usePayment()
  const [modalOpen, setModalOpen] = React.useState(false)


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
    toast({ title: `${m.name} adicionado ao carrinho`, variant: 'success' })
    console.log('Added to cart', m)
  }

  async function pay(m, opts = { useFidelity: false, method: 'card', inserted: null }) {
    try {
      const res = await processPayment([m], opts)
      if (res.success) {
        // Persist transaction to backend via kiosk endpoint
        try {
          const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
          const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
          const inserted = opts.inserted != null ? Number(opts.inserted) : Number(m.price || 0)
          const change = Math.max(0, (inserted || 0) - (m.price || 0))
          await api.request('/pos/sale', { method: 'POST', json: { machineId: m._id || m.id, amount: Number(m.price || 0), items: [m], method: opts.method || 'card', inserted, change }, headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined, skipAuth: true, expect: 'json' })
        } catch (e) {
          console.warn('Failed to persist sale to backend', e)
        }

        closeModal()
        toast({ title: `Pagamento efetuado (${res.method})`, variant: 'success' })
      }
    } catch (e) {
      toast({ title: 'Erro no pagamento', variant: 'destructive' })
    }
  }

  return (
    <div className='flex-1 container mx-auto p-4'>
    <div className="relative pb-[12vh] z-10">
      <h2 className="p-4 text-center text-xl font-semibold mb-4">Selecionar máquina ({type})</h2>
      {loading ? (
        <div className="text-center text-neutral-500">Carregando máquinas...</div>
      ) : (
        <div className="grid gap-4">
          {machines.map((m) => (
            <MachineCard key={m._id || m.id} m={m} frames={frames} onSelect={(id) => { const mFound = machines.find((x) => (x._id || x.id) === id); if (mFound) openModalFor(mFound) }} />
          ))}
        </div>
      )}
      <MachineModal open={modalOpen} machine={selected} frames={frames} onClose={closeModal} onAddToCart={handleAddToCart} onPay={pay} />

      <Wave height="12vh" className="mt-2" />
    </div>
    </div>
  )
}

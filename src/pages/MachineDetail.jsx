import React from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import useFrameAnimation from '../hooks/useFrameAnimation'
import Wave from '../components/ui/wave'
import api from '@/services/api'

export default function MachineDetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type') || 'wash'
  const navigate = useNavigate()

  const [machine, setMachine] = React.useState(null)
  const [frames, setFrames] = React.useState([])

  // Fetch machine from backend if possible
  React.useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const data = await api.getMachine(id)
        if (mounted && data && data._id) {
          setMachine(data)
          setFrames(data.type === 'wash' ? ['/washingmashine/L1.png','/washingmashine/L2.png','/washingmashine/L3.png','/washingmashine/L4.png'] : ['/drymachine/S1.png','/drymachine/S2.png','/drymachine/S3.png','/drymachine/S4.png'])
          return
        }
      } catch (e) {
        // ignore - fallback to local
      }

      // If getMachine didn't return a machine, try fetching the full list and find by id
      try {
        const kioskKey = localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
        const list = await api.getPublicMachines(undefined, { apiKey: kioskKey })
        if (Array.isArray(list)) {
          const found = list.find((m) => (m._id || m.id) === id)
          if (found) {
            setMachine(found)
            setFrames(found.type === 'wash'
              ? ['/washingmashine/L1.png','/washingmashine/L2.png','/washingmashine/L3.png','/washingmashine/L4.png']
              : ['/drymachine/S1.png','/drymachine/S2.png','/drymachine/S3.png','/drymachine/S4.png'])
            return
          }
        }
      } catch (e) {
        // ignore - we'll use a small local fallback
        console.error('Failed to fetch machines list', e)
      }

      // final small fallback
      const fallback = { id: id || 'm1', name: 'Maquina', weight: 12, price: 3.5, status: 'free', statusText: 'Livre', type, icon: type === 'wash' ? '/washingmashine/L1.png' : '/drymachine/S1.png' }
      setMachine(fallback)
      setFrames(type === 'wash'
        ? ['/washingmashine/L1.png','/washingmashine/L2.png','/washingmashine/L3.png','/washingmashine/L4.png']
        : ['/drymachine/S1.png','/drymachine/S2.png','/drymachine/S3.png','/drymachine/S4.png'])
    }
    load()
    return () => { mounted = false }
  }, [id])

  const seed = React.useMemo(() => {
    if (!machine) return 0
    return Array.from(String(machine._id || machine.id)).reduce((s, c) => s * 31 + c.charCodeAt(0), 0)
  }, [machine])

  const frame = useFrameAnimation(frames, 300, { seed })

  return (
    <div className='flex-1 container mx-auto p-4'>
    <div className="relative pb-[12vh] z-10">
      <div className="glass-card p-6 flex flex-col items-center gap-4">
        {frame && <img src={frame} alt={machine.name} className="w-40 h-40 object-contain" />}
        <div className="text-2xl font-semibold">{machine.name}</div>
        <div className="text-neutral-600">{machine.weight} kg • {typeof machine.price === 'number' ? machine.price.toFixed(2) : machine.price}€ por ciclo • {typeof machine.loyaltyPrice === 'number' ? machine.loyaltyPrice.toFixed(2) : (Math.max(0, (machine.price || 0) - 0.5).toFixed(2))}€ fidelidade</div>
        <div className={`py-2 px-4 rounded ${machine.status === 'free' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{machine.statusText || (machine.status === 'free' ? 'Livre' : 'Ocupado')}</div>
      </div>
      <Wave height="12vh" className="mt-2" />
    </div>
    </div>
  )
}

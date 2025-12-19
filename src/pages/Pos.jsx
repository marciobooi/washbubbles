import React from 'react'
import { useNavigate } from 'react-router-dom'
import Wave from '../components/ui/wave'
import Card from '../components/Card'
import CardModal from '../components/CardModal'
import { toast } from '@/components/ui/Toast'
import Banner from '../components/Banner'
import api from '@/services/api'

export default function Pos() {
  const cards = [
    { id: 'wash', title: 'Lavar roupa', text: 'Lavar roupa', frames: ['/washingmashine/L1.png', '/washingmashine/L2.png', '/washingmashine/L3.png', '/washingmashine/L4.png'] },
    { id: 'dry', title: 'Secar roupa', text: 'Secar roupa', frames: ['/drymachine/S1.png', '/drymachine/S2.png', '/drymachine/S3.png', '/drymachine/S4.png'] },
    { id: 'card', title: 'Rinse', text: 'O meu cartão', frames: ['/card/card.png' ] },
    { id: 'buyCard', title: 'Settings', text: 'Comprar cartão' , frames: ['/card/card-group.png' ] }
  ]

  // Card component moved to src/components/Card.jsx

  const navigate = useNavigate()
  const [cardOpen, setCardOpen] = React.useState(false)
  const [transactions, setTransactions] = React.useState([
    { id: 't1', ts: new Date().toISOString(), type: 'Recarregado', amount: 10 },
    { id: 't2', ts: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), type: 'Gasto - Lavagem', amount: -3 },
    { id: 't3', ts: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), type: 'Gasto - Secagem', amount: -4 },
  ])


  function openCard() {
    setCardOpen(true)
  }

  function closeCard() {
    setCardOpen(false)
  }

  async function handleRecharge(amount = 10) {
    try {
      // Persist recharge via kiosk endpoint
      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
      const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
      // Use api.request directly (skip auth)
      const resp = await api.request('/pos/recharge', { method: 'POST', json: { amount: Number(amount), items: [{ type: 'recharge', amount: Number(amount) }], method: 'card', inserted: Number(amount), change: 0 }, headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined, skipAuth: true, expect: 'json' })
      const sale = resp && resp.sale ? resp.sale : null
      const m = sale ? { id: sale._id || `t${Date.now()}`, ts: sale.createdAt || new Date().toISOString(), type: `Recarregado`, amount: Number(amount) } : { id: `t${Date.now()}`, ts: new Date().toISOString(), type: `Recarregado`, amount: Number(amount) }
      setTransactions((s) => [m, ...s])
      toast({ title: `Cartão recarregado ${Number(amount).toFixed(2)}€`, variant: 'success' })
    } catch (e) {
      console.error('Failed to recharge', e)
      toast({ title: 'Erro ao recarregar o cartão', variant: 'destructive' })
    }
  }

  return (
    <>
      {/* Banner Carousel */}
      <div className="mb-8">
        <Banner />
      </div>
<div className='flex-1 container mx-auto p-4'>
      <div className="relative min-h-[calc(100vh-35rem)] flex flex-col z-10">
        {/* Cards Grid */}
        <div className="flex-grow flex items-center justify-center px-6 pb-32">
          <div className="w-full max-w-7xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {cards.map((c) => (
              <div key={c.id} className="aspect-[3/4] sm:aspect-square lg:aspect-[3/4] xl:aspect-square transition-all duration-300 hover:-translate-y-2">
                <Card c={c} onClick={(id) => {
                  if (c.id === 'wash' || c.id === 'dry') {
                    navigate(`/pos/machines?type=${c.id}`)
                  } else if (c.id === 'card') {
                    openCard()
                  } else {
                    console.log('clicked', id)
                  }
                }} />
              </div>
            ))}
          </div>
        </div>

        <CardModal open={cardOpen} onClose={closeCard} transactions={transactions} balance={transactions.reduce((s,t)=>s+t.amount,0)} onRecharge={(amt)=>handleRecharge(amt)} />

        
        <div className="fixed bottom-0 left-0 right-0 pointer-events-none z-0">
          <Wave height="18vh" className="opacity-90 text-primary-500" />
        </div>
      </div>
      </div>
    </>
  )
}

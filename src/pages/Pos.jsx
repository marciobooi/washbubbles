import React from 'react'
import { useNavigate } from 'react-router-dom'
import Wave from '../components/ui/wave'
import Card from '../components/Card'
import CardModal from '../components/CardModal'
import BuyCardModal from '../components/BuyCardModal'
import { toast } from '@/components/ui/Toast'
import Banner from '../components/Banner'
import api from '@/services/api'
import { useTranslation } from 'react-i18next'
import { connect, subscribe } from '@/services/websocket'

export default function Pos() {
  const { t } = useTranslation('pos')

  const cards = [
    { id: 'wash', title: t('cards.wash.title'), text: t('cards.wash.text'), frames: ['/washingmashine/L1.png', '/washingmashine/L2.png', '/washingmashine/L3.png', '/washingmashine/L4.png'] },
    { id: 'dry', title: t('cards.dry.title'), text: t('cards.dry.text'), frames: ['/drymachine/S1.png', '/drymachine/S2.png', '/drymachine/S3.png', '/drymachine/S4.png'] },
    { id: 'card', title: t('cards.card.title'), text: t('cards.card.text'), frames: ['/card/card.png' ] },
    { id: 'buyCard', title: t('cards.buyCard.title'), text: t('cards.buyCard.text') , frames: ['/card/card-group.png' ] }
  ]

  // Card component moved to src/components/Card.jsx

  const navigate = useNavigate()
  const [cardOpen, setCardOpen] = React.useState(false)
  const [buyCardOpen, setBuyCardOpen] = React.useState(false)

  // Real card state — populated when the user taps their RFID card
  const [currentCard, setCurrentCard] = React.useState(null) // { code, balance, name, ... }
  const [transactions, setTransactions] = React.useState([])

  // Load card balance + history from backend
  async function loadCard(code) {
    try {
      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
      const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
      const result = await api.request(`/pos/cards/${encodeURIComponent(code)}/history`, {
        method: 'GET',
        headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined,
        skipAuth: true,
        expect: 'json',
      })
      if (result && result.card) {
        setCurrentCard(result.card)
        setTransactions(Array.isArray(result.transactions) ? result.transactions : [])
      }
    } catch (e) {
      console.error('[Pos] Failed to load card data', e)
      toast({ title: 'Erro ao carregar cartão', variant: 'destructive' })
    }
  }

  // Subscribe to WS events: RFID tap auto-loads card and opens modal
  React.useEffect(() => {
    connect()
    const unsub = subscribe((message) => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'rfid:card_detected') {
        const code = message.payload?.cardCode
        if (code) {
          toast({ title: 'Cartão detetado', variant: 'success' })
          loadCard(code).then(() => setCardOpen(true))
        }
      }
    })
    return unsub
  }, [])


  function openCard() {
    setCardOpen(true)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('modal-open'))
  }

  function closeCard() {
    setCardOpen(false)
    setCurrentCard(null)
    setTransactions([])
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('modal-close'))
  }

  function openBuyCard() {
    setBuyCardOpen(true)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('modal-open'))
  }

  function closeBuyCard() {
    setBuyCardOpen(false)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('modal-close'))
  }

  async function handleRecharge(amount = 10) {
    if (!currentCard?.code) {
      toast({ title: 'Aproxime o seu cartão para recarregar', variant: 'warning' })
      return
    }
    try {
      // Persist recharge via kiosk endpoint, linked to the active card
      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
      const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
      const resp = await api.request('/pos/recharge', { method: 'POST', json: { amount: Number(amount), items: [{ type: 'recharge', amount: Number(amount) }], method: 'card', inserted: Number(amount), change: 0, cardCode: currentCard.code }, headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined, skipAuth: true, expect: 'json' })
      // Reload card data so balance updates immediately
      await loadCard(currentCard.code)
      toast({ title: t('recharge.success', { amount: Number(amount).toFixed(2) }), variant: 'success' })
    } catch (e) {
      console.error('Failed to recharge', e)
      toast({ title: t('recharge.error'), variant: 'destructive' })
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
        <div className="grow flex items-center justify-center px-6 pb-32">
          <div className="w-full max-w-7xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {cards.map((c) => (
              <div key={c.id} className="aspect-3/4 sm:aspect-square lg:aspect-3/4 xl:aspect-square transition-all duration-300 hover:-translate-y-2">
                <Card c={c} onClick={(id) => {
                  if (c.id === 'wash' || c.id === 'dry') {
                    navigate(`/pos/machines?type=${c.id}`)
                  } else if (c.id === 'card') {
                    openCard()
                  } else if (c.id === 'buyCard') {
                    openBuyCard()
                  } else {
                    console.log('clicked', id)
                  }
                }} />
              </div>
            ))}
          </div>
        </div>
        <BuyCardModal open={buyCardOpen} onClose={closeBuyCard} />

        <CardModal open={cardOpen} onClose={closeCard} transactions={transactions} balance={currentCard?.balance ?? 0} onRecharge={(amt)=>handleRecharge(amt)} />

        
        <div className="fixed bottom-0 left-0 right-0 pointer-events-none z-0">
          <Wave height="18vh" className="opacity-90 text-primary-500" />
        </div>
      </div>
      </div>
    </>
  )
}

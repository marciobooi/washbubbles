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
import washL1 from '@/assets/washingmashine/L1.png'
import washL2 from '@/assets/washingmashine/L2.png'
import washL3 from '@/assets/washingmashine/L3.png'
import washL4 from '@/assets/washingmashine/L4.png'
import dryS1 from '@/assets/drymachine/S1.png'
import dryS2 from '@/assets/drymachine/S2.png'
import dryS3 from '@/assets/drymachine/S3.png'
import dryS4 from '@/assets/drymachine/S4.png'
import cardIcon from '@/assets/card/card.png'
import cardGroupIcon from '@/assets/card/card-group.png'

export default function Pos() {
  const { t } = useTranslation('pos')

  const cards = [
    { id: 'wash', title: t('cards.wash.title'), text: t('cards.wash.text'), frames: [washL1, washL2, washL3, washL4] },
    { id: 'dry', title: t('cards.dry.title'), text: t('cards.dry.text'), frames: [dryS1, dryS2, dryS3, dryS4] },
    { id: 'card', title: t('cards.card.title'), text: t('cards.card.text'), frames: [cardIcon] },
    { id: 'buyCard', title: t('cards.buyCard.title'), text: t('cards.buyCard.text') , frames: [cardGroupIcon] }
  ]

  // Card component moved to src/components/Card.jsx

  const navigate = useNavigate()
  const [cardOpen, setCardOpen] = React.useState(false)
  const [buyCardOpen, setBuyCardOpen] = React.useState(false)

  // Real card state — populated when the user taps their RFID card
  const [currentCard, setCurrentCard] = React.useState(null) // { code, balance, name, ... }
  const [transactions, setTransactions] = React.useState([])
  const removeTimer = React.useRef(null)

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
      // The card was taken out of the reader: the window must not keep showing it.
      // The reader bounces removed/inserted while a card sits in it, so wait a moment: only a card that
      // is really gone closes the window and sends the customer back to the home screen.
      if (message.type === 'rfid:card_removed') {
        clearTimeout(removeTimer.current)
        removeTimer.current = setTimeout(() => closeCard(), 3000)
        return
      }
      if (message.type === 'rfid:card_detected') {
        clearTimeout(removeTimer.current)
        const code = message.payload?.cardCode
        if (code) {
          toast({ title: 'Cartão detetado', variant: 'success' })
          loadCard(code).then(() => setCardOpen(true))
        }
      }
    })
    return () => { clearTimeout(removeTimer.current); unsub() }
  }, [])


  function openCard() {
    setCardOpen(true)
    // A card already in the reader (read before this window opened): load it now.
    const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
    const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
    api.request('/middleware/client', { method: 'GET', headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined, skipAuth: true, expect: 'json' })
      .then((s) => { if (s?.hasCard && s?.cardNumber) loadCard(s.cardNumber) })
      .catch(() => {})
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

  // NOTE: `handleRecharge` was removed with the dead `onRecharge` prop it fed.
  // CardModal never called it, so this recharge path could not fire. Recharges
  // go through the cart flow in App.jsx, which sends an idempotency key so a
  // retry after a failure does not credit the card twice.



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
          <div className="w-full max-w-5xl grid grid-cols-2 gap-10">
            {cards.map((c) => (
              <div key={c.id} className="aspect-square transition-all duration-300 hover:-translate-y-2">
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

        <CardModal open={cardOpen} onClose={closeCard} transactions={transactions} balance={Number(currentCard?.balance) || 0} card={currentCard} />

        
        <div className="fixed bottom-0 left-0 right-0 pointer-events-none z-0">
          <Wave height="18vh" className="opacity-90 text-primary-500" />
        </div>
      </div>
      </div>
    </>
  )
}

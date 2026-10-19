import React from 'react'
import i18n from '@/lib/i18n'
import { useNavigate } from 'react-router-dom'
import Wave from '../components/ui/wave'
import Card from '../components/Card'
import CardModal from '../components/CardModal'
import BuyCardModal from '../components/BuyCardModal'
import { toast } from '@/components/ui/Toast'
import Banner from '../components/Banner'
import Loading from '../components/ui/loading'
import LegalModal, { useLegal } from '../components/LegalModal'
import { legalText } from '@/lib/defaultLegal'
import api from '@/services/api'
import { useTranslation } from 'react-i18next'
import { connect, subscribe } from '@/services/websocket'
import { useCart } from '../context/CartContext'

export default function Pos() {
  const { t } = useTranslation('pos')

  const cards = [
    { id: 'wash', title: t('cards.wash.title'), text: t('cards.wash.text'), sub: t('cards.wash.sub') },
    { id: 'dry', title: t('cards.dry.title'), text: t('cards.dry.text'), sub: t('cards.dry.sub') },
    { id: 'card', title: t('cards.card.title'), text: t('cards.card.text'), sub: t('cards.card.sub') },
    { id: 'buyCard', title: t('cards.buyCard.title'), text: t('cards.buyCard.text'), sub: t('cards.buyCard.sub') }
  ]

  // Card component moved to src/components/Card.jsx

  const navigate = useNavigate()
  const { removeRecharges } = useCart()
  const [cardOpen, setCardOpen] = React.useState(false)
  const [buyCardOpen, setBuyCardOpen] = React.useState(false)

  // Real card state — populated when the user taps their RFID card
  const [currentCard, setCurrentCard] = React.useState(null) // { code, balance, name, ... }
  const [transactions, setTransactions] = React.useState([])
  const removeTimer = React.useRef(null)
  const legal = useLegal()
  const [legalKind, setLegalKind] = React.useState(null) // 'privacy' | 'terms' | 'complaints' | null
  // Is the card that triggered the load still in the reader? Set on insert, cleared on removal.
  const cardInReader = React.useRef(false)
  // Bubbles while the card's data comes from the server (the customer has just put the card in).
  const [cardLoading, setCardLoading] = React.useState(0)

  // Load card balance + history from backend
  async function loadCard(code) {
    setCardLoading((n) => n + 1)
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
      // 404: the shop does not know this card: a blank one (or one just wiped), not a fault.
      if (e?.status === 404) toast({ title: i18n.t('cardBlankTitle', { ns: 'cart' }), description: i18n.t('cardBlankText', { ns: 'cart' }), variant: 'warning' })
      else toast({ title: i18n.t('cardLoadError', { ns: 'cart' }), variant: 'destructive' })
    } finally {
      setCardLoading((n) => Math.max(0, n - 1))
    }
  }

  // Subscribe to WS events: RFID tap auto-loads card and opens modal
  // A card that is ALREADY in the reader when this page loads (after a reload, or the screen refreshing itself): the card events
  // were missed, so ask the shop what is in the reader and show it, as if it had just been put in.
  React.useEffect(() => {
    const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
    const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
    api.request('/middleware/client', { method: 'GET', headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined, skipAuth: true, expect: 'json' })
      .then((s) => {
        if (s?.hasCard && s?.cardNumber) {
          cardInReader.current = true
          loadCard(s.cardNumber).then(() => { if (cardInReader.current) setCardOpen(true) })
        }
      })
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    connect()
    const unsub = subscribe((message) => {
      if (!message || typeof message !== 'object') return
      // The card was taken out of the reader: the window must not keep showing it.
      // The reader bounces removed/inserted while a card sits in it, so wait a moment: only a card that
      // is really gone closes the window and sends the customer back to the home screen.
      if (message.type === 'rfid:card_removed') {
        clearTimeout(removeTimer.current)
        cardInReader.current = false
        removeTimer.current = setTimeout(() => {
          // The card is really gone: a top-up waiting in the basket for it could never be paid, so it goes too.
          if (removeRecharges()) toast({ title: i18n.t('rechargeRemoved', { ns: 'cart' }), variant: 'warning' })
          closeCard()
        }, 3000)
        return
      }
      if (message.type === 'rfid:card_detected') {
        clearTimeout(removeTimer.current)
        const code = message.payload?.cardCode
        if (code) {
          cardInReader.current = true
          toast({ title: i18n.t('cardDetected', { ns: 'cart' }), variant: 'success' })
          // The card may be taken out while its data is still coming: then there is nothing to show.
          loadCard(code).then(() => { if (cardInReader.current) setCardOpen(true) })
        }
      }
    })
    return () => { clearTimeout(removeTimer.current); unsub() }
  }, [])


  // The header's card icon asks for this window
  React.useEffect(() => {
    const open = () => openCard()
    window.addEventListener('kiosk:open-card', open)
    return () => window.removeEventListener('kiosk:open-card', open)
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
      <div className="px-10 pt-8">
        <Banner />
      </div>
<div className='flex-1 container mx-auto p-4'>
      <div className="relative min-h-[calc(100vh-35rem)] flex flex-col z-10">
        {/* Cards Grid */}
        <div className="grow flex items-center justify-center px-6 pb-32">
          <div className="w-full max-w-[920px] grid grid-cols-2 gap-8">
            {cards.map((c) => (
              <div key={c.id} className="min-h-[400px]">
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

        {cardLoading > 0 && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
            <div className="bg-white rounded-3xl shadow-2xl px-14 py-6">
              <Loading label={i18n.t('cardLoading', { ns: 'cart' })} />
            </div>
          </div>
        )}

        <CardModal open={cardOpen} onClose={closeCard} transactions={transactions} balance={Number(currentCard?.balance) || 0} card={currentCard} onProfileSaved={(c) => c && setCurrentCard((cur) => ({ ...cur, ...c }))} />

        
        <div className="fixed bottom-0 left-0 right-0 z-10 bg-white/90 backdrop-blur-md border-t border-emerald-100/80 px-6 py-3 flex items-center justify-between gap-3 text-base font-medium text-slate-600">
          <span className="flex items-center gap-3 shrink-0">
            <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 ring-4 ring-emerald-200" />
            <span className="font-bold text-slate-800">{t('home.ready')}</span>
          </span>
          <div className="flex items-center gap-2">
            {legalText(legal.privacy, 'pt') && (
              <button type="button" onClick={() => setLegalKind('privacy')} className="h-14 px-4 rounded-xl text-emerald-800 font-semibold active:bg-emerald-50">{i18n.t('legalPrivacyShort', { ns: 'cart' })}</button>
            )}
            {legalText(legal.terms, 'pt') && (
              <button type="button" onClick={() => setLegalKind('terms')} className="h-14 px-4 rounded-xl text-emerald-800 font-semibold active:bg-emerald-50">{i18n.t('legalTermsShort', { ns: 'cart' })}</button>
            )}
            {legal.complaintsUrl && (
              <button type="button" onClick={() => setLegalKind('complaints')} className="h-14 px-4 rounded-xl text-emerald-800 font-semibold active:bg-emerald-50">{i18n.t('legalComplaints', { ns: 'cart' })}</button>
            )}
          </div>
          {(legal.phone || legal.email) && (
            <span className="shrink-0 text-slate-500">{[legal.phone, legal.email].filter(Boolean).join(' · ')}</span>
          )}
        </div>
        <LegalModal open={Boolean(legalKind)} kind={legalKind} onClose={() => setLegalKind(null)} />
      </div>
      </div>
    </>
  )
}

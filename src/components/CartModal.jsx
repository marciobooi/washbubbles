import React from 'react'
import Modal from './ui/Modal'
import { useTranslation } from 'react-i18next'
import { useCart } from '../context/CartContext'
import CashModal from './CashModal'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import * as websocket from '@/services/websocket'
import * as localApi from '@/services/local-api'

let cachedLogo = null
function useShopLogo() {
  const [logo, setLogo] = React.useState(cachedLogo)
  React.useEffect(() => {
    let alive = true
    if (!cachedLogo) {
      api.getPublicSetting('branding.logo')
        .then((r) => { const v = r && r.value ? String(r.value) : null; if (v) cachedLogo = v; if (alive) setLogo(v) })
        .catch(() => {})
    }
    const onBrand = (e) => { const v = e?.detail?.logo; if (v) { cachedLogo = v; setLogo(v) } }
    window.addEventListener('branding:update', onBrand)
    return () => { alive = false; window.removeEventListener('branding:update', onBrand) }
  }, [])
  return logo
}

export default function CartModal({ open, onClose, onPay = () => {}, onClear = () => {} }) {
  const { t, i18n } = useTranslation('cart')
  const shopLogo = useShopLogo()
  const { cart, removeFromCart, clearCart, credit, setQuantity } = useCart()
  const [showCash, setShowCash] = React.useState(false)
  // Staff-only manual payment, for when the coin acceptor or card reader is down.
  // Gated behind the operator's admin PIN so a customer cannot self-serve a wash.
  const [showPinPrompt, setShowPinPrompt] = React.useState(false)
  const [pin, setPin] = React.useState('')
  const [pinError, setPinError] = React.useState(null)
  const [checkingPin, setCheckingPin] = React.useState(false)
  const [manualUnlocked, setManualUnlocked] = React.useState(false)
  const [cardError, setCardError] = React.useState(null)

  // Card-pay flow (loyalty card)
  const [showCardPrompt, setShowCardPrompt] = React.useState(false)
  const [cardCode, setCardCode] = React.useState('')
  const [checkingCard, setCheckingCard] = React.useState(false)
  const [cardBalance, setCardBalance] = React.useState(null)
  const [cardNeedsTopup, setCardNeedsTopup] = React.useState(false)
  const [topupAmount, setTopupAmount] = React.useState(0)

  // Auto-detection state
  // Cash inserted so far: tracked app-wide in CartContext so it is also visible before
  // a machine is chosen and is not lost when this window closes.
  const cashInserted = credit
  const autoPaid = React.useRef(false)
  const [detectedCardCode, setDetectedCardCode] = React.useState(null)

  // Local (offline) session credit — kept separate from `cashInserted` above,
  // which tracks the legacy remote-websocket hardware pipeline.
  const [localSession, setLocalSession] = React.useState(null)
  const [cashingOut, setCashingOut] = React.useState(false)

  // Coupon code — validated server-side at checkout (services/coupons.js),
  // never computed here. A non-empty code forces the payment through the
  // network gateway even when local/offline credit would otherwise cover
  // it, since only the server can check and redeem it.
  const [couponCode, setCouponCode] = React.useState('')

  // Separate purchase items (machines/services) from recharge items
  // A machine costs its CASH price unless a card is really in the reader (then its card price).
  // The cart item's plain `price` is the card price, so using it made every cash customer see
  // (and auto-pay) the cheaper card amount.
  const cardMode = Boolean(detectedCardCode)
  const unitPrice = (i) => {
    const v = cardMode ? (i.cardPrice ?? i.price) : (i.cashPrice ?? i.price)
    const qty = i.type === 'dry' ? Math.max(1, Math.min(8, Math.floor(Number(i.quantity)) || 1)) : 1
    return Math.round((Number(v ?? i.amount ?? 0) || 0) * qty * 100) / 100
  }
  const purchaseTotal = cart.reduce((s, i) => (i.type === 'Recarga de Cartão' ? s : s + unitPrice(i)), 0)
  const rechargeTotal = cart.reduce((s, i) => (i.type === 'Recarga de Cartão' ? s + (i.price || i.amount || 0) : s), 0)
  // Cents, never float dust (0.1 + 0.2): `paid >= total` below must be true when the exact amount is in.
  const total = Math.round((purchaseTotal + rechargeTotal) * 100) / 100

  // Check if cart contains recharge items
  const hasRecharge = rechargeTotal > 0

  // A dryer is sold in blocks of 15 minutes and the customer picks how many with + / -. If the money is
  // already there the cart used to pay the instant it opened, so the number was never chosen. For dryers
  // nothing is paid until the customer presses "Confirmar", and changing the number asks again.
  // Every payment waits for the customer's tap on "Confirmar e iniciar" (washers too): nothing is charged by itself.
  const needsConfirm = cart.length > 0
  const cartSig = cart.map((i) => `${i.id}:${i.quantity || 1}`).join('|')
  const [confirmedSig, setConfirmedSig] = React.useState(null)
  const confirmed = !needsConfirm || confirmedSig === cartSig
  const confirmedRef = React.useRef(true)
  confirmedRef.current = confirmed

  // Fit the window to THIS screen: the kiosk is not a fixed size (1920x1080 today, maybe 1366x768 or a
  // portrait panel tomorrow). Measure the content at natural size and scale it down so it fits the height.
  const fitRef = React.useRef(null)
  const fitKey = cart.map((i) => `${i.id}:${i.quantity || 1}`).join('|') + `|${Math.round(credit * 100)}|${confirmed}`
  React.useLayoutEffect(() => {
    if (!open) return undefined
    // The design is laid out at a fixed 528 px content width (its own sizes and weights) and scaled as a
    // whole: to the modal's width first, then down if the screen is not tall enough.
    const DESIGN_W = 528
    const fit = () => {
      const el = fitRef.current
      if (!el) return
      const parent = el.parentElement
      const cs = getComputedStyle(parent)
      const innerW = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const wantW = innerW > 0 ? innerW / DESIGN_W : 1
      el.style.width = DESIGN_W + 'px'
      el.style.zoom = '1'
      const natural = el.scrollHeight // at the design's own scale
      const avail = window.innerHeight * 0.94 - 56 // dialog padding + a little air
      const z = natural > 0 ? Math.max(0.5, Math.min(wantW, avail / natural)) : wantW
      el.style.zoom = String(z)
      el.style.marginInline = 'auto'
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open, fitKey])
  const pendingCardRef = React.useRef(null)

  // Listen for hardware events (coins, bills, cards)
  React.useEffect(() => {
    if (!open) {
      // Reset detection state when modal closes
      autoPaid.current = false
      setConfirmedSig(null)
      pendingCardRef.current = null
      setDetectedCardCode(null)
      setLocalSession(null)
      setCouponCode('')
      return
    }

    const unsubscribe = websocket.subscribe((data) => {
      if (!data || typeof data !== 'object') return

      // (Coin/bill credit events are handled app-wide in CartContext.)

      // Handle rejected coin/bill
      if (data.type === 'peripheral:rejected') {
        const { type, reason } = data.payload || {}
        const reasonLabel = reason === 'inhibited' ? t('reasonInhibited') : reason === 'unrecognised' ? t('reasonUnrecognised') : t('reasonRejected')
        console.warn('[CartModal] Peripheral rejected:', type, reason)
        toast({ title: type === 'bill' ? t('rejectedBill', { reason: reasonLabel }) : t('rejectedCoin', { reason: reasonLabel }), description: t('insertOther'), variant: 'destructive' })
      }

      // Handle fake/counterfeit bill
      if (data.type === 'peripheral:fraud') {
        const { type } = data.payload || {}
        console.error('[CartModal] Fraud detected:', type)
        toast({ title: type === 'bill' ? t('fraudBill') : t('fraudCoin'), description: t('fraudHint'), variant: 'destructive' })
      }

      // Handle peripheral fault (jam, stacker full)
      if (data.type === 'peripheral:fault') {
        const { type, reason } = data.payload || {}
        const reasonLabel = reason === 'jam' ? t('faultJam') : reason === 'stacker_full' ? t('faultStacker') : t('faultOther')
        console.error('[CartModal] Peripheral fault:', type, reason)
        toast({ title: type === 'bill' ? t('faultBill') : t('faultCoin'), description: t('faultHint', { reason: reasonLabel }), variant: 'destructive' })
      }

      // Handle hopper empty / change cannot be dispensed
      if (data.type === 'hopper:empty') {
        console.error('[CartModal] Hopper empty')
        toast({ title: t('noChange'), description: t('noChangeHint'), variant: 'destructive' })
      }

      // Handle hopper fault
      if (data.type === 'hopper:fault') {
        const { reason } = data.payload || {}
        console.error('[CartModal] Hopper fault:', reason)
        toast({ title: t('changeFailed'), description: t('contactOperator'), variant: 'destructive' })
      }

      // The card was taken out of the reader: back to the cash price.
      if (data.type === 'rfid:card_removed') {
        setDetectedCardCode(null)
      }

      // Handle RFID card detection
      if (data.type === 'rfid:card_detected') {
        const { cardCode } = data.payload || {}
        if (cardCode) {
          console.log('[CartModal] Card detected:', cardCode)
          setDetectedCardCode(cardCode)
          toast({ title: t('cardDetected'), variant: 'success' })
          
          // Auto-process card payment (a dryer waits for the customer's confirmation first)
          if (!confirmedRef.current) {
            pendingCardRef.current = cardCode
          } else {
            setTimeout(() => {
              handleCardPayAutomatic(cardCode)
            }, 500)
          }
        }
      }
    })

    return unsubscribe
  }, [open, total])

  // A card that was ALREADY in the reader when this window opened (put in earlier, to look at the balance): its 'inserted' event
  // is long gone, so ask the shop what is in the reader and treat it as if it had just been presented.
  React.useEffect(() => {
    if (!open) return undefined
    let alive = true
    const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
    const key = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
    api.request('/middleware/client', { method: 'GET', headers: key ? { Authorization: `ApiKey ${key}` } : undefined, skipAuth: true, expect: 'json' })
      .then((s) => {
        if (!alive || !s?.hasCard || !s?.cardNumber) return
        const code = String(s.cardNumber)
        setDetectedCardCode(code)
        if (!confirmedRef.current) pendingCardRef.current = code
        else setTimeout(() => handleCardPayAutomatic(code), 500)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [open])

  // Pay automatically once the cash inserted covers the cart — whether the coins went in
  // before or after the machine was chosen.
  React.useEffect(() => {
    if (!open || autoPaid.current) return
    if (!confirmed) return
    if (total > 0 && credit >= total) {
      autoPaid.current = true
      setTimeout(() => handleCashConfirm(credit), 500)
    }
  }, [open, credit, total, confirmed])

  // The customer confirmed: pay the card that was already presented, if any (cash is paid by the effect above).
  function confirmCart() {
    setConfirmedSig(cartSig)
    const code = pendingCardRef.current || detectedCardCode
    pendingCardRef.current = null
    if (code && credit < total) setTimeout(() => handleCardPayAutomatic(code), 300)
  }

  // Embedded hardware agent's own RFID tap, straight over IPC — no network
  // hop, works with the kiosk fully offline. Separate from the websocket
  // listener above (that one relays a different, legacy hardware pipeline —
  // see AUDIT-FINDINGS.md Round 8); a site could have either, so both listen.
  React.useEffect(() => {
    if (!open || !localApi.isElectron) return
    const electron = window.electronAPI
    let autoPayFired = false

    const onLoaded = ({ card }) => {
      if (!card?.code) return
      console.log('[CartModal] Local card detected:', card.code)
      setDetectedCardCode(card.code)
      toast({ title: t('cardDetected'), variant: 'success' })
      // nothing is charged until the customer confirms
      if (!confirmedRef.current) pendingCardRef.current = card.code
      else setTimeout(() => handleCardPayAutomatic(card.code), 500)
    }
    const onBlocked = ({ status }) => {
      toast({
        title: status === 'pending_write' ? t('cardNotActivated') : t('cardBlocked'),
        description: status === 'pending_write' ? t('cardNotActivatedHint') : t('seeCounter'),
        variant: 'destructive',
      })
    }
    // Live local credit, straight from the embedded hardware agent — updates
    // the instant a coin lands, offline included, and auto-confirms cash
    // payment once it covers the cart, same as the legacy websocket path
    // does for `cashInserted` above.
    const onSession = (session) => {
      setLocalSession(session)
      if (!autoPayFired && session && session.credits >= total && total > 0) {
        autoPayFired = true
        setTimeout(() => handleCashConfirm(session.credits), 500)
      }
    }
    electron.onCardLoaded(onLoaded)
    electron.onCardBlocked(onBlocked)
    electron.onSessionUpdate(onSession)
    localApi.getSession().then((s) => s && setLocalSession(s))
    // preload exposes no removeListener — these accumulate for the life of
    // the renderer, same as the existing onSaleCompleted/onSyncStatusChanged
    // listeners elsewhere in this app; harmless since only one renderer ever
    // runs at a time.
  }, [open, total])

  async function handleCashOut() {
    setCashingOut(true)
    try {
      const result = await localApi.cashOut()
      if (result.amount > 0) {
        toast({
          title: result.success ? t('changeGiven', { amount: `${result.amount.toFixed(2)}€` }) : t('changeFailed'),
          description: result.success ? t('takeMoney') : t('dispenserDown'),
          variant: result.success ? 'success' : 'destructive',
        })
      }
    } catch (e) {
      toast({ title: t('changeError'), description: e?.message, variant: 'destructive' })
    } finally {
      setCashingOut(false)
    }
  }

  async function handleCardPayAutomatic(code) {
    // Auto-pay with detected card
    console.log('[CartModal] Auto-processing card payment with code:', code)
    setCheckingCard(true)
    setCardError(null)
    try {
      await onPay(cart, { method: 'card', cardCode: code, couponCode: couponCode || undefined })
      onClose()
    } catch (e) {
      console.error('Auto card payment failed', e)
      setCardError(e?.message || t('cardPayError'))
      toast({ title: t('paymentError'), description: e?.message, variant: 'error' })
    } finally {
      setCheckingCard(false)
    }
  }

  async function handleCardPay() {
    // If recharges already cover purchases, keep old behaviour (no external card required)
    const short = Math.max(0, Math.round((purchaseTotal - rechargeTotal) * 100) / 100)
    if (short <= 0) {
      // proceed with card payment using cart recharges
      onPay(cart, { method: 'card', couponCode: couponCode || undefined })
      onClose()
      return
    }

    // Otherwise, prompt for card code so we can attempt to use a loyalty card
    setCardError(null)
    setCardCode('')
    setCardBalance(null)
    setCardNeedsTopup(false)
    setTopupAmount(0)
    setShowCardPrompt(true)
  }

  async function checkCardAndPay() {
    // Use central checkout to persist recharges and charge via card gateway
    setCheckingCard(true)
    setCardError(null)
    try {
      if (!cardCode) {
        setCardError(t('cardEnterCode'))
        setCheckingCard(false)
        return
      }

      // Delegate payment to the main handler — it will persist recharges and charge machines using cardCode
      await onPay(cart, { method: 'card', cardCode, couponCode: couponCode || undefined })
      setShowCardPrompt(false)
      onClose()
    } catch (e) {
      console.error('Card payment failed', e)
      setCardError(e?.message || t('cardPayError'))
    } finally {
      setCheckingCard(false)
    }
  }

  async function topupCardAndRetry() {
    // Attempt to recharge the card by topupAmount, then retry payment
    setCheckingCard(true)
    try {
      const amount = Number(topupAmount)
      if (!amount || amount <= 0) {
        setCardError(t('topupInvalid'))
        setCheckingCard(false)
        return
      }

      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
      const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY

      // Use gateways topup for card code
      await api.gatewayTopupCard(cardCode, { amount }, { apiKey: kioskKey })

      toast({ title: t('toppedUp', { amount: `${amount.toFixed(2)}€` }), variant: 'success' })
      // Now attempt payment again
      await checkCardAndPay()
    } catch (e) {
      console.error('Topup failed', e)
      setCardError(t('topupError'))
    } finally {
      setCheckingCard(false)
    }
  }

  /**
   * Unlock manual payment after checking the admin PIN with the server.
   *
   * The PIN is verified server-side and never fetched to the client — this
   * terminal is unattended and public, so a client-side comparison would be
   * decorative.
   */
  async function verifyPinAndUnlock() {
    setCheckingPin(true)
    setPinError(null)
    try {
      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
      const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
      await api.verifyAdminPin(pin, { apiKey: kioskKey })
      setManualUnlocked(true)
      setShowPinPrompt(false)
      setPin('')
    } catch (e) {
      if (e?.status === 409) {
        setPinError(t('pinNone'))
      } else if (e?.status === 429) {
        setPinError(t('pinTooMany'))
      } else {
        setPinError(t('pinInvalid'))
      }
      setPin('')
    } finally {
      setCheckingPin(false)
    }
  }

  function closeManual() {
    setManualUnlocked(false)
    setShowPinPrompt(false)
    setPin('')
    setPinError(null)
  }

  function openCashModal() {
    setCardError(null)
    setShowCash(true)
  }

  async function handleCashConfirm(inserted) {
    // Call onPay with cash method and inserted amount
    onPay(cart, { method: 'cash', inserted, couponCode: couponCode || undefined })
    setShowCash(false)
    onClose()
  }

  return (
    <>
    <Modal open={open} onClose={onClose} title={t('title')} hideClose={true} maxWidth="min(68vw, 768px)" shiftDownVh={3}>
      <div ref={fitRef} className="flex flex-col gap-6">
        {cart.length === 0 ? (
          <div className="text-center py-8">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-3 opacity-20 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="text-neutral-400 mb-6">{t('empty')}</p>
            <button 
              onClick={onClose}
              className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-semibold transition-all"
            >
              {t('closeBtn')}
            </button>
          </div>
        ) : (
          <>
            {/* ---- Payment window (design of 2026-10-12): the mock's own sizes at a 528 px layout width,
                 scaled up to the modal by the fit effect, so it looks like the design on the real screen ---- */}
            {(() => {
              const machineItems = cart.filter((i) => i.type !== 'Recarga de Cartão')
              const single = machineItems.length === 1 && !hasRecharge ? machineItems[0] : null
              const paid = Math.round(credit * 100) / 100
              const remaining = Math.max(0, Math.round((total - paid) * 100) / 100)
              const change = Math.max(0, Math.round((paid - total) * 100) / 100)
              // 100% only when it is really paid in full (rounding 99.6 up to 100 would show a full bar while 0.0x is missing)
              const percent = total > 0 ? (paid >= total ? 100 : Math.min(99, Math.floor((paid / total) * 100 + 1e-9))) : 0
              const enough = total > 0 && paid >= total
              const waitingConfirm = needsConfirm && !confirmed && (enough || detectedCardCode)
              const label = enough
                ? (waitingConfirm ? t('statusEnough') : t('statusDone'))
                : paid > 0 ? t('statusReceiving') : t('statusWaiting')
              const eur = (n) => `${Number(n).toFixed(2).replace('.', i18n.language === 'en' ? '.' : ',')}€`
              const gapOf = (i) => Number(i.tImp) || 15
              const qtyOf = (i) => (i.type === 'dry' ? Math.max(1, Math.min(8, Math.floor(Number(i.quantity)) || 1)) : 1)
              const perCycle = (i) => unitPrice({ ...i, quantity: 1 })
              const badge = (i) => {
                const n = i.number ?? (String(i.name || '').match(/\d+/) || [''])[0]
                return n === '' || n == null ? '•' : String(n)
              }
              const dryers = cart.filter((i) => i.type === 'dry')

              return (
                <div className="flex flex-col gap-6 text-slate-800 antialiased">
                  {/* Header */}
                  <header className="flex items-center justify-between border-b border-slate-100/90 pb-4">
                    <div className="flex items-center gap-3.5">
                      {shopLogo ? (
                        <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-sm ring-4 ring-teal-50 overflow-hidden">
                          <img src={shopLogo} alt="" className="w-full h-full object-contain p-1" />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-2xl bg-teal-500 text-white font-bold flex items-center justify-center text-lg shadow-sm ring-4 ring-teal-50">
                          {single ? badge(single) : '🛒'}
                        </div>
                      )}
                      <div>
                        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                          {single ? (single.name || single.type) : t('title')}
                        </h1>
                        <p className="text-xs font-semibold text-slate-600 mt-0.5">
                          {single
                            ? (single.type === 'dry' ? t('baseDuration', { min: gapOf(single) }) : `${single.weight ? single.weight + ' kg' : t('wash')}`)
                            : t('items', { count: cart.length })}
                        </p>
                      </div>
                    </div>
                    <button
                      aria-label={t('close')}
                      type="button"
                      onClick={onClose}
                      className="w-11 h-11 rounded-full bg-slate-100 text-slate-400 hover:text-rose-500 hover:bg-rose-50 active:scale-95 flex items-center justify-center transition-all"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </header>

                  {/* More than one item: one compact row each */}
                  {!single && (
                    <div className="space-y-2">
                      {cart.map((i) => (
                        <div key={i.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                          <div className="text-sm font-bold text-slate-800">{i.type === 'Recarga de Cartão' ? t('rechargeName', { amount: Number(i.price || i.amount || 0) }) : (i.name || i.type)}</div>
                          <div className="flex items-center gap-3">
                            <div className="text-base font-bold text-slate-800">{(i.type === 'Recarga de Cartão' ? (i.price || i.amount || 0) : unitPrice(i)).toFixed(2)}€</div>
                            <button
                              type="button"
                              aria-label={t('remove')}
                              onClick={() => {
                                const left = cart.filter((x) => x.id !== i.id).length
                                removeFromCart(i.id)
                                if (left === 0) onClose()
                              }}
                              className="w-9 h-9 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center active:scale-90"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Cycles (dryers only) */}
                  {dryers.map((i) => {
                    const q = qtyOf(i)
                    const gap = gapOf(i)
                    return (
                      <div key={i.id} className="space-y-4">
                        {!single && <div className="text-sm font-bold text-teal-900">{i.name}</div>}
                        <div>
                          <div className="flex items-center justify-between mb-2.5">
                            <span className="text-xs text-emerald-800 font-bold bg-emerald-100/80 px-2.5 py-1 rounded-md">{t('quick')}</span>
                          </div>
                          <div className="grid gap-2.5 grid-cols-3 w-full">
                            {[1, 2, 3].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setQuantity(i.id, n)}
                                className={`relative min-h-[64px] py-3.5 px-2 rounded-2xl text-xs font-bold border text-center flex flex-col items-center justify-center gap-1 shadow-sm active:scale-95 transition-all ${q === n ? 'border-2 border-teal-500 bg-teal-50/80 text-teal-800 ring-2 ring-teal-500/10' : 'border-slate-200 bg-white text-slate-700 hover:border-teal-400 hover:bg-teal-50/40'}`}
                              >
                                {n === 2 && <span className="absolute -top-2.5 bg-teal-600 text-[9px] text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-tight shadow-sm">{t('mostUsed')}</span>}
                                <span className={`text-base font-extrabold ${q === n ? 'text-teal-900' : 'text-slate-800'}`}>{t('minutes', { n: n * gap })}</span>
                                <span className={`text-xs ${q === n ? 'text-teal-700 font-semibold' : 'text-slate-400 font-medium'}`}>{eur(perCycle(i) * n)}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="bg-teal-50/40 border border-teal-100 rounded-2xl p-4 sm:p-5 flex items-center justify-between">
                          <div className="flex items-center justify-between w-full gap-3 sm:gap-4">
                            <button
                              type="button"
                              aria-label={t('less')}
                              disabled={q <= 1}
                              onClick={() => setQuantity(i.id, q - 1)}
                              className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-50 active:scale-90 text-slate-700 flex items-center justify-center shadow-sm transition-all disabled:opacity-30 shrink-0"
                            >
                              <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 12h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                            <div className="flex-1 flex flex-col items-center justify-center text-center select-none">
                              <span className="text-xs font-bold text-teal-800 uppercase tracking-wider mb-0.5">{t('selectedTime')}</span>
                              <span className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight tabular-nums">{t('minutes', { n: q * gap })}</span>
                              <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 mt-1">
                                <span className="bg-white/80 border border-teal-100 px-2 py-0.5 rounded-full text-teal-800 font-bold">{t('cycles', { count: q, gap })}</span>
                                <span className="text-slate-400">•</span>
                                <span className="text-slate-500 font-medium">{t('perCycle', { price: eur(perCycle(i)) })}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              aria-label={t('more')}
                              disabled={q >= 8}
                              onClick={() => setQuantity(i.id, q + 1)}
                              className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-50 active:scale-90 text-slate-700 flex items-center justify-center shadow-sm transition-all disabled:opacity-30 shrink-0"
                            >
                              <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Promo code (collapsed) */}
                  <details className="group border-t border-slate-100 pt-3.5">
                    <summary className="flex items-center justify-between text-xs sm:text-sm font-semibold text-teal-700 cursor-pointer list-none select-none py-1.5">
                      <span className="flex items-center gap-2 text-teal-900 font-bold">
                        <svg className="w-4 h-4 text-teal-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        {t('promo')}<span className="text-slate-600 font-medium">{t('optional')}</span>
                      </span>
                      <svg className="w-4 h-4 text-slate-600 group-open:rotate-180 transition-transform duration-200" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </summary>
                    <div className="pt-2.5 flex items-center gap-2.5">
                      <input
                        id="cart-coupon-code"
                        type="text"
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                        placeholder={t('promoPlaceholder')}
                        className="w-full h-12 bg-slate-50 hover:bg-white focus:bg-white text-xs sm:text-sm text-slate-800 placeholder-slate-400 font-medium uppercase tracking-wider rounded-xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 px-3.5 transition-all outline-none"
                      />
                    </div>
                  </details>

                  {/* Total */}
                  <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-4 sm:p-5 text-white shadow-md flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-emerald-400 block tracking-wide uppercase">{t('totalToPay')}</span>
                      <span className="text-xs text-slate-200 font-medium">
                        {hasRecharge ? t('includesRecharge', { amount: eur(rechargeTotal) }) : t('coinsNotes')}
                      </span>
                      {cardError && <span className="block text-xs text-rose-300 font-semibold mt-1">{cardError}</span>}
                    </div>
                    <div className="text-right flex items-baseline gap-1">
                      <span className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight tabular-nums">{eur(total)}</span>
                    </div>
                  </div>

                  {/* Payment status */}
                  <div className="bg-teal-50/70 border border-teal-100 rounded-2xl p-4 sm:p-5 space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                        </span>
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">{label}</span>
                      </div>
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider bg-white/80 border border-emerald-100 px-2 py-0.5 rounded-full">{t('chip')}</span>
                    </div>

                    <div className="bg-white/95 border border-emerald-200/60 rounded-xl p-4 flex items-center gap-3.5 shadow-sm">
                      <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                        <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect height="12" rx="2" width="20" x="2" y="6" /><circle cx="12" cy="12" r="3" /><path d="M6 12h.01M18 12h.01" strokeLinecap="round" /></svg>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm sm:text-base font-bold text-slate-800">{t('insertHere')}</p>
                        <p className="text-xs font-semibold text-slate-600 mt-0.5">{t('accepted')}</p>
                      </div>
                    </div>

                    <div className="bg-white border-2 border-emerald-200/80 rounded-xl p-3.5 sm:p-4 shadow-sm space-y-3">
                      <div className="grid grid-cols-2 gap-3 divide-x divide-slate-100">
                        <div className="pr-2">
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">{t('inserted')}</span>
                          <div className="flex items-baseline gap-1 mt-0.5">
                            <span className="text-2xl font-bold text-slate-800 tracking-tight tabular-nums">{eur(paid)}</span>
                          </div>
                        </div>
                        <div className="pl-3">
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">{change > 0 ? t('change') : t('missing')}</span>
                          <div className="flex items-baseline gap-1 mt-0.5">
                            <span className={`text-2xl font-bold tracking-tight tabular-nums ${enough ? 'text-emerald-600' : 'text-slate-800'}`}>{change > 0 ? eur(change) : eur(remaining)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1.5 pt-1 border-t border-slate-100">
                        <div className="flex justify-between items-center text-xs font-bold text-slate-600">
                          <span>{t('progress')}</span>
                          <span className="text-slate-600 font-bold tabular-nums">{percent}%</span>
                        </div>
                        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/80">
                          <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    </div>

                    {/* Dryer: nothing is paid until the customer has chosen the cycles and confirms */}
                    {waitingConfirm && total > 0 && (
                      <button
                        type="button"
                        onClick={confirmCart}
                        className="w-full min-h-[54px] rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-base font-bold shadow-md active:scale-[0.99] transition-all"
                      >
                        {t('confirm')} · {eur(total)}
                      </button>
                    )}

                    {localApi.isElectron && localSession && localSession.credits > 0 && (
                      <div className="p-3 bg-white rounded-xl text-sm text-slate-600">
                        {t('credit')}: <span className="font-bold text-teal-700">{localSession.credits.toFixed(2)}€</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="space-y-3 pt-1">
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 min-h-[54px] py-3.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-bold text-sm sm:text-base transition-all duration-150 active:scale-[0.99]"
                      >
                        {t('cancel')}
                      </button>
                      {localApi.isElectron && localSession && localSession.cashBalance > 0 && (
                        <button
                          type="button"
                          onClick={handleCashOut}
                          disabled={cashingOut}
                          className="flex-1 min-h-[54px] rounded-xl bg-amber-100 text-amber-800 hover:bg-amber-200 font-bold text-sm sm:text-base transition-all disabled:opacity-50"
                        >
                          {cashingOut ? t('cashOutBusy') : t('cashOut', { amount: eur(localSession.cashBalance) })}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setPinError(null); setShowPinPrompt(true) }}
                      className="w-full min-h-[48px] py-2.5 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 font-semibold text-xs sm:text-sm inline-flex items-center justify-center gap-2 transition-all duration-150 shadow-sm active:scale-[0.99]"
                    >
                      <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      {t('manual')}
                    </button>
                  </div>
                </div>
              )
            })()}
          </>
        )}
      </div>
      {/* Card pay prompt */}
      {showCardPrompt && (
        <Modal open={showCardPrompt} onClose={() => setShowCardPrompt(false)} title={t('cardPayTitle')}>
          <div className="flex flex-col gap-4">
            <label className="text-sm">{t('cardCodeLabel')}</label>
            <input value={cardCode} onChange={(e) => setCardCode(e.target.value)} className="p-3 rounded-lg border" placeholder={t('cardCodePlaceholder')} />
            {checkingCard && <div className="text-sm text-neutral-500">{t('checking')}</div>}
            {cardError && <div className="text-sm text-red-600 font-semibold">{cardError}</div>}
            {cardBalance != null && <div className="text-sm text-neutral-600">{t('cardBalance')}: <span className="font-semibold">{cardBalance.toFixed(2)}€</span></div>}

            {cardNeedsTopup ? (
              <div className="flex flex-col gap-2">
                <label className="text-sm">{t('topupLabel')}</label>
                <div className="flex gap-2">
                  {[5,10,20].map((a)=> (
                    <button key={a} onClick={() => setTopupAmount(a)} className={`py-2 px-3 rounded-lg ${topupAmount===a?'bg-teal-600 text-white':'bg-neutral-100'}`}>{a}€</button>
                  ))}
                </div>
                <input value={topupAmount} onChange={(e)=>setTopupAmount(Number(e.target.value))} className="p-3 rounded-lg border" />
                <div className="flex gap-2">
                  <button onClick={() => setShowCardPrompt(false)} className="flex-1 py-2 rounded-lg border">{t('cancel')}</button>
                  <button onClick={topupCardAndRetry} disabled={checkingCard} className={`flex-1 py-2 rounded-lg ${checkingCard ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}>{t('topupAndPay')}</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setShowCardPrompt(false)} className="flex-1 py-2 rounded-lg border">{t('cancel')}</button>
                <button onClick={checkCardAndPay} disabled={checkingCard} className={`flex-1 py-2 rounded-lg ${checkingCard ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}>{t('confirmPay')}</button>
              </div>
            )}
          </div>
        </Modal>
      )}

    </Modal>
    {/* cash insert modal */}
    {/* Admin PIN gate */}
    {showPinPrompt && (
      <Modal open={showPinPrompt} onClose={() => { setShowPinPrompt(false); setPin(''); setPinError(null) }} title={t('pinTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            {t('pinText')}
          </p>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && pin && !checkingPin) verifyPinAndUnlock() }}
            placeholder={t('pinPlaceholder')}
            className="w-full px-4 py-3 rounded-lg border border-neutral-300 text-center text-2xl tracking-widest"
          />
          {pinError && <div className="text-sm text-red-600 font-semibold">{pinError}</div>}
          <div className="flex gap-2">
            <button onClick={() => { setShowPinPrompt(false); setPin(''); setPinError(null) }} className="flex-1 py-2 rounded-lg border">{t('cancel')}</button>
            <button
              onClick={verifyPinAndUnlock}
              disabled={checkingPin || !pin}
              className={`flex-1 py-2 rounded-lg ${checkingPin || !pin ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}
            >
              {checkingPin ? t('pinChecking') : t('pinUnlock')}
            </button>
          </div>
        </div>
      </Modal>
    )}

    {/* Unlocked: choose a manual payment method */}
    {manualUnlocked && !showCash && !showCardPrompt && (
      <Modal open={manualUnlocked} onClose={closeManual} title={t('pinTitle')}>
        <div className="space-y-4">
          <div className="text-sm text-neutral-600">{t('totalCharge')}</div>
          <div className="text-3xl font-bold text-teal-600">{total.toFixed(2)}€</div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={openCashModal} className="py-4 rounded-lg bg-teal-600 text-white font-semibold">{t('cash')}</button>
            <button onClick={handleCardPay} className="py-4 rounded-lg bg-neutral-800 text-white font-semibold">{t('card')}</button>
          </div>
          <button onClick={closeManual} className="w-full py-2 rounded-lg border">{t('cancel')}</button>
        </div>
      </Modal>
    )}

    <CashModal open={showCash} total={total} onClose={() => { setShowCash(false); closeManual() }} onConfirm={handleCashConfirm} />
    </>
  )
}

import React from 'react'
import Modal from './ui/Modal'
import { useCart } from '../context/CartContext'
import CashModal from './CashModal'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import * as websocket from '@/services/websocket'
import * as localApi from '@/services/local-api'

export default function CartModal({ open, onClose, onPay = () => {}, onClear = () => {} }) {
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
  const total = purchaseTotal + rechargeTotal

  // Check if cart contains recharge items
  const hasRecharge = rechargeTotal > 0

  // Listen for hardware events (coins, bills, cards)
  React.useEffect(() => {
    if (!open) {
      // Reset detection state when modal closes
      autoPaid.current = false
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
        const label = type === 'bill' ? 'Nota' : 'Moeda'
        const reasonLabel = reason === 'inhibited' ? 'não aceite' : reason === 'unrecognised' ? 'não reconhecida' : 'rejeitada'
        console.warn('[CartModal] Peripheral rejected:', type, reason)
        toast({ title: `${label} ${reasonLabel}`, description: 'Por favor insira outro dinheiro.', variant: 'destructive' })
      }

      // Handle fake/counterfeit bill
      if (data.type === 'peripheral:fraud') {
        const { type } = data.payload || {}
        const label = type === 'bill' ? 'nota' : 'moeda'
        console.error('[CartModal] Fraud detected:', type)
        toast({ title: `⚠️ ${label.charAt(0).toUpperCase() + label.slice(1)} suspeita de fraude`, description: 'A nota foi retida. Por favor contacte o operador.', variant: 'destructive' })
      }

      // Handle peripheral fault (jam, stacker full)
      if (data.type === 'peripheral:fault') {
        const { type, reason } = data.payload || {}
        const label = type === 'bill' ? 'leitor de notas' : 'leitor de moedas'
        const reasonLabel = reason === 'jam' ? 'encravamento' : reason === 'stacker_full' ? 'stacker cheio' : 'avaria'
        console.error('[CartModal] Peripheral fault:', type, reason)
        toast({ title: `Avaria no ${label}`, description: `${reasonLabel.charAt(0).toUpperCase() + reasonLabel.slice(1)} — contacte o operador.`, variant: 'destructive' })
      }

      // Handle hopper empty / change cannot be dispensed
      if (data.type === 'hopper:empty') {
        console.error('[CartModal] Hopper empty')
        toast({ title: 'Sem troco disponível', description: 'A máquina não tem troco. Por favor insira o montante exacto.', variant: 'destructive' })
      }

      // Handle hopper fault
      if (data.type === 'hopper:fault') {
        const { reason } = data.payload || {}
        console.error('[CartModal] Hopper fault:', reason)
        toast({ title: 'Falha ao devolver troco', description: 'Por favor contacte o operador.', variant: 'destructive' })
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
          toast({ title: 'Cartão detetado', variant: 'success' })
          
          // Auto-process card payment
          setTimeout(() => {
            handleCardPayAutomatic(cardCode)
          }, 500)
        }
      }
    })

    return unsubscribe
  }, [open, total])

  // Pay automatically once the cash inserted covers the cart — whether the coins went in
  // before or after the machine was chosen.
  React.useEffect(() => {
    if (!open || autoPaid.current) return
    if (total > 0 && credit >= total) {
      autoPaid.current = true
      setTimeout(() => handleCashConfirm(credit), 500)
    }
  }, [open, credit, total])

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
      toast({ title: 'Cartão detetado', variant: 'success' })
      setTimeout(() => handleCardPayAutomatic(card.code), 500)
    }
    const onBlocked = ({ status }) => {
      toast({
        title: status === 'pending_write' ? 'Cartão ainda não ativado' : 'Cartão bloqueado',
        description: status === 'pending_write' ? 'Insira o cartão no leitor para o ativar primeiro.' : 'Contacte o balcão.',
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
          title: result.success ? `Troco: €${result.amount.toFixed(2)}` : 'Falha ao devolver troco',
          description: result.success ? 'Recolha o seu dinheiro' : 'Dispensador indisponível — contacte o balcão',
          variant: result.success ? 'success' : 'destructive',
        })
      }
    } catch (e) {
      toast({ title: 'Erro ao devolver troco', description: e?.message, variant: 'destructive' })
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
      setCardError(e?.message || 'Erro ao processar pagamento com cartão')
      toast({ title: 'Erro no pagamento', description: e?.message, variant: 'error' })
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
        setCardError('Insira o código do cartão')
        setCheckingCard(false)
        return
      }

      // Delegate payment to the main handler — it will persist recharges and charge machines using cardCode
      await onPay(cart, { method: 'card', cardCode, couponCode: couponCode || undefined })
      setShowCardPrompt(false)
      onClose()
    } catch (e) {
      console.error('Card payment failed', e)
      setCardError(e?.message || 'Erro ao processar pagamento com cartão')
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
        setCardError('Insira um valor de recarga válido')
        setCheckingCard(false)
        return
      }

      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
      const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY

      // Use gateways topup for card code
      await api.gatewayTopupCard(cardCode, { amount }, { apiKey: kioskKey })

      toast({ title: `Cartão recarregado: +${amount.toFixed(2)}€`, variant: 'success' })
      // Now attempt payment again
      await checkCardAndPay()
    } catch (e) {
      console.error('Topup failed', e)
      setCardError('Erro ao recarregar cartão')
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
        setPinError('Nenhum PIN de administrador configurado para este local.')
      } else if (e?.status === 429) {
        setPinError('Demasiadas tentativas. Aguarde alguns minutos.')
      } else {
        setPinError('PIN inválido')
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
    <Modal open={open} onClose={onClose} title="Carrinho" hideClose={true}>
      <div className="flex flex-col gap-6">
        {cart.length === 0 ? (
          <div className="text-center py-8">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-3 opacity-20 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="text-neutral-400 mb-6">Carrinho vazio</p>
            <button 
              onClick={onClose}
              className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-semibold transition-all"
            >
              Fechar
            </button>
          </div>
        ) : (
          <>
            {/* Items List */}
            <div className="space-y-3">
              {cart.map((i) => (
                <div key={i.id} className="bg-neutral-50 p-4 rounded-lg relative group">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation()
                      // Remove item and close modal only if it was the last item
                      const remaining = cart.filter((x) => x.id !== i.id).length
                      removeFromCart(i.id)
                      if (remaining === 0) onClose()
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-7 h-7 flex items-center justify-center shadow-lg transition-all active:scale-90"
                    aria-label="Remover item"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-neutral-800 pr-6">
                      {i.name || i.type}
                      {i.type === 'dry' && (
                        <div className="text-sm font-normal text-neutral-500">
                          {(Number(i.quantity) || 1)} × {Number(i.tImp) || 15} min = {(Number(i.quantity) || 1) * (Number(i.tImp) || 15)} min
                        </div>
                      )}
                    </div>
                    <div className="text-lg font-bold text-neutral-800">
                      {(i.type === 'Recarga de Cartão' ? (i.price || i.amount || 0) : unitPrice(i)).toFixed(2)}€
                    </div>
                  </div>
                  {i.type === 'dry' && (
                    <div className="mt-3 flex items-center justify-center gap-6">
                      <button
                        type="button"
                        aria-label="Menos 15 minutos"
                        disabled={(Number(i.quantity) || 1) <= 1}
                        onClick={(e) => { e.stopPropagation(); setQuantity(i.id, (Number(i.quantity) || 1) - 1) }}
                        className="w-14 h-14 rounded-full bg-white border-2 border-teal-600 text-teal-700 text-3xl font-bold disabled:opacity-30 active:scale-95"
                      >−</button>
                      <div className="text-2xl font-bold text-neutral-800 min-w-[3ch] text-center">{Number(i.quantity) || 1}</div>
                      <button
                        type="button"
                        aria-label="Mais 15 minutos"
                        disabled={(Number(i.quantity) || 1) >= 8}
                        onClick={(e) => { e.stopPropagation(); setQuantity(i.id, (Number(i.quantity) || 1) + 1) }}
                        className="w-14 h-14 rounded-full bg-teal-600 text-white text-3xl font-bold disabled:opacity-30 active:scale-95"
                      >+</button>
                    </div>
                  )}
                </div>
              ))}
            </div>



            {/* Coupon code */}
            <div className="pt-3">
              <label htmlFor="cart-coupon-code" className="text-xs text-neutral-500">Código promocional</label>
              <input
                id="cart-coupon-code"
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="Opcional"
                className="mt-1 w-full border rounded px-3 py-2 text-sm uppercase"
              />
            </div>

            {/* Total */}
            <div className="flex items-center justify-between pt-4 border-t-2 border-neutral-200">
              <div>
                <div className="text-sm text-neutral-500">Total a pagar</div>
                <div className="text-2xl font-bold text-neutral-800">{purchaseTotal.toFixed(2)}€</div>
                {hasRecharge && <div className="text-sm text-neutral-600">Saldo no carrinho: <span className="font-semibold">{rechargeTotal.toFixed(2)}€</span></div>}
                {cardError && <div className="text-sm text-red-600 font-semibold mt-2">{cardError}</div>}
              </div>

              <div className="text-3xl font-bold text-teal-600">{total.toFixed(2)}€</div>
            </div>

            {/* Auto-detection waiting state */}
            <div className="flex flex-col gap-4 py-6 text-center">
              <div className="flex items-center justify-center gap-3">
                <div className="w-3 h-3 bg-teal-600 rounded-full animate-pulse"></div>
                <p className="text-lg font-semibold text-neutral-700">Aguardando pagamento...</p>
              </div>
              
              <div className="space-y-2 text-sm text-neutral-600">
                <p className="flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Insira moedas ou notas</span>
                </p>
                <p className="flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 6h18M5 14h.01M9 14h6" />
                  </svg>
                  <span>Aproxime o cartão</span>
                </p>
              </div>

              {cashInserted > 0 && (
                <div className="mt-3 p-4 bg-teal-50 rounded-xl">
                  <p className="text-sm text-neutral-600">Dinheiro inserido</p>
                  <p className="text-2xl font-bold text-teal-700">{cashInserted.toFixed(2)}€</p>
                  {cashInserted < total && (
                    <p className="text-xs text-neutral-500 mt-1">Faltam {(total - cashInserted).toFixed(2)}€</p>
                  )}
                </div>
              )}

              {/* Local (offline) session credit — updates live as coins land
                  on the embedded hardware agent, independent of the legacy
                  websocket pipeline tracked by cashInserted above. */}
              {localApi.isElectron && localSession && localSession.credits > 0 && (
                <div className="mt-3 p-4 bg-teal-50 rounded-xl">
                  <p className="text-sm text-neutral-600">Crédito inserido</p>
                  <p className="text-2xl font-bold text-teal-700">{localSession.credits.toFixed(2)}€</p>
                  {localSession.credits < total && (
                    <p className="text-xs text-neutral-500 mt-1">Faltam {(total - localSession.credits).toFixed(2)}€</p>
                  )}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  onClick={onClose}
                  className="flex-1 px-6 py-3 rounded-xl bg-neutral-100 text-neutral-700 hover:bg-neutral-200 font-semibold transition-all"
                >
                  Cancelar
                </button>
                {localApi.isElectron && localSession && localSession.cashBalance > 0 && (
                  <button
                    onClick={handleCashOut}
                    disabled={cashingOut}
                    className="flex-1 px-6 py-3 rounded-xl bg-amber-100 text-amber-800 hover:bg-amber-200 font-semibold transition-all disabled:opacity-50"
                  >
                    {cashingOut ? 'A devolver…' : `Levantar troco (${localSession.cashBalance.toFixed(2)}€)`}
                  </button>
                )}
              </div>

              {/* Staff fallback for when the hardware is down. Deliberately
                  understated so customers do not reach for it by default. */}
              <button
                onClick={() => { setPinError(null); setShowPinPrompt(true) }}
                className="mx-auto mt-2 text-xs text-neutral-400 hover:text-neutral-600 underline underline-offset-4"
              >
                Pagamento manual (staff)
              </button>
            </div>
          </>
        )}
      </div>
      {/* Card pay prompt */}
      {showCardPrompt && (
        <Modal open={showCardPrompt} onClose={() => setShowCardPrompt(false)} title="Pagar com Cartão">
          <div className="flex flex-col gap-4">
            <label className="text-sm">Código do cartão</label>
            <input value={cardCode} onChange={(e) => setCardCode(e.target.value)} className="p-3 rounded-lg border" placeholder="Insira o código do cartão" />
            {checkingCard && <div className="text-sm text-neutral-500">A verificar...</div>}
            {cardError && <div className="text-sm text-red-600 font-semibold">{cardError}</div>}
            {cardBalance != null && <div className="text-sm text-neutral-600">Saldo do cartão: <span className="font-semibold">{cardBalance.toFixed(2)}€</span></div>}

            {cardNeedsTopup ? (
              <div className="flex flex-col gap-2">
                <label className="text-sm">Recarregar cartão</label>
                <div className="flex gap-2">
                  {[5,10,20].map((a)=> (
                    <button key={a} onClick={() => setTopupAmount(a)} className={`py-2 px-3 rounded-lg ${topupAmount===a?'bg-teal-600 text-white':'bg-neutral-100'}`}>{a}€</button>
                  ))}
                </div>
                <input value={topupAmount} onChange={(e)=>setTopupAmount(Number(e.target.value))} className="p-3 rounded-lg border" />
                <div className="flex gap-2">
                  <button onClick={() => setShowCardPrompt(false)} className="flex-1 py-2 rounded-lg border">Cancelar</button>
                  <button onClick={topupCardAndRetry} disabled={checkingCard} className={`flex-1 py-2 rounded-lg ${checkingCard ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}>Recarregar e pagar</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setShowCardPrompt(false)} className="flex-1 py-2 rounded-lg border">Cancelar</button>
                <button onClick={checkCardAndPay} disabled={checkingCard} className={`flex-1 py-2 rounded-lg ${checkingCard ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}>Confirmar pagamento</button>
              </div>
            )}
          </div>
        </Modal>
      )}

    </Modal>
    {/* cash insert modal */}
    {/* Admin PIN gate */}
    {showPinPrompt && (
      <Modal open={showPinPrompt} onClose={() => { setShowPinPrompt(false); setPin(''); setPinError(null) }} title="Pagamento manual">
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            Introduza o PIN de administrador para desbloquear o pagamento manual.
            Utilize apenas quando o aceitador de moedas ou o leitor de cartões estiver avariado.
          </p>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && pin && !checkingPin) verifyPinAndUnlock() }}
            placeholder="PIN"
            className="w-full px-4 py-3 rounded-lg border border-neutral-300 text-center text-2xl tracking-widest"
          />
          {pinError && <div className="text-sm text-red-600 font-semibold">{pinError}</div>}
          <div className="flex gap-2">
            <button onClick={() => { setShowPinPrompt(false); setPin(''); setPinError(null) }} className="flex-1 py-2 rounded-lg border">Cancelar</button>
            <button
              onClick={verifyPinAndUnlock}
              disabled={checkingPin || !pin}
              className={`flex-1 py-2 rounded-lg ${checkingPin || !pin ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}
            >
              {checkingPin ? 'A verificar…' : 'Desbloquear'}
            </button>
          </div>
        </div>
      </Modal>
    )}

    {/* Unlocked: choose a manual payment method */}
    {manualUnlocked && !showCash && !showCardPrompt && (
      <Modal open={manualUnlocked} onClose={closeManual} title="Pagamento manual">
        <div className="space-y-4">
          <div className="text-sm text-neutral-600">Total a cobrar</div>
          <div className="text-3xl font-bold text-teal-600">{total.toFixed(2)}€</div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={openCashModal} className="py-4 rounded-lg bg-teal-600 text-white font-semibold">Dinheiro</button>
            <button onClick={handleCardPay} className="py-4 rounded-lg bg-neutral-800 text-white font-semibold">Cartão</button>
          </div>
          <button onClick={closeManual} className="w-full py-2 rounded-lg border">Cancelar</button>
        </div>
      </Modal>
    )}

    <CashModal open={showCash} total={total} onClose={() => { setShowCash(false); closeManual() }} onConfirm={handleCashConfirm} />
    </>
  )
}

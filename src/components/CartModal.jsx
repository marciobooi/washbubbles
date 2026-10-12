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

  // A dryer is sold in blocks of 15 minutes and the customer picks how many with + / -. If the money is
  // already there the cart used to pay the instant it opened, so the number was never chosen. For dryers
  // nothing is paid until the customer presses "Confirmar", and changing the number asks again.
  const needsConfirm = cart.some((i) => i.type === 'dry')
  const cartSig = cart.map((i) => `${i.id}:${i.quantity || 1}`).join('|')
  const [confirmedSig, setConfirmedSig] = React.useState(null)
  const confirmed = !needsConfirm || confirmedSig === cartSig
  const confirmedRef = React.useRef(true)
  confirmedRef.current = confirmed
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
            {/* ---- Payment window (design of 2026-10-12) ---- */}
            {(() => {
              const machineItems = cart.filter((i) => i.type !== 'Recarga de Cartão')
              const single = machineItems.length === 1 && !hasRecharge ? machineItems[0] : null
              const paid = Math.round(credit * 100) / 100
              const remaining = Math.max(0, Math.round((total - paid) * 100) / 100)
              const change = Math.max(0, Math.round((paid - total) * 100) / 100)
              const percent = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
              const enough = total > 0 && paid >= total
              const waitingConfirm = needsConfirm && !confirmed && (enough || detectedCardCode)
              const label = enough
                ? (waitingConfirm ? 'DINHEIRO SUFICIENTE · CONFIRME' : 'PAGAMENTO CONCLUÍDO!')
                : paid > 0 ? 'A RECEBER DINHEIRO...' : 'AGUARDANDO PAGAMENTO'
              const eur = (n) => `${Number(n).toFixed(2).replace('.', ',')}€`
              const gapOf = (i) => Number(i.tImp) || 15
              const qtyOf = (i) => (i.type === 'dry' ? Math.max(1, Math.min(8, Math.floor(Number(i.quantity)) || 1)) : 1)
              const perCycle = (i) => unitPrice({ ...i, quantity: 1 })
              const badge = (i) => {
                const n = i.number ?? (String(i.name || '').match(/\d+/) || [''])[0]
                return n === '' || n == null ? '•' : String(n)
              }

              return (
                <>
                  {/* Header */}
                  <header className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-2xl bg-teal-500 text-white font-bold flex items-center justify-center text-3xl shadow-sm ring-4 ring-teal-50">
                        {single ? badge(single) : '🛒'}
                      </div>
                      <div>
                        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
                          {single ? (single.name || single.type) : 'Carrinho'}
                        </h1>
                        <p className="text-xl font-semibold text-slate-600 mt-1">
                          {single
                            ? (single.type === 'dry' ? `Duração base: ${gapOf(single)} min por ciclo` : `${single.weight ? single.weight + ' kg' : 'Lavagem'}`)
                            : `${cart.length} itens`}
                        </p>
                      </div>
                    </div>
                    <button
                      aria-label="Fechar janela"
                      type="button"
                      onClick={onClose}
                      className="w-16 h-16 rounded-full bg-slate-100 text-slate-400 hover:text-rose-500 hover:bg-rose-50 active:scale-95 flex items-center justify-center"
                    >
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </header>

                  {/* Items */}
                  {cart.map((i) => {
                    const isDry = i.type === 'dry'
                    const q = qtyOf(i)
                    const gap = gapOf(i)
                    return (
                      <section key={i.id} className="space-y-4">
                        {!single && (
                          <div className="flex items-center justify-between bg-slate-50 rounded-2xl px-5 py-4">
                            <div className="text-2xl font-semibold text-slate-800">{i.name || i.type}</div>
                            <div className="flex items-center gap-4">
                              <div className="text-3xl font-bold text-slate-800">{(i.type === 'Recarga de Cartão' ? (i.price || i.amount || 0) : unitPrice(i)).toFixed(2)}€</div>
                              <button
                                type="button"
                                aria-label="Remover item"
                                onClick={() => {
                                  const left = cart.filter((x) => x.id !== i.id).length
                                  removeFromCart(i.id)
                                  if (left === 0) onClose()
                                }}
                                className="w-12 h-12 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center active:scale-90"
                              >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              </button>
                            </div>
                          </div>
                        )}

                        {isDry && (
                          <>
                            <div>
                              <span className="inline-block text-lg text-emerald-800 font-bold bg-emerald-100/80 px-3 py-1 rounded-md mb-3">Escolhas rápidas</span>
                              <div className="grid grid-cols-3 gap-3">
                                {[1, 2, 3].map((n) => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => setQuantity(i.id, n)}
                                    className={`relative min-h-[96px] py-4 px-2 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 shadow-sm active:scale-95 transition-all ${q === n ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/10' : 'border-slate-200 bg-white hover:border-teal-400'}`}
                                  >
                                    {n === 2 && <span className="absolute -top-3 bg-teal-600 text-[13px] text-white px-3 py-0.5 rounded-full font-bold uppercase tracking-tight">Mais usado</span>}
                                    <span className="text-3xl font-extrabold text-slate-800">{n * gap} min</span>
                                    <span className={`text-xl font-semibold ${q === n ? 'text-teal-700' : 'text-slate-400'}`}>{eur(perCycle(i) * n)}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="bg-teal-50/60 border border-teal-100 rounded-2xl p-5 flex items-center justify-between gap-4">
                              <button
                                type="button"
                                aria-label="Diminuir tempo"
                                disabled={q <= 1}
                                onClick={() => setQuantity(i.id, q - 1)}
                                className="w-24 h-24 rounded-2xl border-2 border-slate-200 bg-white text-slate-700 flex items-center justify-center shadow-sm active:scale-90 disabled:opacity-30 shrink-0"
                              >
                                <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M5 12h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              </button>
                              <div className="flex-1 flex flex-col items-center text-center select-none">
                                <span className="text-lg font-bold text-teal-800 uppercase tracking-wider">Tempo selecionado</span>
                                <span className="text-6xl font-extrabold text-slate-900 tabular-nums leading-tight">{q * gap} min</span>
                                <span className="mt-1 flex items-center gap-2 text-xl font-semibold text-slate-600">
                                  <span className="bg-white border border-teal-100 px-3 py-0.5 rounded-full text-teal-800 font-bold">{q} {q === 1 ? 'ciclo' : 'ciclos'} ({gap} min/ciclo)</span>
                                  <span className="text-slate-400">•</span>
                                  <span>{eur(perCycle(i))}/ciclo</span>
                                </span>
                              </div>
                              <button
                                type="button"
                                aria-label="Aumentar tempo"
                                disabled={q >= 8}
                                onClick={() => setQuantity(i.id, q + 1)}
                                className="w-24 h-24 rounded-2xl border-2 border-slate-200 bg-white text-slate-700 flex items-center justify-center shadow-sm active:scale-90 disabled:opacity-30 shrink-0"
                              >
                                <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M12 5v14m-7-7h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              </button>
                            </div>
                          </>
                        )}
                      </section>
                    )
                  })}

                  {/* Promo code (collapsed) */}
                  <details className="group border-t border-slate-100 pt-4">
                    <summary className="flex items-center justify-between text-2xl font-bold text-teal-900 cursor-pointer list-none select-none py-2">
                      <span>Tens um código promocional? <span className="text-slate-600 font-medium">(opcional)</span></span>
                      <svg className="w-7 h-7 text-slate-600 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </summary>
                    <div className="pt-3 flex items-center gap-3">
                      <input
                        id="cart-coupon-code"
                        type="text"
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                        placeholder="INSERIR CÓDIGO"
                        className="w-full h-16 bg-slate-50 text-2xl text-slate-800 placeholder-slate-400 font-medium uppercase tracking-wider rounded-xl border border-slate-200 px-4 outline-none focus:border-teal-500"
                      />
                    </div>
                  </details>

                  {/* Total */}
                  <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 text-white shadow-md flex items-center justify-between">
                    <div>
                      <span className="text-xl font-semibold text-emerald-400 block tracking-wide uppercase">Total a pagar</span>
                      <span className="text-xl text-slate-200 font-medium">
                        {hasRecharge ? `Inclui recarga de ${rechargeTotal.toFixed(2)}€` : 'Moedas e notas aceites'}
                      </span>
                      {cardError && <span className="block text-xl text-rose-300 font-semibold mt-1">{cardError}</span>}
                    </div>
                    <span className="text-6xl font-extrabold tracking-tight tabular-nums">{eur(total)}</span>
                  </div>

                  {/* Payment status */}
                  <div className="bg-teal-50/70 border border-teal-100 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="relative flex h-4 w-4">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500" />
                        </span>
                        <span className="text-2xl font-bold uppercase tracking-wider text-emerald-800">{label}</span>
                      </div>
                      <span className="text-lg font-bold text-slate-500 uppercase tracking-wider bg-white/80 border border-emerald-100 px-3 py-1 rounded-full">Notas &amp; Moedas</span>
                    </div>

                    <div className="bg-white/95 border border-emerald-200/60 rounded-xl p-4 flex items-center gap-4">
                      <div className="w-16 h-16 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0 border border-emerald-100">
                        <svg className="w-9 h-9 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect height="12" rx="2" width="20" x="2" y="6" /><circle cx="12" cy="12" r="3" /><path d="M6 12h.01M18 12h.01" strokeLinecap="round" /></svg>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-slate-800">Insira moedas ou notas na ranhura</p>
                        <p className="text-xl font-semibold text-slate-600 mt-0.5">Notas de 5€, 10€, 20€ e moedas de 0,10€ a 2€ · ou aproxime o cartão</p>
                      </div>
                    </div>

                    <div className="bg-white border-2 border-emerald-200/80 rounded-xl p-5 space-y-4">
                      <div className="grid grid-cols-2 gap-4 divide-x divide-slate-100">
                        <div className="pr-3">
                          <span className="text-lg font-bold text-slate-500 uppercase tracking-wider block">Total inserido</span>
                          <span className="text-5xl font-bold text-slate-800 tracking-tight tabular-nums">{eur(paid)}</span>
                        </div>
                        <div className="pl-5">
                          <span className="text-lg font-bold text-slate-500 uppercase tracking-wider block">{change > 0 ? 'Troco' : 'Falta pagar'}</span>
                          <span className={`text-5xl font-bold tracking-tight tabular-nums ${enough ? 'text-emerald-600' : 'text-slate-900'}`}>{change > 0 ? eur(change) : eur(remaining)}</span>
                        </div>
                      </div>
                      <div className="space-y-2 pt-3 border-t border-slate-100">
                        <div className="flex justify-between items-center text-xl font-bold text-slate-600">
                          <span>Progresso do pagamento</span>
                          <span className="tabular-nums">{percent}%</span>
                        </div>
                        <div className="w-full h-5 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/80">
                          <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    </div>

                    {/* Dryer: nothing is paid until the customer has chosen the cycles and confirms */}
                    {waitingConfirm && total > 0 && (
                      <button
                        type="button"
                        onClick={confirmCart}
                        className="w-full rounded-2xl bg-teal-600 text-white text-3xl font-bold py-6 shadow-lg active:scale-95"
                      >
                        Confirmar e iniciar · {eur(total)}
                      </button>
                    )}

                    {/* Local (offline) session credit of the embedded agent; electron kiosks only */}
                    {localApi.isElectron && localSession && localSession.credits > 0 && (
                      <div className="p-4 bg-white rounded-xl">
                        <p className="text-xl text-neutral-600">Crédito inserido</p>
                        <p className="text-4xl font-bold text-teal-700">{localSession.credits.toFixed(2)}€</p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="space-y-3 pt-1">
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 min-h-[72px] rounded-xl text-2xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold transition-all active:scale-[0.99]"
                      >
                        Cancelar
                      </button>
                      {localApi.isElectron && localSession && localSession.cashBalance > 0 && (
                        <button
                          type="button"
                          onClick={handleCashOut}
                          disabled={cashingOut}
                          className="flex-1 min-h-[72px] rounded-xl text-2xl bg-amber-100 text-amber-800 hover:bg-amber-200 font-bold transition-all disabled:opacity-50"
                        >
                          {cashingOut ? 'A devolver…' : `Levantar troco (${localSession.cashBalance.toFixed(2)}€)`}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setPinError(null); setShowPinPrompt(true) }}
                      className="w-full min-h-[64px] rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xl inline-flex items-center justify-center gap-3 active:scale-[0.99]"
                    >
                      <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      Pagamento manual (staff / ajuda)
                    </button>
                  </div>
                </>
              )
            })()}
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

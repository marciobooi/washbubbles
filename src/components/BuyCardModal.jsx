import React, { useState, useEffect, useRef } from 'react'
import Modal from './ui/Modal'
import Loading from './ui/loading'
import { CreditCard, User, Mail, Phone, FileText, CheckCircle2, Wifi, ArrowRight } from 'lucide-react'
import { toast } from './ui/Toast'
import api from '@/services/api'
import * as localApi from '@/services/local-api'
import { useTranslation } from 'react-i18next'
import { useCart } from '@/context/CartContext'

const STEPS = {
  FORM: 'form',
  PAYMENT: 'payment',
  DISPENSING: 'dispensing',
  INSERT_CARD: 'insert_card',
  COMPLETE: 'complete'
}

export default function BuyCardModal({ open, onClose }) {
  const { t, i18n } = useTranslation('buycard')
  const { credit } = useCart() // the cash really inserted (the shop's session), not a button
  const eur = (n) => `${Number(n).toFixed(2).replace('.', i18n.language === 'en' ? '.' : ',')}€`
  const [step, setStep] = useState(STEPS.FORM)
  const [loading, setLoading] = useState(false)
  
  // Form data (all optional)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    contribuinte: '',
    marketingOptIn: false
  })

  // Input refs for sequential navigation
  const nameRef = useRef(null)
  const emailRef = useRef(null)
  const phoneRef = useRef(null)
  const contribuinteRef = useRef(null)

  // Card purchase settings
  const [cardPrice, setCardPrice] = useState(0)
  const [initialCredit, setInitialCredit] = useState(0)
  
  // Payment data
  const [insertedAmount, setInsertedAmount] = useState(0)
  const [changeAmount, setChangeAmount] = useState(0)
  
  // Purchase result
  const [purchasedCard, setPurchasedCard] = useState(null)
  // Whether this purchase went through the local engine (no network) — decides
  // which path the write step retries against.
  const [purchasedLocally, setPurchasedLocally] = useState(false)
  // Set when writing the card at the reader fails. The customer has already paid,
  // so the step must stay open for a retry rather than reporting success.
  const [writeError, setWriteError] = useState(null)

  // Load card purchase settings
  useEffect(() => {
    if (open) {
      loadSettings()
      resetForm()
    }
  }, [open])

  async function loadSettings() {
    try {
      // Use public POS endpoint for loyalty card settings (no auth required)
      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey 
        ? window.electronAPI.kioskKey() 
        : null
      const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY

      const price = await api.request('/pos/settings/loyaltyCard.cost', {
        method: 'GET',
        headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined,
        skipAuth: true,
        expect: 'json'
      }).catch(() => ({ value: 5 }))
      
      const credit = await api.request('/pos/settings/loyaltyCard.credit', {
        method: 'GET',
        headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined,
        skipAuth: true,
        expect: 'json'
      }).catch(() => ({ value: 5 }))
      
      setCardPrice(Number(price?.value || 5))
      setInitialCredit(Number(credit?.value || 5))
    } catch (e) {
      console.error('Failed to load card purchase settings', e)
      // Use defaults on error
      setCardPrice(5)
      setInitialCredit(5)
    }
  }

  function resetForm() {
    setStep(STEPS.FORM)
    setFormData({ name: '', email: '', phone: '', contribuinte: '', marketingOptIn: false })
    setInsertedAmount(0)
    setChangeAmount(0)
    setPurchasedCard(null)
    setPurchasedLocally(false)
    setWriteError(null)
    setLoading(false)
  }

  function handleInputChange(field, value) {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  function handleNext() {
    // Move to payment step
    setStep(STEPS.PAYMENT)
  }

  function handleSkipForm() {
    // Skip data entry and go straight to payment
    setStep(STEPS.PAYMENT)
  }

  async function handlePayment(amount) {
    if (amount < cardPrice) {
      toast({ 
        title: t('insufficient', { price: eur(cardPrice) }), 
        variant: 'destructive' 
      })
      return
    }

    setInsertedAmount(amount)
    setChangeAmount(amount - cardPrice)
    setLoading(true)
    setStep(STEPS.DISPENSING)

    try {
      // Offline-first: if the kiosk's local session already holds enough real
      // cash credit, sell the card entirely locally — dispense, charge, and
      // leave it pending_write, with zero dependency on the network. Falls
      // through to the remote route otherwise (no local credit yet, or not
      // running in Electron at all).
      if (localApi.isElectron) {
        const session = await localApi.getSession()
        if (session && session.credits >= cardPrice) {
          const local = await localApi.purchaseCard({
            inserted: amount,
            customerName: formData.name,
            customerEmail: formData.email,
            customerPhone: formData.phone,
            customerContribuinte: formData.contribuinte,
            customerMarketingOptIn: formData.marketingOptIn,
            batchId: `BATCH-${Date.now()}`
          })
          setPurchasedCard(local.card)
          setPurchasedLocally(true)
          if (local.change > 0) {
            toast({
              title: t('changeTitle', { amount: eur(local.change) }),
              description: local.changeDispensed ? t('collectChange') : t('noChangeDispenser'),
              variant: local.changeDispensed ? 'success' : 'warning',
            })
          }
          setStep(STEPS.INSERT_CARD)
          toast({ title: t('dispensed'), description: local.message, variant: 'success' })
          return
        }
      }

      // Get kiosk API key
      const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey
        ? window.electronAPI.kioskKey()
        : null
      const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY

      setPurchasedLocally(false)
      // Call card purchase API
      const response = await api.request('/pos/card/purchase', {
        method: 'POST',
        json: {
          inserted: amount,
          customerName: formData.name,
          customerEmail: formData.email,
          customerPhone: formData.phone,
          customerContribuinte: formData.contribuinte,
          customerMarketingOptIn: formData.marketingOptIn,
          batchId: `BATCH-${Date.now()}`
        },
        headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined,
        skipAuth: true,
        expect: 'json'
      })

      if (response.success) {
        setPurchasedCard(response.card)
        
        // Show change message if applicable
        if (response.change > 0) {
          if (response.changeDispensed) {
            toast({ 
              title: t('changeTitle', { amount: eur(response.change) }), 
              description: t('collectChange'),
              variant: 'success' 
            })
          } else {
            toast({ 
              title: t('changeTitle', { amount: eur(response.change) }), 
              description: t('noChangeDispenser'),
              variant: 'warning' 
            })
          }
        }

        // Move to insert card step
        setStep(STEPS.INSERT_CARD)
        
        toast({ 
          title: t('dispensed'), 
          description: response.message,
          variant: 'success' 
        })
      } else {
        throw new Error(response.error || t('purchaseFailed'))
      }
    } catch (e) {
      console.error('Card purchase failed:', e)
      toast({ 
        title: t('purchaseError'), 
        description: e.message || t('tryAgain'),
        variant: 'destructive' 
      })
      setStep(STEPS.PAYMENT)
    } finally {
      setLoading(false)
    }
  }

  async function handleCardInserted() {
    // User confirms card was inserted into reader
    if (!purchasedCard) return

    setLoading(true)

    try {
      // Actually WRITE the card: this puts the customer's id and balance onto
      // the blank card sitting in the reader, and only marks it active once the
      // reader confirms. The old code called `/card/mark-written`, which just
      // flips a database boolean — the physical card was never written at all
      // and the customer walked away with blank plastic.
      if (purchasedLocally) {
        await localApi.writeCard(purchasedCard.code)
      } else {
        const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey
          ? window.electronAPI.kioskKey()
          : null
        const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY

        await api.request(`/pos/card/write/${purchasedCard.code}`, {
          method: 'POST',
          headers: kioskKey ? { Authorization: `ApiKey ${kioskKey}` } : undefined,
          skipAuth: true,
          expect: 'json'
        })
      }

      setWriteError(null)
      setStep(STEPS.COMPLETE)

      toast({ 
        title: t('activatedToast'), 
        description: t('balanceLine', { amount: eur(initialCredit) }),
        variant: 'success' 
      })

      // Auto-close after 5 seconds
      setTimeout(() => {
        handleClose()
      }, 5000)
    } catch (e) {
      console.error('Failed to write the card:', e)
      // Do NOT claim success. The card is still blank and unusable, and the
      // customer has paid for it — keep them on this step so they can retry at
      // the reader, and tell them the truth.
      setWriteError(
        e?.body?.message || e?.message ||
        t('writeFallback')
      )
      toast({
        title: t('writeFail'),
        description: t('writeFailDesc'),
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    // Hide virtual keyboard when closing
    if (window.electronAPI?.hideKeyboard) {
      window.electronAPI.hideKeyboard()
    }
    resetForm()
    onClose()
  }

  function handleFieldFocus() {
    // Show virtual keyboard when any field is focused
    if (window.electronAPI?.showKeyboard) {
      window.electronAPI.showKeyboard()
    }
  }

  function handleFieldBlur(e) {
    // Hide keyboard when clicking outside (not on another input)
    setTimeout(() => {
      const activeElement = document.activeElement
      const isInputFocused = activeElement && 
        (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')
      
      if (!isInputFocused && window.electronAPI?.hideKeyboard) {
        window.electronAPI.hideKeyboard()
      }
    }, 100)
  }

  function handleKeyDown(e, currentField) {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Move to next field on Enter
      switch (currentField) {
        case 'name':
          emailRef.current?.focus()
          break
        case 'email':
          phoneRef.current?.focus()
          break
        case 'phone':
          contribuinteRef.current?.focus()
          break
        case 'contribuinte':
          // Last field - hide keyboard and move to next step
          if (window.electronAPI?.hideKeyboard) {
            window.electronAPI.hideKeyboard()
          }
          handleNext()
          break
      }
    }
  }

  // Same header on every step: the card illustration, the title and (optionally) the price / credit pill.
  function StepHeader({ title, pill = false, pulse = false, tick = false }) {
    return (
      <div className="flex flex-col items-center text-center pt-2 pb-5">
        <div className={`relative w-32 h-20 rounded-xl bg-gradient-to-tr from-[#00875A] via-emerald-700 to-emerald-500 shadow-lg p-2.5 flex flex-col justify-between mb-4 border border-emerald-400/40 ${pulse ? 'animate-pulse' : ''}`}>
          <div className="flex items-center justify-between">
            <div className="w-6 h-[18px] bg-amber-300/90 rounded-sm border border-amber-500/60" />
            <Wifi className="w-4 h-4 text-white/80 rotate-90" />
          </div>
          <div className="text-[9px] uppercase tracking-wider font-extrabold text-white/95 text-left">{t('cardLabel')}</div>
          {tick && (
            <span className="absolute -top-3 -right-3 bg-emerald-600 text-white rounded-full p-1.5 shadow-md ring-4 ring-white">
              <CheckCircle2 className="w-6 h-6" />
            </span>
          )}
        </div>
        <h3 className="text-3xl font-extrabold tracking-tight text-emerald-900">{title}</h3>
        {pill && (
          <div className="mt-3 inline-flex items-center gap-3 bg-emerald-50 border border-emerald-200 px-5 py-2 rounded-full text-lg font-medium text-slate-600">
            <span>{t('price')}: <strong className="text-slate-900">{eur(cardPrice)}</strong></span>
            <span className="text-emerald-400 font-bold">•</span>
            <span>{t('initialCredit')}: <strong className="text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">{eur(initialCredit)}</strong></span>
          </div>
        )}
      </div>
    )
  }

  function renderStepContent() {
    switch (step) {
      case STEPS.FORM:
        return (
          <div className="flex flex-col">
            <button
              type="button"
              aria-label={t('closeWindow')}
              onClick={() => { if (window.electronAPI?.hideKeyboard) window.electronAPI.hideKeyboard(); handleClose() }}
              className="absolute top-4 right-4 w-14 h-14 flex items-center justify-center rounded-2xl bg-slate-100 text-slate-500 text-2xl active:scale-95"
            >✕</button>

            <StepHeader title={t('title')} pill />

            <div className="mb-4">
              <h4 className="text-xl font-semibold text-slate-700">{t('fillData')}</h4>
              <p className="text-base text-slate-500 mt-1">{t('fillHint')}</p>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="name" className="block text-sm font-semibold uppercase tracking-wider text-slate-600 mb-2 ml-1">{t('name')}</label>
                <div className="relative flex items-center">
                  <User className="absolute left-4 h-6 w-6 text-slate-400 pointer-events-none" />
                  <input
                    ref={nameRef}
                    id="name"
                    
                    autoComplete="off"
                    placeholder={t('namePlaceholder')}
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    onKeyDown={(e) => handleKeyDown(e, 'name')}
                    className="w-full h-16 pl-14 pr-4 bg-slate-50/70 border border-slate-200 rounded-xl text-xl text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-[#00875A] focus:border-[#00875A] outline-none transition"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-semibold uppercase tracking-wider text-slate-600 mb-2 ml-1">{t('email')}</label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-4 h-6 w-6 text-slate-400 pointer-events-none" />
                  <input
                    ref={emailRef}
                    id="email"
                    type="email"
                    autoComplete="off"
                    placeholder={t('emailPlaceholder')}
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    onKeyDown={(e) => handleKeyDown(e, 'email')}
                    className="w-full h-16 pl-14 pr-4 bg-slate-50/70 border border-slate-200 rounded-xl text-xl text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-[#00875A] focus:border-[#00875A] outline-none transition"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-semibold uppercase tracking-wider text-slate-600 mb-2 ml-1">{t('phone')}</label>
                <div className="relative flex items-center">
                  <Phone className="absolute left-4 h-6 w-6 text-slate-400 pointer-events-none" />
                  <input
                    ref={phoneRef}
                    id="phone"
                    type="tel"
                    autoComplete="off"
                    placeholder={t('phonePlaceholder')}
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    onKeyDown={(e) => handleKeyDown(e, 'phone')}
                    className="w-full h-16 pl-14 pr-4 bg-slate-50/70 border border-slate-200 rounded-xl text-xl text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-[#00875A] focus:border-[#00875A] outline-none transition"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="contribuinte" className="block text-sm font-semibold uppercase tracking-wider text-slate-600 mb-2 ml-1">{t('nif')}</label>
                <div className="relative flex items-center">
                  <FileText className="absolute left-4 h-6 w-6 text-slate-400 pointer-events-none" />
                  <input
                    ref={contribuinteRef}
                    id="contribuinte"
                    
                    autoComplete="off"
                    placeholder={t('nifPlaceholder')}
                    value={formData.contribuinte}
                    onChange={(e) => handleInputChange('contribuinte', e.target.value)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    onKeyDown={(e) => handleKeyDown(e, 'contribuinte')}
                    className="w-full h-16 pl-14 pr-4 bg-slate-50/70 border border-slate-200 rounded-xl text-xl text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-[#00875A] focus:border-[#00875A] outline-none transition"
                  />
                </div>
              </div>

              <label htmlFor="marketingOptIn" className="flex items-center gap-4 p-3 rounded-xl active:bg-slate-100 cursor-pointer">
                <input
                  id="marketingOptIn"
                  type="checkbox"
                  className="w-7 h-7 rounded-md border-2 border-slate-300 accent-[#00875A]"
                  checked={formData.marketingOptIn}
                  onChange={(e) => handleInputChange('marketingOptIn', e.target.checked)}
                />
                <span className="text-lg font-medium text-slate-700">{t('marketing')}</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-200/80">
              <button
                type="button"
                onClick={() => { if (window.electronAPI?.hideKeyboard) window.electronAPI.hideKeyboard(); handleSkipForm() }}
                className="h-[72px] rounded-2xl bg-emerald-50 border border-emerald-200 text-[#00875A] font-bold text-2xl active:scale-[0.98]"
              >{t('skip')}</button>
              <button
                type="button"
                onClick={() => { if (window.electronAPI?.hideKeyboard) window.electronAPI.hideKeyboard(); handleNext() }}
                className="h-[72px] rounded-2xl bg-[#00875A] border border-emerald-700 text-white font-bold text-2xl flex items-center justify-center gap-3 shadow-md active:scale-[0.98]"
              >
                <span>{t('continue')}</span>
                <ArrowRight className="w-7 h-7 text-emerald-200" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        )

      case STEPS.PAYMENT: {
        const paid = Math.round((Number(credit) || 0) * 100) / 100
        const enough = paid + 0.005 >= cardPrice
        const missing = Math.max(0, Math.round((cardPrice - paid) * 100) / 100)
        const percent = cardPrice > 0 ? (enough ? 100 : Math.min(99, Math.floor((paid / cardPrice) * 100 + 1e-9))) : 0
        return (
          <div className="flex flex-col gap-6">
            <StepHeader title={t('payTitle')} pill />

            <p className="text-center text-xl text-slate-500">{t('insertCash')}</p>

            {/* The cash really inserted (the shop's own session): paying is only possible with money in */}
            <div className="rounded-2xl border-2 border-emerald-200 bg-white p-6 flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="pr-4 border-r border-slate-100">
                  <span className="text-sm font-bold text-slate-500 uppercase tracking-wider block mb-1">{t('inserted')}</span>
                  <span className="text-5xl font-extrabold tabular-nums text-slate-800">{eur(paid)}</span>
                </div>
                <div className="pl-4">
                  <span className="text-sm font-bold text-slate-500 uppercase tracking-wider block mb-1">{enough && paid > cardPrice ? t('change') : t('missing')}</span>
                  <span className={`text-5xl font-extrabold tabular-nums ${enough ? 'text-emerald-600' : 'text-slate-800'}`}>{enough ? eur(Math.max(0, paid - cardPrice)) : eur(missing)}</span>
                </div>
              </div>
              <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/80">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${percent}%` }} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-6 border-t border-slate-200/80">
              <button
                type="button"
                disabled={loading}
                onClick={() => { if (window.electronAPI?.hideKeyboard) window.electronAPI.hideKeyboard(); setStep(STEPS.FORM) }}
                className="h-[72px] rounded-2xl bg-emerald-50 border border-emerald-200 text-[#00875A] font-bold text-2xl active:scale-[0.98] disabled:opacity-50"
              >{t('back')}</button>
              <button
                type="button"
                onClick={() => handlePayment(paid)}
                disabled={loading || !enough}
                className="h-[72px] rounded-2xl bg-[#00875A] border border-emerald-700 text-white font-bold text-2xl shadow-md active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
              >{t('pay')} · {eur(cardPrice)}</button>
            </div>
          </div>
        )
      }

      case STEPS.DISPENSING:
        return (
          <div className="flex flex-col items-center text-center py-10 gap-2">
            <Loading label={t('dispensing')} />
            <p className="text-xl text-slate-500">{t('pleaseWait')}</p>
          </div>
        )

      case STEPS.INSERT_CARD:
        return (
          <div className="flex flex-col gap-6">
            <StepHeader title={t('insertCardTitle')} pulse />
            <p className="text-center text-xl text-slate-500 -mt-2">{t('insertCardHint')}</p>

            {writeError && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center">
                <p className="text-lg text-red-700 font-semibold">{writeError}</p>
                <p className="text-base text-red-600 mt-1">{t('notActive')}</p>
              </div>
            )}

            {purchasedCard && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col gap-2 text-xl">
                <p><span className="font-semibold text-slate-500">{t('code')}:</span> <span className="font-mono font-bold text-slate-800">{purchasedCard.code}</span></p>
                <p><span className="font-semibold text-slate-500">{t('balance')}:</span> <span className="font-bold text-slate-800">{eur(initialCredit)}</span></p>
                {changeAmount > 0 && (
                  <p className="text-emerald-700 font-bold">{t('change')}: {eur(changeAmount)}</p>
                )}
              </div>
            )}

            <div className="pt-6 border-t border-slate-200/80">
              <button
                type="button"
                onClick={handleCardInserted}
                disabled={loading}
                className="w-full h-[72px] rounded-2xl bg-[#00875A] border border-emerald-700 text-white font-bold text-2xl shadow-md active:scale-[0.98] disabled:opacity-60"
              >{loading ? t('activating') : t('cardInserted')}</button>
            </div>
          </div>
        )

      case STEPS.COMPLETE:
        return (
          <div className="flex flex-col gap-6 items-center text-center">
            <div>
              <StepHeader title={t('activatedTitle')} tick />
              <p className="text-xl text-slate-500 -mt-2">{t('ready')}</p>
            </div>

            {purchasedCard && (
              <div className="w-full bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                <p className="text-3xl font-extrabold text-emerald-800">{t('balance')}: {eur(initialCredit)}</p>
                <p className="text-lg text-emerald-700 mt-1">{t('code')}: <span className="font-mono">{purchasedCard.code}</span></p>
              </div>
            )}

            <div className="w-full pt-6 border-t border-slate-200/80">
              <button
                type="button"
                onClick={handleClose}
                className="w-full h-[72px] rounded-2xl bg-[#00875A] border border-emerald-700 text-white font-bold text-2xl shadow-md active:scale-[0.98]"
              >{t('done')}</button>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  // Closeable before anything has actually happened (FORM: just data entry;
  // PAYMENT: only amount buttons, nothing charged until one is tapped) and
  // once the transaction is fully done (COMPLETE). Locked during
  // DISPENSING/INSERT_CARD — a card is physically out and/or the customer has
  // already been charged, so the flow must be seen through rather than
  // silently abandoned. `hideClose` matches: no point showing an X that
  // can't do anything.
  const canClose = step === STEPS.FORM || step === STEPS.PAYMENT || step === STEPS.COMPLETE

  return (
    <Modal
      open={open}
      onClose={canClose ? handleClose : undefined}
      hideClose={!canClose || step === STEPS.FORM}
      maxWidth="min(68vw, 740px)"
    >
      <div className="p-3">
        {renderStepContent()}
      </div>
    </Modal>
  )
}

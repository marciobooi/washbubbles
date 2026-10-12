import React, { useState, useEffect, useRef } from 'react'
import Modal from './ui/Modal'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { CreditCard, User, Mail, Phone, FileText, Banknote, CheckCircle2 } from 'lucide-react'
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

  function renderStepContent() {
    switch (step) {
      case STEPS.FORM:
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <CreditCard className="h-16 w-16 mx-auto mb-4 text-primary" />
              <h3 className="text-xl font-semibold mb-2">{t('title')}</h3>
              <p className="text-muted-foreground">
                {t('price')}: <span className="font-bold text-lg">{eur(cardPrice)}</span>
                {' • '}
                {t('initialCredit')}: <span className="font-bold text-lg">{eur(initialCredit)}</span>
              </p>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('fillData')}
              </p>

              <div className="space-y-2">
                <Label htmlFor="name">{t('name')}</Label>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={nameRef}
                    id="name"
                    placeholder={t('namePlaceholder')}
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    onKeyDown={(e) => handleKeyDown(e, 'name')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{t('email')}</Label>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={emailRef}
                    id="email"
                    type="email"
                    placeholder={t('emailPlaceholder')}
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    onKeyDown={(e) => handleKeyDown(e, 'email')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">{t('phone')}</Label>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={phoneRef}
                    id="phone"
                    type="tel"
                    placeholder={t('phonePlaceholder')}
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    onKeyDown={(e) => handleKeyDown(e, 'phone')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contribuinte">{t('nif')}</Label>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={contribuinteRef}
                    id="contribuinte"
                    placeholder={t('nifPlaceholder')}
                    value={formData.contribuinte}
                    onChange={(e) => handleInputChange('contribuinte', e.target.value)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    onKeyDown={(e) => handleKeyDown(e, 'contribuinte')}
                  />
                </div>
              </div>

              <div className="flex items-start gap-2 pt-1">
                <input
                  id="marketingOptIn"
                  type="checkbox"
                  className="mt-1"
                  checked={formData.marketingOptIn}
                  onChange={(e) => handleInputChange('marketingOptIn', e.target.checked)}
                />
                <Label htmlFor="marketingOptIn" className="font-normal text-sm">
                  {t('marketing')}
                </Label>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button 
                variant="outline" 
                onClick={() => {
                  if (window.electronAPI?.hideKeyboard) {
                    window.electronAPI.hideKeyboard()
                  }
                  handleSkipForm()
                }} 
                className="flex-1"
              >
                {t('skip')}
              </Button>
              <Button 
                onClick={() => {
                  if (window.electronAPI?.hideKeyboard) {
                    window.electronAPI.hideKeyboard()
                  }
                  handleNext()
                }} 
                className="flex-1"
              >
                {t('continue')}
              </Button>
            </div>
          </div>
        )

      case STEPS.PAYMENT: {
        const paid = Math.round((Number(credit) || 0) * 100) / 100
        const enough = paid + 0.005 >= cardPrice
        const missing = Math.max(0, Math.round((cardPrice - paid) * 100) / 100)
        const percent = cardPrice > 0 ? Math.min(100, Math.round((paid / cardPrice) * 100)) : 0
        return (
          <div className="space-y-6">
            <div className="text-center mb-2">
              <Banknote className="h-16 w-16 mx-auto mb-4 text-green-600" />
              <h3 className="text-xl font-semibold mb-2">{t('payTitle')}</h3>
              <p className="text-2xl font-bold text-primary">{eur(cardPrice)}</p>
            </div>

            <div className="space-y-4">
              <p className="text-center text-muted-foreground">{t('insertCash')}</p>

              {/* The cash really inserted (the shop's own session): paying is only possible with money in */}
              <div className="rounded-xl border-2 border-emerald-200 bg-white p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 divide-x divide-slate-100">
                  <div className="pr-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">{t('inserted')}</span>
                    <span className="text-3xl font-bold tabular-nums text-slate-800">{eur(paid)}</span>
                  </div>
                  <div className="pl-3">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">{enough && paid > cardPrice ? t('change') : t('missing')}</span>
                    <span className={`text-3xl font-bold tabular-nums ${enough ? 'text-emerald-600' : 'text-slate-800'}`}>{enough ? eur(Math.max(0, paid - cardPrice)) : eur(missing)}</span>
                  </div>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/80">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${percent}%` }} />
                </div>
              </div>

              <Button size="lg" className="w-full" onClick={() => handlePayment(paid)} disabled={loading || !enough}>
                {t('pay')} · {eur(cardPrice)}
              </Button>

              <div className="pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (window.electronAPI?.hideKeyboard) {
                      window.electronAPI.hideKeyboard()
                    }
                    setStep(STEPS.FORM)
                  }}
                  className="w-full"
                  disabled={loading}
                >
                  {t('back')}
                </Button>
              </div>
            </div>
          </div>
        )
      }

      case STEPS.DISPENSING:
        return (
          <div className="text-center py-8">
            <div className="animate-spin h-16 w-16 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <h3 className="text-xl font-semibold mb-2">{t('dispensing')}</h3>
            <p className="text-muted-foreground">{t('pleaseWait')}</p>
          </div>
        )

      case STEPS.INSERT_CARD:
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <CreditCard className="h-16 w-16 mx-auto mb-4 text-primary animate-pulse" />
              <h3 className="text-xl font-semibold mb-2">{t('insertCardTitle')}</h3>
              <p className="text-red-500 animate-pulse animate-transform">
                {t('insertCardHint')}
              </p>
            </div>

            {writeError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                <p className="text-sm text-red-700 font-semibold">{writeError}</p>
                <p className="text-xs text-red-600 mt-1">
                  {t('notActive')}
                </p>
              </div>
            )}

            {purchasedCard && (
              <div className="bg-muted p-4 rounded-lg space-y-2">
                <p className="text-sm">
                  <span className="font-semibold">{t('code')}:</span> {purchasedCard.code}
                </p>
                <p className="text-sm">
                  <span className="font-semibold">{t('balance')}:</span> {eur(initialCredit)}
                </p>
                {changeAmount > 0 && (
                  <p className="text-sm text-green-600 font-semibold">
                    {t('change')}: {eur(changeAmount)}
                  </p>
                )}
              </div>
            )}

            <Button 
              onClick={handleCardInserted} 
              className="w-full"
              disabled={loading}
            >
              {loading ? t('activating') : t('cardInserted')}
            </Button>
          </div>
        )

      case STEPS.COMPLETE:
        return (
          <div className="text-center py-8">
            <CheckCircle2 className="h-20 w-20 mx-auto mb-4 text-green-600" />
            <h3 className="text-2xl font-semibold mb-2">{t('activatedTitle')}</h3>
            <p className="text-muted-foreground mb-4">
              {t('ready')}
            </p>
            
            {purchasedCard && (
              <div className="bg-green-50 p-4 rounded-lg mb-4">
                <p className="text-lg font-bold text-green-800">
                  {t('balance')}: {eur(initialCredit)}
                </p>
                <p className="text-sm text-green-700">
                  {t('code')}: {purchasedCard.code}
                </p>
              </div>
            )}

            <Button onClick={handleClose} className="mt-4">
              {t('done')}
            </Button>
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
      hideClose={!canClose}
      className="max-w-md"
    >
      <div className="p-6">
        {renderStepContent()}
      </div>
    </Modal>
  )
}

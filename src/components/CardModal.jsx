import React, { useEffect, useState } from 'react'
import { useCart } from '../context/CartContext'
import { useTranslation } from 'react-i18next'
import { Plus, RotateCcw, ShieldCheck, ChevronLeft, ChevronRight, ArrowLeft, CreditCard, Wifi } from 'lucide-react'
import { WasherIcon, DryerIcon } from './icons/MachineIcons'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import CardEditModal from './CardEditModal'

const MAX_RECENT = 10 // how many movements the window keeps
const PAGE_SIZE = 5   // shown per page, flipped with big touch buttons (no inner scrolling)
const QUICK = [5, 10, 20, 50]

// `onRecharge` used to be accepted here and never called — the cart-based flow superseded it.
export default function CardModal({ open, onClose, transactions = [], balance = 0, card = null, onProfileSaved }) {
  const [editOpen, setEditOpen] = React.useState(false)
  const { addToCart, openCart } = useCart()
  const { t, i18n } = useTranslation('pos')
  const { t: tc } = useTranslation('cart')
  const [amount, setAmount] = useState(10)
  const [text, setText] = useState(null) // what is being typed in the free amount; null = not typing
  const holdRef = React.useRef(null)
  const stopHold = () => { clearInterval(holdRef.current); holdRef.current = null }
  useEffect(() => stopHold, [])
  const [page, setPage] = useState(0)
  // The shop's own rules, read from the server: minimum top-up and what the card saves per machine kind.
  const [info, setInfo] = useState({ minRecharge: 0, saving: { wash: 0, dry: 0 } })
  // The −/+ buttons: see startHold; the floor is the shop minimum top-up (admin setting), never below the smallest coin.
  const minAmount = Math.max(0.1, Number(info.minRecharge) || 0) // the shop's own minimum (admin: Carregamento mínimo); never below the smallest coin

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setPage(0)
    api.request('/pos/card-info', { method: 'GET', expect: 'json', skipAuth: true })
      .then((r) => { if (alive && r) { setInfo(r); setAmount((a) => Math.max(a, Number(r.minRecharge) || 0.1)) } })
      .catch(() => {})
    return () => { alive = false }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (!open) return null

  const fmt = (n) => `${Number(n).toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`
  const close = () => {
    if (window.electronAPI?.hideKeyboard) window.electronAPI.hideKeyboard()
    onClose()
  }

  const recent = transactions.slice(0, MAX_RECENT)
  const pages = Math.max(1, Math.ceil(recent.length / PAGE_SIZE))
  const shown = recent.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const locale = i18n.language

  const dateLabel = (iso) => {
    const d = new Date(iso)
    return `${d.toLocaleDateString(locale, { day: '2-digit', month: 'short' })} • ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
  }

  // What a movement is called and which icon it gets.
  const describe = (tx) => {
    const kind = String(tx.machineType || '').toLowerCase()
    if (tx.type === 'recharge') return { title: tc('txRecharge'), tone: 'green', icon: <Plus className="w-7 h-7" strokeWidth={2.5} /> }
    if (tx.type === 'card_purchase') return { title: tc('txCardPurchase'), tone: 'green', icon: <CreditCard className="w-7 h-7" strokeWidth={2.2} /> }
    if (tx.type === 'gift_card') return { title: tc('txGiftCard'), tone: 'green', icon: <CreditCard className="w-7 h-7" strokeWidth={2.2} /> }
    if (tx.type === 'refund') return { title: tc('txRefund'), tone: 'green', icon: <RotateCcw className="w-7 h-7" strokeWidth={2.2} /> }
    const isDry = kind === 'dry' || /secar|dry|séch|trock/i.test(String(tx.name || ''))
    return {
      title: tx.name || tc('txPayment'),
      tone: isDry ? 'amber' : 'blue',
      icon: isDry ? <DryerIcon animated={false} className="w-9 h-9" /> : <WasherIcon animated={false} className="w-9 h-9" />,
    }
  }
  const TONE = { green: 'bg-emerald-100 text-emerald-700', blue: 'bg-blue-100 text-blue-700', amber: 'bg-amber-100 text-amber-700' }

  const parts = []
  if (info.saving?.wash > 0) parts.push(tc('perkWash', { amount: fmt(info.saving.wash) }))
  if (info.saving?.dry > 0) parts.push(tc('perkDry', { amount: fmt(info.saving.dry) }))
  const perkText = parts.length ? tc('perkText', { parts: parts.join(' • ') }) : ''

  const code = card?.code ? String(card.code) : ''
  const masked = code ? `•••• ${code.slice(-4)}` : '—'
  const hasBalance = balance > 0
  // Holder data on a public screen: the name in full, the rest only partly (the last digits / the domain).
  const clean = (v) => { const s = String(v ?? '').trim(); return s && s.toUpperCase() !== 'SEM NOME' ? s : '' }
  const hideAll = (v, keep = 3) => (v.length > keep ? '•'.repeat(Math.min(6, v.length - keep)) + ' ' + v.slice(-keep) : v)
  const hideEmail = (v) => { const [u, d] = v.split('@'); return d ? `${u.slice(0, 1)}•••@${d}` : hideAll(v) }
  const holder = { name: clean(card?.name), nif: clean(card?.contribuinte), phone: clean(card?.phone), email: clean(card?.email) }
  const holderRows = [[tc('holderNif'), holder.nif && hideAll(holder.nif)], [tc('holderPhone'), holder.phone && hideAll(holder.phone)], [tc('holderEmail'), holder.email && hideEmail(holder.email)]].filter(([, v]) => v)

  // Free amount: any value from the minimum to 100 EUR, in steps of 0.10 (the smallest coin). 1 EUR on the - / + buttons; or tap
  // the number and type it (numeric keypad). `text` holds what is being typed; null when not typing.
  const clampAmount = (v) => Math.min(100, Math.max(minAmount, Math.round((Number(v) || 0) * 10) / 10))
  // - / +: 0.10 EUR per tap; held down it repeats and speeds up (0.10 -> 0.50 -> 1 -> 5) so 50 EUR is not a hundred taps away.
  const startHold = (dir) => {
    stopHold()
    let ticks = 0
    const step = () => { ticks += 1; const d = ticks < 8 ? 0.1 : ticks < 20 ? 0.5 : ticks < 35 ? 1 : 5; setAmount((a) => clampAmount(a + dir * d)) }
    step()
    holdRef.current = setInterval(step, 120)
  }
  const amountText = (v) => String(Math.round(v * 100) / 100).replace('.', ',')
  const onType = (e) => {
    let v = e.target.value.replace(/[^0-9.,]/g, '').replace('.', ',')
    const i = v.indexOf(','); if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, '').slice(0, 2)
    v = v.slice(0, 6)
    setText(v)
    // Valid as typed: it counts at once (the pay button must never use an older value); the clamp comes when typing ends.
    const n = Number(v.replace(',', '.'))
    if (Number.isFinite(n) && n >= minAmount && n <= 100) setAmount(Math.round(n * 10) / 10)
  }
  const endType = () => { if (text !== null && text !== '') setAmount(clampAmount(text.replace(',', '.'))); setText(null) }

  const proceed = () => {
    if (!amount || amount <= 0) return
    // No card in the reader: nothing to top up. Say so instead of letting the payment fail later.
    if (!card?.code) { toast({ title: tc('insertCardToRecharge'), variant: 'warning' }); return }
    addToCart({
      id: `recharge-${Date.now()}`,
      name: `Recarga de Cartão - ${amount}€`,
      type: 'Recarga de Cartão',
      amount,
      price: amount,
    })
    close()
    openCart()
  }

  // Opened with no card in the reader: ask for it instead of showing an empty, misleading card (0.00, no history).
  if (!card?.code) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/35 animate-fade-in-up" onClick={close}>
        <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full bg-white rounded-[2rem] px-12 py-14 shadow-2xl text-center flex flex-col items-center gap-6" style={{ maxWidth: 'min(80vw, 760px)' }}>
          <div className="w-28 h-28 rounded-3xl bg-emerald-50 border border-emerald-200 flex items-center justify-center"><CreditCard className="w-14 h-14 text-[#008770]" strokeWidth={1.6} /></div>
          <div className="text-5xl font-bold text-slate-900 leading-tight">{tc('insertCardTitle')}</div>
          <p className="text-2xl text-slate-500 leading-snug max-w-[560px]">{tc('insertCardText')}</p>
          <button type="button" onClick={close} className="mt-4 h-20 px-14 rounded-2xl bg-[#008770] text-white font-bold text-2xl active:scale-[0.98]">{tc('back')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/35 animate-fade-in-up" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('card.title')}
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-[#f0f8f5] rounded-[2rem] p-6 shadow-2xl max-h-[94vh] overflow-y-auto"
        style={{ maxWidth: 'min(94vw, 1000px)', minHeight: '70vh' }}
      >
        <div className="grid grid-cols-2 gap-6 items-stretch" style={{ minHeight: 'calc(70vh - 3rem)' }}>
          {/* LEFT: card, balance, top-up */}
          <section className="bg-white rounded-3xl px-8 py-9 shadow-sm border border-slate-100 flex flex-col gap-8">
            {/* the card itself: calm, little text */}
            <div className="rounded-2xl px-8 py-9 text-white shadow-md relative overflow-hidden bg-gradient-to-br from-[#008770] via-[#059669] to-[#047857]">
              <div className="absolute -right-8 -bottom-10 w-36 h-36 rounded-full bg-white/10 blur-xl pointer-events-none" />
              <div className="flex justify-between items-center relative">
                <div className="text-xl font-semibold tracking-wide text-emerald-50">{tc('cardBrandTitle')}</div>
                <div className="w-12 h-9 rounded-md bg-amber-200/90 border border-amber-300 flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-amber-800 rotate-90" />
                </div>
              </div>
              <div className="mt-16 text-3xl font-medium tracking-[0.25em] font-mono relative">{masked}</div>
              {holder.name && <div className="mt-4 text-2xl font-semibold text-emerald-50 relative truncate">{holder.name}</div>}
            </div>
            <button type="button" onClick={() => setEditOpen(true)} className="-mt-3 self-start h-14 px-6 rounded-xl border-2 border-slate-200 text-slate-600 font-semibold text-xl active:bg-slate-50">{tc('editData')}</button>
            {holderRows.length > 0 && (
              <div className="-mt-2 flex flex-wrap gap-x-8 gap-y-2 text-lg text-slate-500">
                {holderRows.map(([k, v]) => (<span key={k}><span className="text-slate-400">{k}: </span><span className="font-semibold text-slate-700">{v}</span></span>))}
              </div>
            )}

            {/* status + balance */}
            <div className="flex items-center justify-between gap-6 pb-8 border-b border-slate-100">
              <div className="flex flex-col gap-2">
                <span className="text-lg text-slate-400">{tc('cardStatus')}</span>
                <span className="inline-flex w-fit items-center gap-2 text-emerald-700 font-semibold text-lg bg-emerald-50 px-3.5 py-1 rounded-full">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                  {t('card.active')}
                </span>
              </div>
              <div className="text-right flex flex-col gap-1">
                <span className="text-lg text-slate-400">{t('card.balanceLabel')}</span>
                <span className={`text-6xl font-bold tracking-tight ${hasBalance ? 'text-[#008770]' : 'text-slate-600'}`}>{fmt(balance)}</span>
              </div>
            </div>

            {/* top-up: takes the free space and sits in the middle of it */}
            <div className="flex-1 flex flex-col justify-center gap-7">
              <div className="text-center text-xl font-semibold text-slate-500">{tc('selectAmount')}</div>
              <div className="flex items-center justify-between gap-4">
                <button type="button" aria-label={tc('amountLess')} onPointerDown={() => startHold(-1)} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} className="select-none touch-none shrink-0 w-20 h-20 rounded-2xl bg-white border-2 border-slate-200 text-slate-700 text-5xl leading-none flex items-center justify-center active:scale-95">−</button>
                <div className="flex-1 min-w-0 flex items-baseline justify-center gap-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={tc('selectAmount')}
                    value={text !== null ? text : amountText(amount)}
                    onFocus={(e) => { setText(amountText(amount)); e.target.select?.() }}
                    onChange={onType}
                    onBlur={endType}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    style={{ width: `${Math.max(2, String(text !== null ? text : amountText(amount)).length) + 0.6}ch` }}
                    className="min-w-0 max-w-full text-center text-6xl font-bold text-[#008770] tracking-tight bg-transparent border-b-4 border-dashed border-emerald-200 focus:border-[#008770] outline-none"
                  />
                  <span className="text-5xl font-bold text-[#008770]">€</span>
                </div>
                <button type="button" aria-label={tc('amountMore')} onPointerDown={() => startHold(1)} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} className="select-none touch-none shrink-0 w-20 h-20 rounded-2xl bg-[#008770] text-white text-5xl leading-none flex items-center justify-center active:scale-95">+</button>
              </div>
              <div className="grid grid-cols-4 gap-4">
                {QUICK.filter((v) => v >= minAmount).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(v)}
                    className={`h-16 rounded-xl text-2xl font-semibold active:scale-95 ${amount === v ? 'bg-emerald-50 border-2 border-[#008770] text-[#006d5b]' : 'bg-white border-2 border-slate-200 text-slate-600'}`}
                  >{v}€</button>
                ))}
              </div>
            </div>

            {/* actions, pinned to the bottom */}
            <div className="flex flex-col gap-3 pt-8 border-t border-slate-100">
              <button type="button" onClick={proceed} className="w-full h-20 rounded-2xl bg-[#008770] text-white font-bold text-2xl flex items-center justify-center gap-3 shadow-md active:scale-[0.98]">
                <CreditCard className="w-7 h-7 text-emerald-100" />
                {tc('goToPayment')}
              </button>
              <button type="button" onClick={close} className="w-full h-16 rounded-2xl text-slate-500 font-semibold text-2xl flex items-center justify-center gap-2 active:bg-slate-100">
                <ArrowLeft className="w-6 h-6" />
                {tc('back')}
              </button>
            </div>
          </section>

          {/* RIGHT: history */}
          <section className="bg-white rounded-3xl p-7 shadow-sm border border-slate-100 flex flex-col gap-6">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-5">
              <div>
                <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">{t('card.transactionsTitle')}</h2>
                <p className="text-base text-slate-400 font-medium mt-1">{tc('historySub')}</p>
              </div>
              <div className="w-fit inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-xl border border-slate-200/60">
                <span className="w-2 h-2 rounded-full bg-emerald-600" />
                <span className="text-sm font-bold text-slate-700">{tc('lastMoves')}</span>
                <span className="text-sm font-bold px-2 rounded-full bg-white text-slate-600 border border-slate-200">{recent.length}</span>
              </div>
            </div>

            {recent.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-14 px-4 text-slate-300">
                <ShieldCheck className="w-20 h-20 opacity-40" strokeWidth={1.2} />
                <h3 className="text-xl font-bold text-slate-600 mt-4">{tc('noTransactions')}</h3>
                <p className="text-base text-slate-400 max-w-xs mt-1">{tc('noTransactionsHint')}</p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4">
                  {shown.map((tx) => {
                    const d = describe(tx)
                    const positive = tx.amount >= 0
                    return (
                      <div key={tx.id} className="flex items-center justify-between gap-4 p-5 rounded-2xl border border-slate-100 bg-[#fbfdfc]">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className={`w-16 h-16 rounded-xl flex items-center justify-center shrink-0 ${TONE[d.tone]}`}>{d.icon}</div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 text-xl leading-tight">{d.title}</div>
                            <div className="text-base text-slate-400 font-medium">{dateLabel(tx.ts)}</div>
                          </div>
                        </div>
                        <span className={`text-xl font-extrabold shrink-0 ${positive ? 'text-[#008770]' : 'text-slate-800'}`}>{positive ? '+' : '−'}{fmt(Math.abs(Number(tx.amount)))}</span>
                      </div>
                    )
                  })}
                </div>
                {pages > 1 && (
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="h-14 px-4 rounded-xl bg-white border-2 border-slate-200 text-slate-700 font-bold text-lg whitespace-nowrap flex items-center gap-1 disabled:opacity-35 active:scale-95">
                      <ChevronLeft className="w-6 h-6" />{tc('prevPage')}
                    </button>
                    <span className="text-lg font-bold text-slate-500">{page + 1} / {pages}</span>
                    <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="h-14 px-4 rounded-xl bg-white border-2 border-slate-200 text-slate-700 font-bold text-lg whitespace-nowrap flex items-center gap-1 disabled:opacity-35 active:scale-95">
                      {tc('nextPage')}<ChevronRight className="w-6 h-6" />
                    </button>
                  </div>
                )}
              </>
            )}

            {perkText && (
              <div className="mt-auto bg-gradient-to-r from-emerald-50 to-[#ebf8f4] border border-emerald-200/80 rounded-2xl p-5 flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#008770] text-white shrink-0 flex items-center justify-center shadow-md">
                  <ShieldCheck className="w-7 h-7" strokeWidth={2.2} />
                </div>
                <div>
                  <div className="font-extrabold text-slate-900 text-lg">{tc('perkTitle')}</div>
                  <p className="text-base text-slate-700 font-medium leading-snug mt-1">{perkText}</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
      <CardEditModal open={editOpen} card={card} onClose={() => setEditOpen(false)} onSaved={(c) => onProfileSaved?.(c)} />
    </div>
  )
}

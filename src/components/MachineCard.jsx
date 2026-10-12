import React from 'react'
import useFrameAnimation from '../hooks/useFrameAnimation'
import { useTranslation } from 'react-i18next'
import api from '@/services/api'
import { isPromoActive, getEffectivePrice } from '@/lib/promo'
import { Tag, Check } from 'lucide-react'

export default function MachineCard({ m, frames, inCart = false, onSelect = () => {} }) {
  const { t, i18n } = useTranslation('pos')
  const [priceData, setPriceData] = React.useState(null)

  // Fetch price data
  React.useEffect(() => {
    let mounted = true
    async function loadPrice() {
      if (m.type && m.weight) {
        try {
          const price = await api.getPriceByTypeWeightPublic(m.type, m.weight)
          if (mounted && price) {
            setPriceData(price)
          }
        } catch (e) {
          console.error('Failed to fetch price', e)
        }
      }
    }
    loadPrice()
    return () => { mounted = false }
  }, [m.type, m.weight])

  const uniqueId = m._id || m.id || ''
  const seed = Array.from(String(uniqueId)).reduce((s, c) => s * 31 + c.charCodeAt(0), 0)
  const frame = useFrameAnimation(frames, 300, { seed })
  const isFree = m.status === 'free'
  const isOffline = m.status === 'offline' || m.status === 'fault' || m.outOfService === true
  // A machine already in the basket stays tappable: the tap takes it out again.
  const tappable = isFree || inCart

  const fmt = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Calculate effective prices
  const cashPrice = priceData ? getEffectivePrice(priceData, 'cash') : (m.price || 0)
  const cardPrice = priceData ? getEffectivePrice(priceData, 'card') : Math.max(0, (m.price || 0) - 0.5)
  const isPromo = priceData ? isPromoActive(priceData) : false

  const frameClass = inCart
    ? 'bg-emerald-50 border-2 border-emerald-200'
    : 'bg-slate-50 border border-slate-200'
  const cardClass = inCart
    ? 'border-2 border-emerald-500 shadow-[0_8px_24px_-4px_rgba(5,150,105,0.25)]'
    : 'border border-slate-200 shadow-[0_4px_20px_-2px_rgba(16,185,129,0.08),0_2px_6px_-1px_rgba(0,0,0,0.04)]'
  const pill = isFree
    ? { cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500', label: t('status.free') }
    : isOffline
      ? { cls: 'text-amber-700 bg-amber-50 border-amber-200', dot: 'bg-amber-500', label: t('status.offline') }
      : { cls: 'text-rose-700 bg-rose-50 border-rose-200', dot: 'bg-rose-500', label: t('status.occupied') }

  return (
    <article
      className={`relative bg-white rounded-3xl p-8 flex items-center justify-between gap-6 transition-all duration-150 ${cardClass} ${tappable ? 'cursor-pointer active:scale-[0.99]' : 'opacity-60 pointer-events-none'}`}
      onClick={() => tappable && onSelect(uniqueId)}
      role="button"
      aria-disabled={!tappable}
      aria-label={inCart ? t('machines.removeLabel', { name: m.name }) : m.name}
    >
      <div className="flex items-center gap-7 min-w-0">
        <div className={`relative shrink-0 w-24 h-24 min-[900px]:w-32 min-[900px]:h-32 rounded-3xl flex items-center justify-center ${frameClass}`}>
          {frame && <img src={frame} alt="" className="w-20 h-20 min-[900px]:w-24 min-[900px]:h-24 object-contain tealFilter" />}
          {inCart && (
            <span className="absolute -top-2.5 -right-2.5 bg-emerald-600 text-white rounded-full p-1.5 shadow-md">
              <Check className="w-5 h-5" strokeWidth={3.5} />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-4xl font-black text-slate-900 tracking-tight leading-tight whitespace-nowrap">{m.name}</h3>
            {inCart && <span className="bg-emerald-100 text-emerald-800 text-base font-bold px-3.5 py-1 rounded-lg">{t('machines.inCart')}</span>}
            {isPromo && (
              <span className="text-sm font-bold px-3 py-1 bg-orange-100 text-orange-800 rounded-lg flex items-center gap-1.5">
                <Tag className="h-4 w-4" /> PROMO
              </span>
            )}
          </div>
          <p className="text-2xl text-slate-600 mt-3 font-medium flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="font-semibold text-slate-800">{m.weight} {t('unit.kg')}</span>
            <span className="text-slate-300">•</span>
            <span>{t('machines.cashPrice', { price: fmt.format(cashPrice) })}</span>
            <span className="text-slate-300">•</span>
            <span className="text-emerald-700 font-semibold bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200/60">{t('machines.cardPrice', { price: fmt.format(cardPrice) })}</span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-5 shrink-0">
        <div className={`items-center gap-2 text-2xl font-bold px-6 py-3 rounded-full border ${pill.cls} ${inCart ? 'hidden min-[900px]:flex' : 'flex'}`}>
          <span className={`w-3 h-3 rounded-full ${pill.dot}`} />
          <span>{pill.label}</span>
        </div>
        {inCart && (
          <div className="h-[72px] px-8 rounded-2xl bg-emerald-600 text-white font-bold text-2xl flex items-center gap-2.5 shadow-sm">
            <Check className="w-6 h-6" strokeWidth={3} />
            <span className="hidden min-[900px]:inline">{t('machines.selected')}</span>
          </div>
        )}
      </div>
    </article>
  )
}

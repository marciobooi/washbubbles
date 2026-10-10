import React from 'react'
import useFrameAnimation from '../hooks/useFrameAnimation'
import { useTranslation } from 'react-i18next'
import api from '@/services/api'
import { isPromoActive, getEffectivePrice } from '@/lib/promo'
import { Tag } from 'lucide-react'

export default function MachineCard({ m, frames, onSelect = () => {} }) {
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
  const isOffline = m.status === 'offline' || m.outOfService === true
  const borderClass = isFree ? 'border-2 border-green-500' : 'border-2 border-red-500'
  const interactiveClass = isFree
    ? 'cursor-pointer active:scale-95 active:shadow-lg hover:shadow-lg transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-400'
    : 'cursor-not-allowed opacity-70 pointer-events-none'

  const fmt = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Calculate effective prices
  const cashPrice = priceData ? getEffectivePrice(priceData, 'cash') : (m.price || 0)
  const cardPrice = priceData ? getEffectivePrice(priceData, 'card') : Math.max(0, (m.price || 0) - 0.5)
  const isPromo = priceData ? isPromoActive(priceData) : false

  return (
    <div
      className={`rounded-2xl shadow-xl bg-white flex items-center gap-6 p-6 ${borderClass} ${interactiveClass}`}
      onClick={() => isFree && onSelect(uniqueId)}
      role="button"
      aria-disabled={!isFree}
      aria-label={m.name}
    >
      <div className="w-32 h-32 shrink-0 flex items-center justify-center">
        {frame && (
          <img src={frame} alt={m.name} className="w-28 h-28 object-contain tealFilter" />
        )}
      </div>
      <div className="flex-1">
        <div className="text-3xl font-semibold flex items-center gap-3">
          {m.name}
          {isPromo && (
            <span className="text-base px-3 py-1 bg-orange-100 text-orange-800 rounded-lg flex items-center gap-2">
              <Tag className="h-5 w-5" /> PROMO
            </span>
          )}
        </div>
        <div className="text-xl text-neutral-600 mt-1">
          {m.weight} {t('unit.kg')} • {fmt.format(cashPrice)}€ dinheiro • {fmt.format(cardPrice)}€ cartão
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${isFree ? 'bg-green-500' : 'bg-red-500'}`} />
        <div className="text-2xl font-medium">{t(`status.${isFree ? 'free' : isOffline ? 'offline' : 'occupied'}`)}</div>
      </div>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import BubbleLoader from './BubbleLoader'

/**
 * The app's loading state. Default is a small spinner (a few bubbles rising in a 96 px box, label under it).
 * size="large" is the full playful version with tappable bubbles, for long waits.
 */
export default function Loading({ size = 'small', label }) {
  const { t } = useTranslation('cart')
  const text = label || t('loading')
  if (size === 'large') {
    return (
      <BubbleLoader className="w-full h-[55vh]">
        <div className="px-8 py-4 rounded-full bg-white/80 backdrop-blur-sm shadow-sm text-xl font-semibold text-teal-800">{text}</div>
      </BubbleLoader>
    )
  }
  return (
    <div className="flex flex-col items-center py-8" role="status" aria-live="polite">
      {/* the bubbles are born at the label: it overlaps the bottom of the box and sits in front of them */}
      <BubbleLoader compact className="w-28 h-28" />
      <span className="relative z-10 -mt-5 px-5 py-1.5 rounded-full bg-white/85 text-xl font-semibold text-teal-800 shadow-sm">{text}</span>
    </div>
  )
}

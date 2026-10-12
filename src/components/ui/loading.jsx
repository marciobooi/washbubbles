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
    <div className="flex flex-col items-center gap-3 py-8" role="status" aria-live="polite">
      <BubbleLoader compact className="w-24 h-24" />
      <span className="text-xl font-semibold text-teal-800">{text}</span>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import BubbleLoader from './BubbleLoader'

/** The app's loading state: floating bubbles you can pop, with the shop's "loading" message on top. */
export default function Loading({ size = 'small', label }) {
  const { t } = useTranslation('cart')
  const h = size === 'small' ? 'h-64' : 'h-[55vh]'
  return (
    <BubbleLoader className={`w-full ${h}`}>
      <div className="px-8 py-4 rounded-full bg-white/80 backdrop-blur-sm shadow-sm text-xl font-semibold text-teal-800">
        {label || t('loading')}
      </div>
    </BubbleLoader>
  )
}

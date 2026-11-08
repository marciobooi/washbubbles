import React from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/ui/Modal'

/**
 * Shown when a machine is tapped, instead of silently adding it and showing a small notice (that confused older customers):
 * add it to the cart (and keep choosing) or pay for it now. Both end in the normal cart / payment flow.
 */
export default function MachineChoiceModal({ open, machine, price, inCart, onAdd, onPay, onRemove, onClose }) {
  const { t } = useTranslation('cart')
  if (!open || !machine) return null
  const base = Number(machine.tImp) || 15
  const priceText = price != null ? `${Number(price).toFixed(2).replace('.', ',')}€` : ''
  return (
    <Modal open={open} onClose={onClose} title={machine.name} maxWidth="640px">
      <div className="pt-2 pb-1 text-center">
        <h3 className="text-4xl font-extrabold text-slate-900 pr-10 pl-10">{machine.name}</h3>
        <p className="mt-2 text-2xl text-slate-600 min-h-[2rem]">{price != null ? t('choiceCycle', { min: base, price: priceText }) : ''}</p>
        <p className="mt-4 text-2xl text-slate-700">{inCart ? t('choiceInCart') : t('choiceHint')}</p>
        <div className="mt-6 grid gap-4">
          <button
            type="button"
            onClick={onPay}
            className="min-h-[88px] rounded-2xl bg-emerald-600 text-white text-3xl font-extrabold px-6 py-4 active:bg-emerald-700 shadow-md"
          >
            {t('choicePay')}
            <span className="block text-lg font-medium text-emerald-50 mt-1">{t('choicePayHint')}</span>
          </button>
          {inCart ? (
            <button
              type="button"
              onClick={onRemove}
              className="min-h-[72px] rounded-2xl border-2 border-slate-300 bg-white text-slate-800 text-2xl font-bold px-6 py-3 active:bg-slate-100"
            >
              {t('choiceRemove')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onAdd}
              className="min-h-[88px] rounded-2xl border-2 border-emerald-600 bg-white text-emerald-700 text-3xl font-extrabold px-6 py-4 active:bg-emerald-50"
            >
              {t('choiceAdd')}
              <span className="block text-lg font-medium text-slate-500 mt-1">{t('choiceAddHint')}</span>
            </button>
          )}
          <button type="button" onClick={onClose} className="min-h-[64px] rounded-2xl text-slate-600 text-2xl font-semibold active:bg-slate-100">{t('cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

import React, { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { User, Mail, Phone, FileText } from 'lucide-react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import LegalModal from './LegalModal'

const FIELDS = [
  { key: 'name', icon: User, type: 'text' },
  { key: 'email', icon: Mail, type: 'email' },
  { key: 'phone', icon: Phone, type: 'tel' },
  { key: 'contribuinte', icon: FileText, type: 'text' },
]
const LABEL = { name: 'name', email: 'email', phone: 'phone', contribuinte: 'nif' }

const clean = (v) => { const s = String(v ?? '').trim(); return s.toUpperCase() === 'SEM NOME' ? '' : s }

/** The holder edits their own details, with their card in the reader (the shop checks that again on the server). */
export default function CardEditModal({ open, card, onClose, onSaved }) {
  const { t } = useTranslation('buycard')
  const { t: tc } = useTranslation('cart')
  const [form, setForm] = useState({ name: '', email: '', phone: '', contribuinte: '', privacyConsent: false, marketingOptIn: false })
  const [saving, setSaving] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm({
      name: clean(card?.name), email: clean(card?.email), phone: clean(card?.phone), contribuinte: clean(card?.contribuinte),
      privacyConsent: Boolean(card?.privacyConsentAt), marketingOptIn: Boolean(card?.marketingOptIn),
    })
  }, [open, card?.code])

  if (!open) return null

  const hasData = Boolean(`${form.name}${form.email}${form.phone}${form.contribuinte}`.trim())
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const showKb = () => { if (window.electronAPI?.showKeyboard) window.electronAPI.showKeyboard() }
  const hideKb = () => { if (window.electronAPI?.hideKeyboard) window.electronAPI.hideKeyboard() }

  async function save() {
    if (hasData && !form.privacyConsent) { toast({ title: t('consentRequired'), variant: 'warning' }); return }
    const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
    const kioskKey = electronKey || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
    setSaving(true)
    try {
      const r = await api.updateCardProfile(card.code, form, { apiKey: kioskKey })
      toast({ title: tc('editSaved'), variant: 'success' })
      hideKb()
      onSaved?.(r.card)
      onClose()
    } catch (e) {
      const c = e?.body?.code
      toast({ title: c === 'card-not-in-reader' ? tc('editCardGone') : c === 'consent-required' ? t('consentRequired') : (e?.body?.error || tc('editError')), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  const close = () => { hideKb(); onClose() }

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-6 bg-black/40" onClick={(e) => { e.stopPropagation(); close() }}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full bg-white rounded-[2rem] p-8 shadow-2xl max-h-[94vh] overflow-y-auto" style={{ maxWidth: 'min(80vw, 760px)' }}>
        <h3 className="text-4xl font-bold text-slate-900">{tc('editTitle')}</h3>
        <p className="text-xl text-slate-500 mt-1 mb-6">{tc('editHint')}</p>

        <div className="flex flex-col gap-4">
          {FIELDS.map(({ key, icon: Icon, type }) => (
            <div key={key}>
              <label htmlFor={`edit-${key}`} className="block text-sm font-semibold uppercase tracking-wider text-slate-600 mb-2 ml-1">{t(LABEL[key])}</label>
              <div className="relative flex items-center">
                <Icon className="absolute left-4 h-6 w-6 text-slate-400 pointer-events-none" />
                <input
                  id={`edit-${key}`}
                  type={type}
                  autoComplete="off"
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  onFocus={showKb}
                  className="w-full h-16 pl-14 pr-4 bg-slate-50/70 border border-slate-200 rounded-xl text-xl text-slate-800 focus:bg-white focus:ring-2 focus:ring-[#00875A] focus:border-[#00875A] outline-none transition"
                />
              </div>
            </div>
          ))}

          <div className={`flex items-start gap-4 p-3 rounded-xl border-2 ${hasData && !form.privacyConsent ? 'border-amber-300 bg-amber-50/60' : 'border-transparent'}`}>
            <input id="edit-consent" type="checkbox" className="mt-1 w-7 h-7 shrink-0 rounded-md border-2 border-slate-300 accent-[#00875A]" checked={form.privacyConsent} onChange={(e) => set('privacyConsent', e.target.checked)} />
            <label htmlFor="edit-consent" className="text-lg font-medium text-slate-700 leading-snug">
              <Trans ns="buycard" i18nKey="consent" components={{ a: <button type="button" onClick={(e) => { e.preventDefault(); setShowPrivacy(true) }} className="font-semibold text-[#00875A] underline underline-offset-4" /> }} />
            </label>
          </div>
          <label htmlFor="edit-marketing" className="flex items-center gap-4 p-3 rounded-xl active:bg-slate-100 cursor-pointer">
            <input id="edit-marketing" type="checkbox" className="w-7 h-7 rounded-md border-2 border-slate-300 accent-[#00875A]" checked={form.marketingOptIn} onChange={(e) => set('marketingOptIn', e.target.checked)} />
            <span className="text-lg font-medium text-slate-700">{t('marketing')}</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-200/80">
          <button type="button" disabled={saving} onClick={close} className="h-[72px] rounded-2xl bg-emerald-50 border border-emerald-200 text-[#00875A] font-bold text-2xl active:scale-[0.98] disabled:opacity-50">{tc('editCancel')}</button>
          <button type="button" disabled={saving} onClick={save} className="h-[72px] rounded-2xl bg-[#00875A] border border-emerald-700 text-white font-bold text-2xl shadow-md active:scale-[0.98] disabled:opacity-50">{tc('editSave')}</button>
        </div>
      </div>
      <LegalModal open={showPrivacy} kind="privacy" onClose={() => setShowPrivacy(false)} />
    </div>
  )
}

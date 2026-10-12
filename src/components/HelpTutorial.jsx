import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'

// One coloured row of the tutorial (a legend entry, a payment option, ...).
const TONES = {
  green: 'bg-emerald-50/70 border-emerald-300 text-emerald-900',
  red: 'bg-rose-50/70 border-rose-200 text-rose-900',
  amber: 'bg-amber-50/70 border-amber-200 text-amber-900',
  teal: 'bg-teal-50/70 border-teal-200 text-teal-900',
  slate: 'bg-slate-50 border-slate-200 text-slate-800',
}
function Row({ tone = 'slate', children }) {
  return <div className={`rounded-2xl border-2 px-5 py-4 text-xl font-medium leading-snug ${TONES[tone]}`}>{children}</div>
}
function Note({ icon = '👆', children }) {
  return (
    <div className="rounded-2xl bg-slate-100/80 border border-slate-200 px-5 py-4 flex items-center gap-3 text-lg font-semibold text-slate-700">
      <span className="text-2xl">{icon}</span>
      <p>{children}</p>
    </div>
  )
}

export default function HelpTutorial({ run, onClose }) {
  const { t } = useTranslation('help')
  const [step, setStep] = useState(0)
  const [company, setCompany] = useState(null)

  React.useEffect(() => {
    // listen for branding updates from App
    const onBrand = (e) => setCompany(e && e.detail && e.detail.company ? e.detail.company : null)
    window.addEventListener('branding:update', onBrand)
    try { if (!company && typeof document !== 'undefined' && document.title) setCompany(document.title) } catch { /* document.title is cosmetic; a sandboxed frame can refuse it */ }
    return () => window.removeEventListener('branding:update', onBrand)
  }, [company])

  // Each time it opens it starts from the first step.
  React.useEffect(() => { if (run) setStep(0) }, [run])

  if (!run) return null

  const name = company || 'Washstore'
  const steps = [
    {
      hero: true,
      title: <Trans ns="help" i18nKey="welcome.title" values={{ company: name }} />,
      body: <p className="text-slate-600 text-xl leading-relaxed font-medium max-w-xl"><Trans ns="help" i18nKey="welcome.text" /></p>,
    },
    {
      title: <Trans ns="help" i18nKey="step1.title" />,
      body: (
        <>
          <Row tone="teal"><Trans ns="help" i18nKey="step1.wash" components={[<strong />]} /></Row>
          <Row tone="teal"><Trans ns="help" i18nKey="step1.dry" components={[<strong />]} /></Row>
          <Note><Trans ns="help" i18nKey="step1.instruction" /></Note>
        </>
      ),
    },
    {
      title: <Trans ns="help" i18nKey="step2.title" />,
      body: (
        <>
          <Row tone="green"><Trans ns="help" i18nKey="step2.available" components={[<strong />]} /></Row>
          <Row tone="red"><Trans ns="help" i18nKey="step2.occupied" components={[<strong />]} /></Row>
          <Row tone="amber"><Trans ns="help" i18nKey="step2.maintenance" components={[<strong />]} /></Row>
          <Note><Trans ns="help" i18nKey="step2.instruction" components={[<strong className="text-emerald-700" />]} /></Note>
        </>
      ),
    },
    {
      title: <Trans ns="help" i18nKey="step3.title" />,
      body: (
        <>
          <Row tone="slate">{t('step3.durations')} • {t('step3.temperatures')} • {t('step3.prices')}</Row>
          <Note><Trans ns="help" i18nKey="step3.instruction" /></Note>
        </>
      ),
    },
    {
      title: <Trans ns="help" i18nKey="step4.title" />,
      body: (
        <>
          <Row tone="slate"><Trans ns="help" i18nKey="step4.text" /></Row>
          <Note><Trans ns="help" i18nKey="step4.instruction" /></Note>
        </>
      ),
    },
    {
      title: <Trans ns="help" i18nKey="step5.title" />,
      body: (
        <>
          <Row tone="green"><Trans ns="help" i18nKey="step5.option1" components={[<strong />]} /></Row>
          <Row tone="slate"><Trans ns="help" i18nKey="step5.option2" components={[<strong />]} /></Row>
          <Note icon="⚠️"><Trans ns="help" i18nKey="step5.note" components={{ em: <em /> }} /></Note>
        </>
      ),
    },
    {
      title: <Trans ns="help" i18nKey="card.title" />,
      body: (
        <>
          <Row tone="teal"><Trans ns="help" i18nKey="card.text" components={[<strong />]} /></Row>
          <Note icon="💡"><Trans ns="help" i18nKey="done.note" components={{ strong: <strong /> }} /></Note>
        </>
      ),
    },
    {
      hero: true,
      title: <Trans ns="help" i18nKey="done.title" />,
      body: (
        <>
          <p className="text-slate-600 text-xl leading-relaxed font-medium max-w-xl"><Trans ns="help" i18nKey="done.text" values={{ company: name }} /></p>
          <p className="text-slate-500 text-lg"><Trans ns="help" i18nKey="done.note" components={{ strong: <strong /> }} /></p>
        </>
      ),
    },
  ]

  const total = steps.length
  const cur = steps[step]
  const last = step === total - 1
  const close = () => {
    setStep(0)
    try { onClose && onClose() } catch (err) { console.error(err) }
    try { window.dispatchEvent(new CustomEvent('modal-close')) } catch { /* optional notification */ }
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-slate-950/65 backdrop-blur-md" role="presentation">
      <div role="dialog" aria-modal="true" className="w-full bg-white rounded-[2rem] border border-slate-100 overflow-hidden flex flex-col" style={{ maxWidth: 'min(68vw, 740px)', boxShadow: '0 25px 60px -15px rgba(15,23,42,.35)' }}>
        {/* header: step badge + progress + close */}
        <div className="px-7 pt-6 pb-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/70">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-sm font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                {t('buttons.badge', { n: step + 1, total })}
              </span>
              <span className="text-sm font-semibold text-slate-400">{t('buttons.guide')}</span>
            </div>
            <div className="w-48 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-600 to-teal-500 rounded-full transition-all duration-500" style={{ width: `${((step + 1) / total) * 100}%` }} />
            </div>
          </div>
          <button type="button" aria-label={t('buttons.close')} onClick={close} className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white border border-slate-200 text-slate-400 active:scale-95 shadow-sm">
            <X className="w-7 h-7" strokeWidth={2.5} />
          </button>
        </div>

        {/* content */}
        <div className="px-8 py-7 min-h-[380px] flex flex-col justify-center">
          {cur.hero ? (
            <div className="flex flex-col items-center text-center gap-5">
              <div className="relative w-28 h-28 rounded-[1.75rem] bg-gradient-to-tr from-emerald-50 to-teal-50 border-2 border-emerald-100 flex items-center justify-center">
                <div className="w-20 h-20 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30 text-5xl">{last ? '🎉' : '🫧'}</div>
              </div>
              <h2 className="text-4xl font-extrabold text-emerald-700 tracking-tight">{cur.title}</h2>
              {cur.body}
            </div>
          ) : (
            <div className="flex flex-col gap-5 text-left">
              <h2 className="text-3xl font-extrabold text-teal-700 tracking-tight">{cur.title}</h2>
              <div className="flex flex-col gap-3">{cur.body}</div>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="px-6 py-5 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-4">
          <button type="button" onClick={close} className="h-16 px-4 rounded-2xl text-slate-500 font-bold text-lg whitespace-nowrap active:bg-slate-200/60">
            {t('buttons.skip')}
          </button>
          <div className="flex items-center gap-4">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="h-16 px-5 rounded-2xl bg-white border-2 border-slate-200 text-teal-800 font-bold text-lg whitespace-nowrap shadow-sm flex items-center gap-2 active:scale-95">
                <ChevronLeft className="w-6 h-6" strokeWidth={2.5} />
                {t('buttons.back')}
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? close() : setStep(step + 1))}
              className="h-16 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-extrabold text-lg whitespace-nowrap shadow-lg flex items-center gap-2 active:scale-[0.98]"
            >
              <span>{last ? t('buttons.last') : t('buttons.nextStep', { n: step + 2, total })}</span>
              {!last && <ChevronRight className="w-6 h-6" strokeWidth={2.5} />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

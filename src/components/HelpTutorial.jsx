import React, { useState } from 'react'
import Joyride, { STATUS } from 'react-joyride'
import { X } from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'

export default function HelpTutorial({ run, onClose }) {
  const { t } = useTranslation('help')
  const [stepIndex, setStepIndex] = useState(0)
  const [company, setCompany] = useState(null)

  React.useEffect(() => {
    // listen for branding updates from App
    const onBrand = (e) => setCompany(e && e.detail && e.detail.company ? e.detail.company : null)
    window.addEventListener('branding:update', onBrand)
    // try to initialize from document.title if present
    try { if (!company && typeof document !== 'undefined' && document.title) setCompany(document.title) } catch { /* document.title is cosmetic; a sandboxed frame can refuse it */ }
    return () => window.removeEventListener('branding:update', onBrand)
  }, [company])
  const steps = [
    {
      target: 'body',
      content: (
        <div className="text-center">
          <h2 className="text-2xl font-bold text-teal-600 mb-3"><Trans ns="help" i18nKey="welcome.title" values={{ company: company || 'Washstore' }} /></h2>
          <p className="text-neutral-700"><Trans ns="help" i18nKey="welcome.text" /></p>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3"><Trans ns="help" i18nKey="step1.title" /></h3>
          <div className="space-y-2 text-neutral-700">
            <p><Trans ns="help" i18nKey="step1.wash" components={[<strong />]} /></p>
            <p><Trans ns="help" i18nKey="step1.dry" components={[<strong />]} /></p>
            <p className="mt-1"><Trans ns="help" i18nKey="step1.instruction" /></p>
          </div>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3"><Trans ns="help" i18nKey="step2.title" /></h3>
          <div className="space-y-2 text-neutral-700">
            <p><Trans ns="help" i18nKey="step2.available" components={[<strong className="text-green-600" />]} /></p>
            <p><Trans ns="help" i18nKey="step2.occupied" components={[<strong className="text-red-600" />]} /></p>
            <p><Trans ns="help" i18nKey="step2.maintenance" components={[<strong className="text-yellow-600" />]} /></p>
            <p className="mt-3"><Trans ns="help" i18nKey="step2.instruction" components={[<strong />]} /></p>
          </div>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3"><Trans i18nKey="step3.title" /></h3>
          <div className="space-y-2 text-neutral-700">
            <p>{t('step3.durations')} • {t('step3.temperatures')} • {t('step3.prices')}</p>
            <p className="mt-3"><Trans ns="help" i18nKey="step3.instruction" /></p>
          </div>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '[aria-label="Abrir carrinho"]',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3"><Trans ns="help" i18nKey="step4.title" /></h3>
          <div className="space-y-2 text-neutral-700">
            <p><Trans ns="help" i18nKey="step4.text" /></p>
            <p className="mt-3"><Trans ns="help" i18nKey="step4.instruction" /></p>
          </div>
        </div>
      ),
      placement: 'bottom',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3"><Trans ns="help" i18nKey="step5.title" /></h3>
          <div className="space-y-2 text-neutral-700">
            <p><Trans ns="help" i18nKey="step5.option1" components={[<strong />]} /></p>
            <p><Trans ns="help" i18nKey="step5.option2" components={[<strong />]} /></p>
            <p className="mt-3"><Trans ns="help" i18nKey="step5.note" components={{ em: <em /> }} /></p>
          </div>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: 'body',
      content: (
        <div>
          <h3 className="text-xl font-bold text-teal-600 mb-3"><Trans ns="help" i18nKey="card.title" /></h3>
          <div className="space-y-2 text-neutral-700">
            <p><Trans ns="help" i18nKey="card.text" components={[<strong />]} /></p>
            <p className="mt-3">💡 <Trans ns="help" i18nKey="done.note" /></p>
          </div>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },  
    {
      target: 'body',
      content: (
        <div className="text-center">
          <h2 className="text-2xl font-bold text-teal-600 mb-3"><Trans ns="help" i18nKey="done.title" /></h2>
          <p className="text-neutral-700 mb-4"><Trans ns="help" i18nKey="done.text" values={{ company: company || 'Washstore' }} /></p>
          <p className="text-sm text-neutral-500"><Trans ns="help" i18nKey="done.note" components={{ strong: <strong /> }} /></p>
        </div>
      ),
      placement: 'center',
      disableBeacon: true,
    },
  ]

  const handleJoyrideCallback = (data) => {
    const { status, index, action } = data

    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
      onClose()
      setStepIndex(0)
    } else if (action === 'next' || action === 'prev') {
      setStepIndex(index + (action === 'next' ? 1 : -1))
    }
  }

  // Capture clicks on Joyride's internal close button (data-test-id="button-close") in case
  // the button's own handler is blocked by overlay or propagation issues.
  React.useEffect(() => {
    if (!run) return
    const onDocClick = (e) => {
      try {
        const el = e.target && e.target.closest ? e.target.closest('[data-test-id="button-close"]') : null
        if (el) {
          e.preventDefault()
          e.stopPropagation()
          try { onClose && onClose() } catch (err) { console.error(err) }
          setStepIndex(0)
          try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('modal-close')) } catch (err) {}
        }
      } catch (err) {
        console.error('Error handling Joyride close click', err)
      }
    }
    document.addEventListener('click', onDocClick, true)
    return () => document.removeEventListener('click', onDocClick, true)
  }, [run, onClose])

  return (
    <>
      <Joyride
        steps={steps}
        run={run}
        continuous
        showProgress
        showSkipButton
        stepIndex={stepIndex}
        callback={handleJoyrideCallback}
        styles={{
          options: {
            primaryColor: '#0d9488',
            textColor: '#1f2937',
            backgroundColor: '#fff',
            arrowColor: '#fff',
            overlayColor: 'rgba(0, 0, 0, 0.6)',
            zIndex: 10000,
          },
          tooltip: {
            borderRadius: 20,
            padding: 40,
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            width: 600,
            height: 450,
          },
          tooltipContainer: {
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            height: '80%',
          },
          tooltipContent: {
            padding: '10px 0',
            fontSize: 18,
            lineHeight: 1.7,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          },
          buttonNext: {
            backgroundColor: '#0d9488',
            borderRadius: 14,
            padding: '16px 32px',
            fontSize: 18,
            fontWeight: 700,
            boxShadow: '0 4px 6px -1px rgba(13, 148, 136, 0.3)',
            transition: 'all 0.2s',
          },
          buttonBack: {
            color: '#0d9488',
            marginRight: 12,
            borderRadius: 14,
            padding: '16px 32px',
            fontSize: 18,
            fontWeight: 600,
            border: '2px solid #0d9488',
            backgroundColor: 'transparent',
          },
          buttonSkip: {
            color: '#6b7280',
            fontSize: 16,
            fontWeight: 500,
          },
          buttonClose: {
            color: '#6b7280',
            width: 36,
            height: 36,
          },
          spotlight: {
            borderRadius: 12,
          },
        }}
        locale={{
          back: t('buttons.back'),
          close: t('buttons.close'),
          last: t('buttons.last'),
          next: t('buttons.next'),
          nextLabelWithProgress: t('buttons.nextLabelWithProgress'),
          skip: t('buttons.skip'),
        }}
      />

      {/* Always-available close button (in case Joyride's close is not actionable) */}
      {run && (
        <button
          aria-label="Fechar Tutorial"
          title="Fechar Tutorial"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            try { onClose && onClose() } catch (err) { console.error(err) }
            setStepIndex(0)
            try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('modal-close')) } catch (err) {}
          }}
          className="fixed top-4 right-4 z-[11000] pointer-events-auto inline-flex items-center justify-center w-10 h-10 bg-white rounded-full shadow-md hover:bg-neutral-100 focus:outline-none"
        >
          <X className="w-4 h-4 text-neutral-700" />
        </button>
      )}
    </>
  )
}

import React, { useState, useEffect } from 'react'
import { Settings, Lock, Wallet, Gift, WashingMachine } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import api from '@/services/api'
import { useKioskLock } from '@/context/KioskLockContext'
import KioskDayCloseModal from '@/components/KioskDayCloseModal'
import GiftCardForm from '@/components/GiftCardForm'
import StaffMachinesModal from '@/components/StaffMachinesModal'

function getKioskApiKey() {
  const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
  return electronKey || (typeof localStorage !== 'undefined' ? localStorage.getItem('kiosk_api_key') : null) || import.meta.env.VITE_KIOSK_API_KEY
}

// No touch for this long with the staff area open = it closes and the PIN has to be typed again.
const STAFF_IDLE_MS = 60_000

/**
 * Discreet, always-present entry point to staff-only kiosk actions: closing
 * the cash session, and freezing the screen for physical maintenance.
 *
 * Deliberately small and low-contrast — a customer has no reason to tap it,
 * and everything behind it is gated by the staff PIN regardless.
 */
export default function StaffMenu() {
  const { lockFeatureEnabled, lock } = useKioskLock()
  const [showPinPrompt, setShowPinPrompt] = useState(false)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(null)
  const [checking, setChecking] = useState(false)
  const [verifiedPin, setVerifiedPin] = useState(null) // held only long enough to submit the close it authorised
  const [showChooser, setShowChooser] = useState(false)
  const [showDayClose, setShowDayClose] = useState(false)
  const [showGift, setShowGift] = useState(false)
  const [showMachines, setShowMachines] = useState(false)
  const [giftBusy, setGiftBusy] = useState(false)
  const [giftResult, setGiftResult] = useState(null) // { ok, text }

  async function issueGift(payload) {
    setGiftBusy(true)
    setGiftResult(null)
    try {
      const r = await api.giftKioskCard({ ...payload, pin: verifiedPin }, { apiKey: getKioskApiKey() })
      setGiftResult({ ok: true, text: r?.message || 'Cartão libertado. Coloque-o no leitor para o ativar.' })
    } catch (e) {
      setGiftResult({ ok: false, text: e?.body?.error || e?.message || 'Não foi possível emitir o cartão.' })
    } finally { setGiftBusy(false) }
  }

  async function verifyPin() {
    setChecking(true)
    setPinError(null)
    try {
      await api.verifyAdminPin(pin, { apiKey: getKioskApiKey() })
      setVerifiedPin(pin)
      setShowPinPrompt(false)
      setShowChooser(true)
      setPin('')
    } catch (e) {
      setPinError(e?.status === 409 ? 'Nenhum PIN configurado para este local.' : e?.status === 429 ? 'Demasiadas tentativas. Aguarde.' : 'PIN inválido')
      setPin('')
    } finally {
      setChecking(false)
    }
  }

  // Staff left the kiosk with the staff area open: after a minute with no touch it closes by itself and the PIN is
  // forgotten, so the next person who walks up needs the PIN again.
  const staffOpen = showPinPrompt || showChooser || showGift || showDayClose || showMachines
  useEffect(() => {
    if (!staffOpen) return undefined
    let timer
    const leave = () => {
      setShowPinPrompt(false); setShowChooser(false); setShowGift(false); setShowDayClose(false); setShowMachines(false)
      setPin(''); setPinError(null); setVerifiedPin(null); setGiftResult(null)
    }
    const arm = () => { clearTimeout(timer); timer = setTimeout(leave, STAFF_IDLE_MS) }
    arm()
    const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel']
    events.forEach((e) => window.addEventListener(e, arm, true))
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, arm, true)) }
  }, [staffOpen])

  // Tell the header whether staff mode (PIN accepted) is on, so it can show an Admin badge.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('kiosk:staff-mode', { detail: { active: Boolean(verifiedPin) } }))
    return () => { window.dispatchEvent(new CustomEvent('kiosk:staff-mode', { detail: { active: false } })) }
  }, [verifiedPin])

  function closeAll() {
    setVerifiedPin(null)
    setShowPinPrompt(false)
    setShowChooser(false)
    setPin('')
    setPinError(null)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setPinError(null); setShowPinPrompt(true) }}
        aria-label="Staff"
        className="fixed bottom-2 left-2 z-30 w-8 h-8 rounded-full bg-black/5 hover:bg-black/15 text-neutral-400 hover:text-neutral-700 flex items-center justify-center transition-colors"
      >
        <Settings className="w-4 h-4" aria-hidden />
      </button>

      {showPinPrompt && (
        <Modal open={showPinPrompt} onClose={closeAll} title="Área de Staff">
          <div className="space-y-4">
            <p className="text-sm text-neutral-600">Introduza o PIN de staff para continuar.</p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && pin && !checking) verifyPin() }}
              placeholder="PIN"
              className="w-full px-4 py-3 rounded-lg border border-neutral-300 text-center text-2xl tracking-widest"
              autoFocus
            />
            {pinError && <div className="text-sm text-red-600 font-semibold">{pinError}</div>}
            <div className="flex gap-2">
              <button onClick={closeAll} className="flex-1 py-2 rounded-lg border">Cancelar</button>
              <button
                onClick={verifyPin}
                disabled={checking || !pin}
                className={`flex-1 py-2 rounded-lg ${checking || !pin ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}
              >
                {checking ? 'A verificar…' : 'Continuar'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showChooser && (
        <Modal open={showChooser} onClose={closeAll} title="Área de Staff">
          <div className="space-y-3">
            <button
              onClick={() => { setShowChooser(false); setShowDayClose(true) }}
              className="w-full flex items-center gap-3 rounded-xl border border-neutral-200 hover:border-teal-400 hover:bg-teal-50 px-4 py-4 text-left transition"
            >
              <Wallet className="w-6 h-6 text-teal-600 shrink-0" aria-hidden />
              <div>
                <div className="font-semibold text-neutral-800">Fechar Caixa</div>
                <div className="text-xs text-neutral-500">Contar dinheiro e reconciliar a sessão</div>
              </div>
            </button>

            <button
              onClick={() => { setShowChooser(false); setShowMachines(true) }}
              className="w-full flex items-center gap-3 rounded-xl border border-neutral-200 hover:border-teal-400 hover:bg-teal-50 px-4 py-4 text-left transition"
            >
              <WashingMachine className="w-6 h-6 text-teal-600 shrink-0" aria-hidden />
              <div>
                <div className="font-semibold text-neutral-800">Máquinas</div>
                <div className="text-xs text-neutral-500">Iniciar ou libertar uma máquina sem pagamento</div>
              </div>
            </button>

            <button
              onClick={() => { setShowChooser(false); setGiftResult(null); setShowGift(true) }}
              className="w-full flex items-center gap-3 rounded-xl border border-neutral-200 hover:border-teal-400 hover:bg-teal-50 px-4 py-4 text-left transition"
            >
              <Gift className="w-6 h-6 text-teal-600 shrink-0" aria-hidden />
              <div>
                <div className="font-semibold text-neutral-800">Cartão de oferta</div>
                <div className="text-xs text-neutral-500">Cartão grátis para um cliente (crédito 0 € por defeito)</div>
              </div>
            </button>

            {lockFeatureEnabled && (
              <button
                onClick={() => { lock('maintenance'); closeAll() }}
                className="w-full flex items-center gap-3 rounded-xl border border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50 px-4 py-4 text-left transition"
              >
                <Lock className="w-6 h-6 text-neutral-600 shrink-0" aria-hidden />
                <div>
                  <div className="font-semibold text-neutral-800">Bloquear Ecrã</div>
                  <div className="text-xs text-neutral-500">Congela o ecrã durante manutenção física</div>
                </div>
              </button>
            )}

            <button onClick={closeAll} className="w-full py-2 rounded-lg border mt-1">Cancelar</button>
          </div>
        </Modal>
      )}

      <StaffMachinesModal open={showMachines} pin={verifiedPin} onClose={() => { setShowMachines(false); setVerifiedPin(null) }} />

      {showGift && (
        <Modal open={showGift} onClose={() => { setShowGift(false); setVerifiedPin(null) }} title="Cartão de oferta">
          {giftResult?.ok ? (
            <div className="space-y-4 text-center">
              <div className="text-lg font-semibold text-teal-700">{giftResult.text}</div>
              <button onClick={() => { setShowGift(false); setVerifiedPin(null) }} className="w-full py-2 rounded-lg bg-teal-600 text-white">OK</button>
            </div>
          ) : (
            <>
              {giftResult && <div className="mb-3 text-sm text-red-600 font-semibold">{giftResult.text}</div>}
              <GiftCardForm busy={giftBusy} onSubmit={issueGift} onCancel={() => { setShowGift(false); setVerifiedPin(null) }} />
            </>
          )}
        </Modal>
      )}

      <KioskDayCloseModal
        open={showDayClose}
        pin={verifiedPin}
        onClose={() => { setShowDayClose(false); setVerifiedPin(null) }}
      />
    </>
  )
}

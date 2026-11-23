import React, { useState, useEffect } from 'react'
import { Settings, Lock, Wallet, Gift, WashingMachine, KeyRound } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import api from '@/services/api'
import { useKioskLock } from '@/context/KioskLockContext'
import { subscribe } from '@/services/websocket'
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
  const [buttonShown, setButtonShown] = useState(true) // setting kioskStaffButton: the watermark button that asks for the PIN
  useEffect(() => { api.getPublicSetting('kioskStaffButton').then((r) => setButtonShown(r?.value !== false)).catch(() => {}) }, [])
  const [pinVisible, setPinVisible] = useState(false) // setting kioskPinVisible: show the digits while they are typed
  useEffect(() => {
    api.getPublicSetting('kioskPinVisible').then((r) => setPinVisible(Boolean(r?.value))).catch(() => {})
  }, [showPinPrompt])
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(null)
  const [checking, setChecking] = useState(false)
  const [verifiedPin, setVerifiedPin] = useState(null) // held only long enough to submit the close it authorised
  const [showChooser, setShowChooser] = useState(false)
  const [showDayClose, setShowDayClose] = useState(false)
  const [showGift, setShowGift] = useState(false)
  const [showMachines, setShowMachines] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [keyText, setKeyText] = useState('')
  const [keyUrl, setKeyUrl] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyResult, setKeyResult] = useState(null) // { ok, text }
  const [keyStatus, setKeyStatus] = useState(null) // { pending, lastResult } — a key typed while offline waits in the shop's database
  useEffect(() => {
    if (!showKey) return
    api.centralKeyStatus({ apiKey: getKioskApiKey() }).then(setKeyStatus).catch(() => setKeyStatus(null))
  }, [showKey, keyResult])
  async function saveKey() {
    setKeyBusy(true); setKeyResult(null)
    try {
      const r = await api.setCentralKey({ pin: verifiedPin, key: keyText, ...(keyUrl.trim() ? { serverUrl: keyUrl.trim() } : {}) }, { apiKey: getKioskApiKey() })
      setKeyResult({ ok: true, text: r?.message || 'Chave guardada.' })
      setKeyText('')
    } catch (e) {
      const code = e?.body?.code
      setKeyResult({ ok: false, text: e?.body?.error || e?.message || 'Não foi possível guardar a chave.', needUrl: code === 'no-server' })
    } finally { setKeyBusy(false) }
  }
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkResult, setLinkResult] = useState(null) // { ok, text }
  async function resetLink() {
    setLinkBusy(true); setLinkResult(null)
    try {
      const r = await api.kioskResetControllerLink({ pin: verifiedPin }, { apiKey: getKioskApiKey() })
      setLinkResult(r?.success ? { ok: true, text: 'Nova ligação pedida. Daqui a uns segundos tente arrancar uma máquina. Se continuar sem arrancar, desligue a energia da caixa do controlador, espere 30 segundos e volte a ligar.' } : { ok: false, text: r?.reason || 'Sem ligação ao controlador.' })
    } catch (e) {
      setLinkResult({ ok: false, text: e?.body?.error || e?.message || 'Não foi possível pedir a nova ligação.' })
    } finally { setLinkBusy(false) }
  }
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
      setPinError(e?.status === 410 ? 'PIN expirado. Defina um PIN novo.' : e?.status === 409 ? 'Nenhum PIN configurado para este local.' : e?.status === 429 ? 'Demasiadas tentativas. Aguarde.' : 'PIN inválido')
      setPin('')
    } finally {
      setChecking(false)
    }
  }

  // A master card in the reader: the shop PC sends this screen a token that stands in for the PIN, and the staff area opens with no PIN.
  useEffect(() => subscribe((m) => {
    if (m?.type !== 'staff:card_unlock' || !m.payload?.token) return
    setVerifiedPin(`card:${m.payload.token}`)
    setShowPinPrompt(false); setPin(''); setPinError(null)
    setShowChooser(true)
  }), [])

  // Staff left the kiosk with the staff area open: after a minute with no touch it closes by itself and the PIN is
  // forgotten, so the next person who walks up needs the PIN again.
  const staffOpen = showPinPrompt || showChooser || showGift || showDayClose || showMachines || showKey
  useEffect(() => {
    if (!staffOpen) return undefined
    let timer
    const leave = () => {
      setShowPinPrompt(false); setShowChooser(false); setShowGift(false); setShowDayClose(false); setShowMachines(false); setShowKey(false); setKeyText(''); setKeyResult(null)
      setPin(''); setPinError(null); setVerifiedPin(null); setGiftResult(null); setLinkResult(null)
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
    setLinkResult(null)
    setShowPinPrompt(false)
    setShowChooser(false)
    setPin('')
    setPinError(null)
  }

  return (
    <>
      {buttonShown && <button
        type="button"
        onClick={() => { setPinError(null); setShowPinPrompt(true) }}
        aria-label="Staff"
        // A watermark: it is there for the staff, who know where it is, and nobody else notices it (no background, barely visible).
        className="fixed bottom-2 left-2 z-30 w-8 h-8 rounded-full bg-transparent text-neutral-500 opacity-[0.09] hover:opacity-60 active:opacity-70 flex items-center justify-center transition-opacity"
      >
        <Settings className="w-4 h-4" aria-hidden />
      </button>}

      {showPinPrompt && (
        <Modal open={showPinPrompt} onClose={closeAll} title="Área de Staff">
          <div className="space-y-4">
            <p className="text-sm text-neutral-600">Introduza o PIN de staff para continuar.</p>
            <input
              type={pinVisible ? 'text' : 'password'}
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

            <button
              onClick={() => { setShowChooser(false); setKeyResult(null); setKeyText(''); setShowKey(true) }}
              className="w-full flex items-center gap-3 rounded-xl border border-neutral-200 hover:border-teal-400 hover:bg-teal-50 px-4 py-4 text-left transition"
            >
              <KeyRound className="w-6 h-6 text-teal-600 shrink-0" aria-hidden />
              <div>
                <div className="font-semibold text-neutral-800">Chave do servidor</div>
                <div className="text-xs text-neutral-500">Introduzir a chave nova de ligação ao servidor</div>
              </div>
            </button>

            <button
              onClick={resetLink}
              disabled={linkBusy}
              className="w-full flex items-center gap-3 rounded-xl border border-neutral-200 hover:border-teal-400 hover:bg-teal-50 px-4 py-4 text-left transition disabled:opacity-60"
            >
              <WashingMachine className="w-6 h-6 text-teal-600 shrink-0" aria-hidden />
              <div>
                <div className="font-semibold text-neutral-800">{linkBusy ? 'A pedir…' : 'Ligação às máquinas'}</div>
                <div className="text-xs text-neutral-500">Se as máquinas não arrancam: pede uma nova ligação ao controlador</div>
              </div>
            </button>
            {linkResult && <div className={`text-sm ${linkResult.ok ? 'text-teal-700' : 'text-red-600'} font-semibold`}>{linkResult.text}</div>}

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

      {showKey && (
        <Modal open={showKey} onClose={() => { setShowKey(false); setVerifiedPin(null) }} title="Chave do servidor">
          <div className="space-y-4">
            {keyResult?.ok ? (
              <>
                <div className="text-lg font-semibold text-teal-700">{keyResult.text}</div>
                <button onClick={() => { setShowKey(false); setVerifiedPin(null) }} className="w-full py-2 rounded-lg bg-teal-600 text-white">OK</button>
              </>
            ) : (
              <>
                {keyStatus?.pending && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">Há uma chave nova à espera de ligação à internet: é ativada sozinha quando houver. Pode escrever outra para a substituir.</div>}
                {!keyStatus?.pending && keyStatus?.lastResult && <div className={`rounded-lg border text-sm px-3 py-2 ${keyStatus.lastResult.ok ? 'bg-teal-50 border-teal-200 text-teal-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{keyStatus.lastResult.message}</div>}
                <p className="text-sm text-neutral-600 m-0">Escreva a chave gerada no admin (24 caracteres; os traços são opcionais). É verificada no servidor antes de ser guardada.</p>
                <input
                  type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
                  value={keyText} onChange={(e) => setKeyText(e.target.value)}
                  placeholder="xxxx-xxxx-xxxx-xxxx-xxxx-xxxx"
                  className="w-full px-4 py-3 rounded-lg border border-neutral-300 text-center text-xl tracking-wider"
                />
                {keyResult?.needUrl && (
                  <input
                    type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
                    value={keyUrl} onChange={(e) => setKeyUrl(e.target.value)}
                    placeholder="Endereço do servidor (https://…/api)"
                    className="w-full px-4 py-3 rounded-lg border border-neutral-300 text-center"
                  />
                )}
                {keyResult && !keyResult.ok && <div className="text-sm text-red-600 font-semibold">{keyResult.text}</div>}
                <div className="flex gap-2">
                  <button onClick={() => { setShowKey(false); setVerifiedPin(null) }} disabled={keyBusy} className="flex-1 py-2 rounded-lg border">Cancelar</button>
                  <button onClick={saveKey} disabled={keyBusy || !keyText.trim()} className={`flex-1 py-2 rounded-lg ${keyBusy || !keyText.trim() ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-600 text-white'}`}>{keyBusy ? 'A verificar…' : 'Guardar'}</button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

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

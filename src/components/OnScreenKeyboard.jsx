import React from 'react'

/**
 * On-screen keyboard for the shop kiosk.
 *
 * Windows' own touch keyboard does not open inside Edge's kiosk mode when a hardware input device is
 * attached, so the app brings its own. It opens when a text field gets focus and types into it as
 * if a real keyboard did (works with React-controlled inputs). Only active on the shop PC
 * (localhost): on any other machine the real keyboard is used.
 */
const ROWS_ALPHA = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ç'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '-', '_', '.'],
]
const ROWS_SYMBOLS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['@', '#', '€', '%', '&', '*', '+', '=', '/', ':'],
  ['(', ')', '!', '?', ',', ';', '"', "'", '~', '\\'],
]
const ROWS_NUMERIC = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '-'],
]

const TEXT_TYPES = new Set(['text', 'password', 'email', 'search', 'tel', 'url', 'number', ''])

function isEditable(el) {
  if (!el || el.disabled || el.readOnly) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName !== 'INPUT') return false
  return TEXT_TYPES.has((el.getAttribute('type') || 'text').toLowerCase())
}

function wantsNumeric(el) {
  const type = (el.getAttribute('type') || '').toLowerCase()
  const mode = (el.getAttribute('inputmode') || '').toLowerCase()
  return type === 'number' || type === 'tel' || mode === 'numeric' || mode === 'decimal' || mode === 'tel'
}

function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export default function OnScreenKeyboard() {
  const enabled = typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  const [target, setTarget] = React.useState(null)
  const [symbols, setSymbols] = React.useState(false)
  const [shift, setShift] = React.useState(false)
  const [dismissed, setDismissed] = React.useState(null)
  const targetRef = React.useRef(null)
  targetRef.current = target

  React.useEffect(() => {
    if (!enabled) return undefined
    const onFocusIn = (e) => {
      if (isEditable(e.target)) {
        setTarget(e.target)
        setDismissed(null)
        setSymbols(false)
        setShift(false)
        setTimeout(() => { try { e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* cosmetic */ } }, 80)
      }
    }
    const onFocusOut = () => {
      // Focus moving between two fields passes through body: decide after the browser settles.
      setTimeout(() => {
        const a = document.activeElement
        if (!isEditable(a)) setTarget(null)
      }, 120)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [enabled])

  // Leave room under the keyboard so the field is never covered.
  const visible = enabled && target && dismissed !== target
  React.useEffect(() => {
    if (!visible) return undefined
    const prev = document.body.style.paddingBottom
    document.body.style.paddingBottom = '360px'
    return () => { document.body.style.paddingBottom = prev }
  }, [visible])

  if (!visible) return null

  function press(key) {
    const el = targetRef.current
    if (!el) return
    el.focus()
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const maxLength = Number(el.getAttribute('maxlength')) || Infinity
    if (key === 'BACKSPACE') {
      if (start === end && start > 0) {
        setNativeValue(el, el.value.slice(0, start - 1) + el.value.slice(end))
        el.setSelectionRange?.(start - 1, start - 1)
      } else if (start !== end) {
        setNativeValue(el, el.value.slice(0, start) + el.value.slice(end))
        el.setSelectionRange?.(start, start)
      }
      return
    }
    if (key === 'ENTER') {
      if (el.tagName === 'TEXTAREA') key = '\n'
      else {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
        el.form?.requestSubmit?.()
        setDismissed(el)
        return
      }
    }
    if (el.value.length - (end - start) + key.length > maxLength) return
    const ch = shift && key.length === 1 ? key.toUpperCase() : key
    setNativeValue(el, el.value.slice(0, start) + ch + el.value.slice(end))
    const pos = start + ch.length
    el.setSelectionRange?.(pos, pos)
    if (shift) setShift(false)
  }

  const numeric = wantsNumeric(target)
  const rows = numeric ? ROWS_NUMERIC : symbols ? ROWS_SYMBOLS : ROWS_ALPHA
  const keyBase = 'select-none rounded-xl bg-white text-neutral-800 font-semibold shadow active:scale-95 active:bg-teal-100 flex items-center justify-center'

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[100] bg-neutral-200 border-t-2 border-neutral-300 p-3 shadow-2xl"
      // Keys must not steal the focus from the field being typed into.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      role="application"
      aria-label="Teclado"
    >
      <div className={`mx-auto flex flex-col gap-2 ${numeric ? 'max-w-md' : 'max-w-4xl'}`}>
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-2 justify-center">
            {row.map((k) => (
              <button key={k} type="button" className={`${keyBase} h-16 flex-1 text-3xl`} onClick={() => press(k)}>
                {shift && !symbols && k.length === 1 ? k.toUpperCase() : k}
              </button>
            ))}
          </div>
        ))}
        <div className="flex gap-2 justify-center">
          {!numeric && (
            <>
              <button type="button" className={`${keyBase} h-16 w-24 text-2xl ${shift ? 'bg-teal-600 text-white' : ''}`} onClick={() => setShift((s) => !s)}>⇧</button>
              <button type="button" className={`${keyBase} h-16 w-28 text-2xl`} onClick={() => setSymbols((s) => !s)}>{symbols ? 'ABC' : '123'}</button>
              <button type="button" className={`${keyBase} h-16 flex-1 text-2xl`} onClick={() => press(' ')}>espaço</button>
            </>
          )}
          <button type="button" className={`${keyBase} h-16 w-24 text-3xl`} onClick={() => press('BACKSPACE')} aria-label="Apagar">⌫</button>
          <button type="button" className={`${keyBase} h-16 w-28 text-2xl bg-teal-600 text-white`} onClick={() => press('ENTER')}>OK</button>
          <button type="button" className={`${keyBase} h-16 w-20 text-2xl`} onClick={() => setDismissed(target)} aria-label="Fechar teclado">✕</button>
        </div>
      </div>
    </div>
  )
}

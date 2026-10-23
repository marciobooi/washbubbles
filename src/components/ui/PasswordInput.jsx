import React, { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Password field with an eye button to show what was typed.
 *
 * It is deliberately UNCONTROLLED: a React-controlled <input> copies its current text into the element's `value`
 * attribute, so the password showed up as value="..." in the browser's Elements panel. Here the text lives only in the
 * input itself (the `value` attribute stays empty) and reaches the parent through `onChange`. `value` is only watched for
 * one thing: when the parent sets it back to '' (after a successful save) the field is cleared.
 *
 * (Whoever can open the browser's developer tools on this page can still read what is in the field; that cannot be
 * prevented in a web page. The server never sends a password back.)
 *
 * `rawClassName` renders a plain <input> with exactly that class instead of the shared <Input> look.
 */
export default function PasswordInput({ value, onChange, className, rawClassName, id, ...props }) {
  const [show, setShow] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (value === '' && ref.current && ref.current.value !== '') ref.current.value = ''
  }, [value])

  const common = { id, ref, type: show ? 'text' : 'password', defaultValue: '', onChange, autoCapitalize: 'none', spellCheck: false, ...props }
  return (
    <div className="relative">
      {rawClassName
        ? <input {...common} className={cn(rawClassName, 'pr-11')} />
        : <Input {...common} className={cn('pr-11', className)} />}
      <button
        type="button"
        tabIndex={-1}
        aria-label={show ? 'Esconder palavra-passe' : 'Mostrar palavra-passe'}
        aria-pressed={show}
        // Keep the caret in the field: the button must not take the focus.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:text-neutral-800 hover:bg-black/5"
      >
        {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  )
}

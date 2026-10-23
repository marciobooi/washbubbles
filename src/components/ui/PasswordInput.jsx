import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Password field with an eye button to show what was typed.
 *
 * A normal controlled field (value + onChange), exactly like the plain inputs it replaces. (An uncontrolled variant that
 * kept the text out of the element's `value` attribute was tried and reverted: the login stopped accepting passwords for
 * some browsers / password managers. The attribute is only visible in the developer tools of the person's own browser.)
 *
 * `rawClassName` renders a plain <input> with exactly that class instead of the shared <Input> look.
 */
export default function PasswordInput({ className, rawClassName, ...props }) {
  const [show, setShow] = useState(false)
  const common = { type: show ? 'text' : 'password', autoCapitalize: 'none', spellCheck: false, ...props }
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

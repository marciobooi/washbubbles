import React from 'react'

export function Label({ children, className = '', ...props }) {
  return (
    <label className={`block mb-1 text-sm font-semibold text-slate-600 ${className}`} {...props}>
      {children}
    </label>
  )
}

export default Label

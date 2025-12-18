import React from 'react'

// Highlight matched ranges in text
export default function Highlight({ text, matches = [] }) {
  if (!matches || matches.length === 0) return <>{text}</>

  // matches = array of [start, end]
  const parts = []
  let last = 0
  matches.forEach(([s, e], idx) => {
    if (s > last) parts.push({ text: text.slice(last, s), mark: false, key: `${idx}-pre` })
    parts.push({ text: text.slice(s, e + 1), mark: true, key: `${idx}-mark` })
    last = e + 1
  })
  if (last < text.length) parts.push({ text: text.slice(last), mark: false, key: 'last' })

  return <>{parts.map((p) => p.mark ? <mark key={p.key} className="bg-yellow-200 rounded px-0.5">{p.text}</mark> : <span key={p.key}>{p.text}</span>)}</>
}
import React from 'react'

export function VersionSwitcher({ versions = [], defaultVersion }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <select defaultValue={defaultVersion} className="rounded-md border p-1">
        {versions.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    </div>
  )
}

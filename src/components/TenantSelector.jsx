import React from 'react'
import { useTenant } from '../context/TenantContext'

export default function TenantSelector({ className }) {
  const { tenantId, tenants, selectTenant, loading } = useTenant()

  if (loading) return <div className={className}>Loading tenants…</div>

  return (
    <div className={className}>
      <select value={tenantId || ''} onChange={(e) => selectTenant(e.target.value || null)} className="rounded border px-2 py-1">
        <option value="">Default</option>
        {tenants.map(t => (
          <option key={t._id} value={t._id}>{t.name}</option>
        ))}
      </select>
    </div>
  )
}

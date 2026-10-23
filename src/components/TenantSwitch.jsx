import React from 'react'
import { Store } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTenant } from '../context/TenantContext'

/**
 * Which shop is the admin showing?
 *  - everybody sees the name of THEIR shop in the top bar;
 *  - a SUPERADMIN can pick another shop and act as it (the server checks the role and writes it to the audit trail): the page
 *    reloads so every screen shows that shop's data, and an amber strip keeps saying whose data this is.
 */
export default function TenantSwitch() {
  const { role, tenant: home } = useAuth()
  const { tenantId, tenants, selectTenant } = useTenant()
  const isSuper = role === 'SUPERADMIN'
  if (!isSuper) return home?.name ? <span className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-[#3a352c]"><Store className="h-4 w-4" aria-hidden />{home.name}</span> : null
  const current = tenantId || home?.id || ''
  return (
    <label className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-[#3a352c]" title="Loja que está a ver">
      <Store className="h-4 w-4" aria-hidden />
      <select
        aria-label="Loja"
        value={current}
        onChange={(e) => { if (e.target.value === '__all') { window.location.assign('/admin/tenants'); return } selectTenant(e.target.value === (home?.id || '') ? null : e.target.value || null); window.location.reload() }}
        className="rounded-full border border-black/[0.12] bg-transparent px-3 h-9 text-sm font-semibold"
      >
        {home?.id && !tenants.some((t) => t._id === home.id) && <option value={home.id}>{home.name}</option>}
        {tenants.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
        <option value="__all">Todas as lojas…</option>
      </select>
    </label>
  )
}

/** Amber strip shown while a superadmin is acting as a shop that is not their own. */
export function ActingAsStrip() {
  const { role, tenant: home } = useAuth()
  const { tenantId, tenants, selectTenant } = useTenant()
  if (role !== 'SUPERADMIN' || !tenantId || tenantId === home?.id) return null
  const shop = tenants.find((t) => t._id === tenantId)
  return (
    <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
      <span>A ver a loja <strong>{shop?.name || 'selecionada'}</strong>: tudo o que fizer aplica-se a esta loja e fica na auditoria.</span>
      <button type="button" className="abtn abtn-sm" onClick={() => { selectTenant(null); window.location.reload() }}>Voltar à minha loja</button>
    </div>
  )
}

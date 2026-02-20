import React, { createContext, useContext, useEffect, useState } from 'react'
import api from '../services/api'

const TenantContext = createContext()

export function TenantProvider({ children }) {
  const [tenantId, setTenantId] = useState(() => localStorage.getItem('ws_tenant') || null)
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (tenantId) localStorage.setItem('ws_tenant', tenantId)
    else localStorage.removeItem('ws_tenant')
  }, [tenantId])

  async function refreshTenants() {
    setLoading(true)
    try {
      const list = await api.getTenants()
      setTenants(Array.isArray(list) ? list : [])
    } catch (e) {
      console.debug('Failed to load tenants', e)
    } finally { setLoading(false) }
  }

  useEffect(() => { refreshTenants() }, [])

  const selectTenant = (id) => setTenantId(id || null)

  const createTenant = async (payload) => {
    const t = await api.createTenant(payload)
    await refreshTenants()
    return t
  }

  const updateTenant = async (id, payload) => {
    const t = await api.updateTenant(id, payload)
    await refreshTenants()
    return t
  }

  const assignUser = async (tenantIdArg, userId, role) => {
    return api.assignTenantUser(tenantIdArg, userId, role)
  }

  return (
    <TenantContext.Provider value={{ tenantId, tenants, loading, selectTenant, refreshTenants, createTenant, updateTenant, assignUser }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() { return useContext(TenantContext) }

export default TenantContext

import React, { createContext, useContext, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../services/api'
import { useAuth } from './AuthContext'

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

  // GET /admin/tenants is SUPERADMIN-only. TenantProvider wraps the whole
  // app (kiosk POS included), so an unconditional fetch here 401'd on every
  // single kiosk page load — an unauthenticated request that could never
  // succeed there. Only admin routes have any use for the tenant list.
  // Keyed on the route (not just mount) so it still fires correctly if the
  // app navigates from /pos to /admin without a full page reload.
  const { pathname } = useLocation()
  const isAdminRoute = pathname.startsWith('/admin')
  // ...and only once someone is logged in: on the login page there is no token, and the call only answered 401 (red in the console).
  // The list of shops is a superadmin thing (GET /admin/tenants answers 403 to everybody else).
  const { token, role } = useAuth()
  useEffect(() => {
    if (isAdminRoute && token && role === 'SUPERADMIN') refreshTenants()
  }, [isAdminRoute, token, role])
  // login / logout start again from the user's own shop
  useEffect(() => {
    const reset = () => setTenantId(null)
    window.addEventListener('ws:tenant-reset', reset)
    return () => window.removeEventListener('ws:tenant-reset', reset)
  }, [])

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

import React, { createContext, useContext, useEffect, useState } from 'react'
import api from '@/services/api'

const BrandingContext = createContext()
export const useBranding = () => useContext(BrandingContext)

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState({ companyName: null, logo: null, primaryColor: null, accentColor: null })

  useEffect(() => {
    async function load() {
      try {
        // Use public settings endpoint for branding (safe to expose)
        const name = await api.getPublicSetting('branding.companyName').catch(() => null)
        const logo = await api.getPublicSetting('branding.logo').catch(() => null)
        const primary = await api.getPublicSetting('branding.primaryColor').catch(() => null)
        const accent = await api.getPublicSetting('branding.accentColor').catch(() => null)
        const companyName = name && name.value ? String(name.value) : null
        const logoUrl = logo && logo.value ? String(logo.value) : null
        const primaryColor = primary && primary.value ? String(primary.value) : null
        const accentColor = accent && accent.value ? String(accent.value) : null
        setBranding({ companyName, logo: logoUrl, primaryColor, accentColor })
        if (primaryColor) try { document.documentElement.style.setProperty('--branding-primary', primaryColor) } catch { /* a CSS custom property that will not apply is cosmetic */ }
        if (accentColor) try { document.documentElement.style.setProperty('--branding-accent', accentColor) } catch { /* a CSS custom property that will not apply is cosmetic */ }
        if (companyName) try { document.title = companyName } catch { /* document.title is cosmetic; a sandboxed frame can refuse it */ }
        // Notify others about loaded branding
        try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { company: companyName, logo: logoUrl, primaryColor, accentColor } })) } catch { /* document.title is cosmetic; a sandboxed frame can refuse it */ }
      } catch (e) {
        console.debug('branding load failed', e)
      }
    }

    load()

    const onBrand = (e) => {
      const d = e && e.detail ? e.detail : {}
      setBranding((b) => ({ ...b, ...d }))
      if (d.primaryColor) try { document.documentElement.style.setProperty('--branding-primary', d.primaryColor) } catch { /* a CSS custom property that will not apply is cosmetic */ }
      if (d.accentColor) try { document.documentElement.style.setProperty('--branding-accent', d.accentColor) } catch { /* a CSS custom property that will not apply is cosmetic */ }
      if (d.company) try { document.title = d.company } catch { /* document.title is cosmetic; a sandboxed frame can refuse it */ }
    }
    window.addEventListener('branding:update', onBrand)
    return () => window.removeEventListener('branding:update', onBrand)
  }, [])

  async function updateSetting(key, value) {
    await api.setSetting({ key, value })
    const detail = {}
    if (key === 'branding.companyName') detail.company = value
    if (key === 'branding.logo') detail.logo = value
    if (key === 'branding.primaryColor') detail.primaryColor = value
    if (key === 'branding.accentColor') detail.accentColor = value
    try { window.dispatchEvent(new CustomEvent('branding:update', { detail })) } catch { /* a listener that throws must not break the caller */ }
  }

  return (
    <BrandingContext.Provider value={{ branding, setBranding, updateSetting }}>
      {children}
    </BrandingContext.Provider>
  )
}

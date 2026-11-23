import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function BrandingTab() {
  const [companyName, setCompanyName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  // True only when the admin deliberately empties the logo (Clear button, or deleting the text). Without this,
  // pressing Save while the box is blank only because the form had not reloaded yet wiped the saved logo.
  const [logoCleared, setLogoCleared] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [primaryColor, setPrimaryColor] = useState('')
  const [accentColor, setAccentColor] = useState('')

  async function loadBranding() {
    try {
      const name = await api.getSetting('branding.companyName').catch(() => null)
      const logo = await api.getSetting('branding.logo').catch(() => null)
      const primary = await api.getSetting('branding.primaryColor').catch(() => null)
      const accent = await api.getSetting('branding.accentColor').catch(() => null)
      setCompanyName(name && name.value ? String(name.value) : '')
      setLogoUrl(logo && logo.value ? String(logo.value) : '')
      setPrimaryColor(primary && primary.value ? String(primary.value) : '')
      setAccentColor(accent && accent.value ? String(accent.value) : '')
    } catch (e) { console.warn('loadBranding failed', e) }
  }

  useEffect(() => { loadBranding() }, [])

  // Live preview: dispatch branding:update when fields change so the app updates immediately
  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('branding:update', { detail: { company: companyName || null, logo: logoUrl || null, primaryColor: primaryColor || null, accentColor: accentColor || null } }))
    } catch { /* a listener that throws must not break the caller */ }
  }, [companyName, logoUrl, primaryColor, accentColor])

  async function uploadLogo(file) {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('logo', file)
      const resp = await api.request('/admin/settings/logo', { method: 'POST', body: fd, expect: 'json' })
      const url = resp && resp.url ? String(resp.url) : (resp && resp.setting && resp.setting.value ? String(resp.setting.value) : '')
      if (url) {
        setLogoUrl(url)
        setLogoCleared(false)
        toast({ title: 'Logo uploaded', variant: 'success' })
        try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { logo: url } })) } catch { /* a listener that throws must not break the caller */ }
      } else {
        toast({ title: 'Upload failed', variant: 'destructive' })
      }
    } catch (e) {
      console.error(e)
      toast({ title: 'Upload failed', variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  async function saveBranding(e) {
    e.preventDefault()
    try {
      await api.setSetting({ key: 'branding.companyName', value: companyName })
      // Never overwrite a saved logo with nothing unless the admin cleared it on purpose.
      if (logoUrl || logoCleared) await api.setSetting({ key: 'branding.logo', value: logoUrl })
      setLogoCleared(false)
      await api.setSetting({ key: 'branding.primaryColor', value: primaryColor || null })
      await api.setSetting({ key: 'branding.accentColor', value: accentColor || null })
      toast({ title: 'Branding updated', variant: 'success' })
      loadBranding()
      try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { company: companyName, logo: logoUrl, primaryColor, accentColor } })) } catch { /* a listener that throws must not break the caller */ }
    } catch (e) {
      console.error(e)
      toast({ title: 'Failed to update branding', variant: 'destructive' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>Customize your company branding and appearance</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={saveBranding} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name</Label>
              <Input
                id="companyName"
                placeholder="Your Company Name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="logoUrl">Logo URL</Label>
              <Input
                id="logoUrl"
                placeholder="/logo.png or https://..."
                value={logoUrl}
                onChange={(e) => { setLogoUrl(e.target.value); setLogoCleared(e.target.value === '') }}
              />
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="file"
                  accept="image/*"
                  className="text-sm"
                  onChange={(e) => uploadLogo(e.target.files && e.target.files[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLogoUrl('');
                    setLogoCleared(true);
                    toast({ title: 'Logo cleared (press Save to apply)', variant: 'success' });
                    try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { logo: null } })) } catch { /* a listener that throws must not break the caller */ }
                  }}
                  disabled={uploading}
                >
                  Clear
                </Button>
              </div>
              {uploading && <p className="text-xs text-muted-foreground">Uploading…</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="primaryColor">Primary Color</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  className="w-12 h-10 p-1 border rounded cursor-pointer"
                  value={primaryColor || '#2563eb'}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                />
                <Input
                  id="primaryColor"
                  placeholder="#2563eb"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="accentColor">Accent Color</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  className="w-12 h-10 p-1 border rounded cursor-pointer"
                  value={accentColor || '#f97316'}
                  onChange={(e) => setAccentColor(e.target.value)}
                />
                <Input
                  id="accentColor"
                  placeholder="#f97316"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                />
              </div>
            </div>
          </div>

          {(logoUrl || primaryColor || accentColor) && (
            <div className="border-t pt-4">
              <Label className="mb-2 block">Preview</Label>
              <div className="flex items-center gap-6">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo preview" className="h-16 object-contain" />
                ) : (
                  <div className="h-16 w-32 bg-muted flex items-center justify-center text-xs text-muted-foreground">
                    No logo
                  </div>
                )}
                <div className="flex gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Primary</p>
                    <div
                      className="h-10 w-24 rounded border"
                      style={{ background: primaryColor || '#2563eb' }}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Accent</p>
                    <div
                      className="h-10 w-24 rounded border"
                      style={{ background: accentColor || '#f97316' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="submit">Save Branding</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                loadBranding();
                toast({ title: 'Reverted', variant: 'success' })
              }}
            >
              Revert
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

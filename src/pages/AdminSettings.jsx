import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'

export default function AdminSettings(){
  const [list, setList] = useState([])
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')

  // Branding helper state
  const [companyName, setCompanyName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
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

  async function load() {
    try {
      const data = await api.getSettings()
      setList(data)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar definições', variant: 'destructive' })
    }
  }

  useEffect(() => { load(); loadBranding() }, [])

  // Live preview: dispatch branding:update when fields change so app updates immediately
  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('branding:update', { detail: { company: companyName || null, logo: logoUrl || null, primaryColor: primaryColor || null, accentColor: accentColor || null } }))
    } catch (e) {}
  }, [companyName, logoUrl, primaryColor, accentColor])

  async function save(e) {
    e.preventDefault()
    try {
      await api.setSetting({ key, value })
      toast({ title: 'Definição salva', variant: 'success' })
      setKey('')
      setValue('')
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro', variant: 'destructive' })
    }
  }

  async function remove(k) {
    if (!confirm('Remover definição?')) return
    try {
      await api.deleteSetting(k)
      toast({ title: 'Definição removida', variant: 'success' })
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro', variant: 'destructive' })
    }
  }

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
        toast({ title: 'Logo uploaded', variant: 'success' })
        try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { logo: url } })) } catch (e) {}
      } else {
        toast({ title: 'Upload failed', variant: 'destructive' })
      }
      load()
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
      await api.setSetting({ key: 'branding.logo', value: logoUrl })
      await api.setSetting({ key: 'branding.primaryColor', value: primaryColor || null })
      await api.setSetting({ key: 'branding.accentColor', value: accentColor || null })
      toast({ title: 'Branding updated', variant: 'success' })
      load()
      loadBranding()
      try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { company: companyName, logo: logoUrl, primaryColor, accentColor } })) } catch (e) {}
    } catch (e) {
      console.error(e)
      toast({ title: 'Failed to update branding', variant: 'destructive' })
    }
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Definições</h2>

      {/* Branding */}
      <div className="bg-white rounded shadow p-4 mb-4">
        <h3 className="font-semibold mb-2">Branding</h3>
        <form onSubmit={saveBranding} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Company name</label>
            <input className="border p-2 rounded w-full" placeholder="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs text-neutral-500 mb-1">Logo URL</label>
            <input className="border p-2 rounded w-full" placeholder="/logo.png or https://..." value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
            <div className="mt-2 flex items-center gap-2">
              <input type="file" accept="image/*" onChange={(e) => uploadLogo(e.target.files && e.target.files[0])} />
              <button type="button" className="btn" onClick={() => { setLogoUrl(''); toast({ title: 'Logo cleared', variant: 'success' }); try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { logo: null } })) } catch (e) {} }} disabled={uploading}>Clear</button>
            </div>
            {uploading && <div className="text-xs text-neutral-500 mt-1">Uploading…</div>}
          </div>

          <div>
            <label className="block text-xs text-neutral-500 mb-1">Primary color</label>
            <div className="flex gap-2 items-center">
              <input type="color" className="w-10 h-10 p-0 border rounded" value={primaryColor || '#2563eb'} onChange={(e) => setPrimaryColor(e.target.value)} />
              <input className="border p-2 rounded w-full" placeholder="#2563eb" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
            </div>
            <label className="block text-xs text-neutral-500 mb-1 mt-2">Accent color</label>
            <div className="flex gap-2 items-center">
              <input type="color" className="w-10 h-10 p-0 border rounded" value={accentColor || '#f97316'} onChange={(e) => setAccentColor(e.target.value)} />
              <input className="border p-2 rounded w-full" placeholder="#f97316" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
            </div>
          </div>

          <div className="md:col-auto">
            <label className="block text-xs text-neutral-500 mb-1 opacity-0">Save</label>
            <div className="flex gap-2">
              <button className="btn btn-primary" type="submit">Save Branding</button>
              <button type="button" className="btn" onClick={() => { loadBranding(); toast({ title: 'Reverted', variant: 'success' }) }}>Revert</button>
            </div>
          </div>

          {(logoUrl || primaryColor || accentColor) && (
            <div className="md:col-span-4 mt-2">
              <div className="text-xs text-neutral-500 mb-1">Preview</div>
              <div className="flex items-center gap-4">
                {logoUrl ? <img src={logoUrl} alt="Logo preview" className="h-12 object-contain" /> : <div className="h-12 w-32 bg-neutral-100 flex items-center justify-center">No logo</div>}
                <div>
                  <div className="text-xs text-neutral-500 mb-1">Primary</div>
                  <div className="h-8 w-32 rounded" style={{ background: primaryColor || 'var(--branding-primary, #2563eb)' }}></div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500 mb-1">Accent</div>
                  <div className="h-8 w-32 rounded" style={{ background: accentColor || 'var(--branding-accent, #f97316)' }}></div>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>

      <div className="bg-white rounded shadow p-4 mb-4">
        <form onSubmit={save} className="flex gap-2">
          <input className="border p-2 rounded" placeholder="Key" value={key} onChange={(e) => setKey(e.target.value)} />
          <input className="border p-2 rounded flex-1" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
          <button className="btn btn-primary" type="submit">Save</button>
        </form>
      </div>

      <div className="bg-white rounded shadow p-4">
        <ul>
          {list.map((s) => (
            <li key={s._id} className="py-2 flex justify-between items-center border-b">
              <div>
                <div className="font-semibold">{s.key}</div>
                <div className="text-xs text-muted-foreground">{JSON.stringify(s.value)}</div>
              </div>
              <div>
                <button className="btn btn-destructive" onClick={() => remove(s.key)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
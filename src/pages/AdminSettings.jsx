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

  async function loadBranding() {
    try {
      const name = await api.getSetting('branding.companyName').catch(() => null)
      const logo = await api.getSetting('branding.logo').catch(() => null)
      setCompanyName(name && name.value ? String(name.value) : '')
      setLogoUrl(logo && logo.value ? String(logo.value) : '')
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

  async function saveBranding(e) {
    e.preventDefault()
    try {
      await api.setSetting({ key: 'branding.companyName', value: companyName })
      await api.setSetting({ key: 'branding.logo', value: logoUrl })
      toast({ title: 'Branding updated', variant: 'success' })
      load()
      loadBranding()
      try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { company: companyName, logo: logoUrl } })) } catch (e) {}
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
        <form onSubmit={saveBranding} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Company name</label>
            <input className="border p-2 rounded w-full" placeholder="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Logo URL</label>
            <input className="border p-2 rounded w-full" placeholder="/logo.png or https://..." value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
          </div>
          <div className="md:col-auto">
            <button className="btn btn-primary" type="submit">Save Branding</button>
          </div>
          {logoUrl && (
            <div className="md:col-span-3 mt-2">
              <div className="text-xs text-neutral-500 mb-1">Preview</div>
              <img src={logoUrl} alt="Logo preview" className="h-12 object-contain" />
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
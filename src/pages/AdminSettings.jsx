import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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

  // Coin/Bill Machine settings
  const [coinEqTable, setCoinEqTable] = useState([])
  const [billEqTable, setBillEqTable] = useState([])
  const [rechargeCoinBonus, setRechargeCoinBonus] = useState(0)
  const [rechargeBillBonus, setRechargeBillBonus] = useState(0)
  const [autoCharge, setAutoCharge] = useState(false)

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

  async function loadCoinMachineSettings() {
    try {
      const coinEq = await api.getSetting('coinEqTable').catch(() => null)
      const billEq = await api.getSetting('billEqTable').catch(() => null)
      const coinBonus = await api.getSetting('rechargeCoinBonus').catch(() => null)
      const billBonus = await api.getSetting('rechargeBillBonus').catch(() => null)
      const autoChargeVal = await api.getSetting('autoCharge').catch(() => null)
      
      setCoinEqTable(coinEq && Array.isArray(coinEq.value) ? coinEq.value : [])
      setBillEqTable(billEq && Array.isArray(billEq.value) ? billEq.value : [])
      setRechargeCoinBonus(coinBonus && coinBonus.value !== undefined ? Number(coinBonus.value) : 0)
      setRechargeBillBonus(billBonus && billBonus.value !== undefined ? Number(billBonus.value) : 0)
      setAutoCharge(autoChargeVal && autoChargeVal.value ? Boolean(autoChargeVal.value) : false)
    } catch (e) { 
      console.warn('loadCoinMachineSettings failed', e) 
    }
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

  useEffect(() => { load(); loadBranding(); loadCoinMachineSettings() }, [])

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

  async function saveCoinMachineSettings(e) {
    e.preventDefault()
    try {
      await api.setSetting({ key: 'coinEqTable', value: coinEqTable })
      await api.setSetting({ key: 'billEqTable', value: billEqTable })
      await api.setSetting({ key: 'rechargeCoinBonus', value: rechargeCoinBonus })
      await api.setSetting({ key: 'rechargeBillBonus', value: rechargeBillBonus })
      await api.setSetting({ key: 'autoCharge', value: autoCharge })
      toast({ title: 'Coin/Bill settings updated', variant: 'success' })
      load()
      loadCoinMachineSettings()
    } catch (e) {
      console.error(e)
      toast({ title: 'Failed to update settings', variant: 'destructive' })
    }
  }

  function addCoinMapping() {
    setCoinEqTable([...coinEqTable, { key: '', value: 0 }])
  }

  function updateCoinMapping(index, field, val) {
    const updated = [...coinEqTable]
    updated[index][field] = field === 'value' ? Number(val) : val
    setCoinEqTable(updated)
  }

  function removeCoinMapping(index) {
    setCoinEqTable(coinEqTable.filter((_, i) => i !== index))
  }

  function addBillMapping() {
    setBillEqTable([...billEqTable, { key: '', value: 0 }])
  }

  function updateBillMapping(index, field, val) {
    const updated = [...billEqTable]
    updated[index][field] = field === 'value' ? Number(val) : val
    setBillEqTable(updated)
  }

  function removeBillMapping(index) {
    setBillEqTable(billEqTable.filter((_, i) => i !== index))
  }

  function loadDefaultCoinMappings() {
    const defaults = [
      { key: '0x01', value: 0.05 },
      { key: '0x02', value: 0.10 },
      { key: '0x03', value: 0.20 },
      { key: '0x04', value: 0.50 },
      { key: '0x05', value: 1.00 },
      { key: '0x06', value: 2.00 }
    ]
    setCoinEqTable(defaults)
    toast({ title: 'Default coin mappings loaded', variant: 'success' })
  }

  function loadDefaultBillMappings() {
    const defaults = [
      { key: '0x10', value: 5 },
      { key: '0x11', value: 10 },
      { key: '0x12', value: 20 }
    ]
    setBillEqTable(defaults)
    toast({ title: 'Default bill mappings loaded', variant: 'success' })
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-2xl font-bold">Settings</h2>

      {/* Branding Section */}
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
                  onChange={(e) => setLogoUrl(e.target.value)} 
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
                      toast({ title: 'Logo cleared', variant: 'success' }); 
                      try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { logo: null } })) } catch (e) {} 
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

            <div className="flex gap-2">
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

      {/* Coin/Bill Machine Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Coin & Bill Acceptor Settings</CardTitle>
          <CardDescription>Configure coin/bill value mappings and recharge bonuses</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveCoinMachineSettings} className="space-y-6">
            {/* Coin Equivalence Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Coin Equivalence Table</Label>
                <div className="flex gap-2">
                  {coinEqTable.length === 0 && (
                    <Button type="button" variant="secondary" size="sm" onClick={loadDefaultCoinMappings}>
                      Load Defaults
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={addCoinMapping}>
                    + Add Coin
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Map hardware coin codes (e.g., 0x01, 0x02) to euro values
              </p>
              <div className="space-y-2">
                {coinEqTable.map((entry, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input
                      placeholder="Coin code (0x01)"
                      value={entry.key}
                      onChange={(e) => updateCoinMapping(idx, 'key', e.target.value)}
                      className="w-40"
                    />
                    <span className="text-muted-foreground">→</span>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="€ Value"
                      value={entry.value}
                      onChange={(e) => updateCoinMapping(idx, 'value', e.target.value)}
                      className="w-32"
                    />
                    <span className="text-sm">€</span>
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="sm"
                      onClick={() => removeCoinMapping(idx)}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
                {coinEqTable.length === 0 && (
                  <div className="border-2 border-dashed rounded-lg p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-2">No coin mappings configured</p>
                    <Button type="button" variant="secondary" size="sm" onClick={loadDefaultCoinMappings}>
                      Load Default Mappings
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Bill Equivalence Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Bill Equivalence Table</Label>
                <div className="flex gap-2">
                  {billEqTable.length === 0 && (
                    <Button type="button" variant="secondary" size="sm" onClick={loadDefaultBillMappings}>
                      Load Defaults
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={addBillMapping}>
                    + Add Bill
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Map hardware bill codes (e.g., 0x10, 0x11) to euro values
              </p>
              <div className="space-y-2">
                {billEqTable.map((entry, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input
                      placeholder="Bill code (0x10)"
                      value={entry.key}
                      onChange={(e) => updateBillMapping(idx, 'key', e.target.value)}
                      className="w-40"
                    />
                    <span className="text-muted-foreground">→</span>
                    <Input
                      type="number"
                      step="1"
                      placeholder="€ Value"
                      value={entry.value}
                      onChange={(e) => updateBillMapping(idx, 'value', e.target.value)}
                      className="w-32"
                    />
                    <span className="text-sm">€</span>
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="sm"
                      onClick={() => removeBillMapping(idx)}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
                {billEqTable.length === 0 && (
                  <div className="border-2 border-dashed rounded-lg p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-2">No bill mappings configured</p>
                    <Button type="button" variant="secondary" size="sm" onClick={loadDefaultBillMappings}>
                      Load Default Mappings
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Bonus Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
              <div className="space-y-2">
                <Label htmlFor="rechargeCoinBonus">Coin Recharge Bonus (%)</Label>
                <Input
                  id="rechargeCoinBonus"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={rechargeCoinBonus}
                  onChange={(e) => setRechargeCoinBonus(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Bonus percentage added to coin recharges (e.g., 10% means €1.00 → €1.10)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rechargeBillBonus">Bill Recharge Bonus (%)</Label>
                <Input
                  id="rechargeBillBonus"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={rechargeBillBonus}
                  onChange={(e) => setRechargeBillBonus(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Bonus percentage added to bill recharges
                </p>
              </div>

              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center gap-2">
                  <input
                    id="autoCharge"
                    type="checkbox"
                    checked={autoCharge}
                    onChange={(e) => setAutoCharge(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="autoCharge" className="cursor-pointer">
                    Auto-charge card on removal
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground ml-6">
                  Automatically save cash balance to card when card is removed
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit">Save Coin/Bill Settings</Button>
              <Button 
                type="button" 
                variant="outline"
                onClick={() => { 
                  loadCoinMachineSettings(); 
                  toast({ title: 'Reverted', variant: 'success' }) 
                }}
              >
                Revert
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Advanced/Raw Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Advanced Settings</CardTitle>
          <CardDescription>Add or modify raw configuration values</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={save} className="flex gap-2">
            <Input 
              placeholder="Setting key" 
              value={key} 
              onChange={(e) => setKey(e.target.value)} 
              className="w-64"
            />
            <Input 
              placeholder="Value (JSON supported)" 
              value={value} 
              onChange={(e) => setValue(e.target.value)} 
              className="flex-1"
            />
            <Button type="submit">Add</Button>
          </form>

          <div className="border rounded-lg">
            {list.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground text-center">No settings found</p>
            ) : (
              <ul className="divide-y">
                {list.map((s) => (
                  <li key={s._id} className="p-3 flex justify-between items-center hover:bg-muted/50">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{s.key}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        {JSON.stringify(s.value)}
                      </div>
                    </div>
                    <Button 
                      variant="destructive" 
                      size="sm"
                      onClick={() => remove(s.key)}
                    >
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
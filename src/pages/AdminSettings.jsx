import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Palette, ShieldCheck, Wifi as WifiIcon, Bell, MessageCircle, SlidersHorizontal, Image as ImageIcon, Plus, Trash2, ArrowUp, ArrowDown, Globe, Eye, EyeOff } from 'lucide-react'
import { DEFAULT_BANNERS } from '@/lib/defaultBanners'
import { DEFAULT_LANDING_CONTENT } from '@/lib/defaultLandingContent'

// Settings hidden from the raw "Avançado" list below — either because they
// already have a dedicated, friendlier UI elsewhere (so a second raw/rawer
// editor for the same value just invites confusing drift between the two),
// because they're a credential that shouldn't sit in a scrollable list next
// to unrelated config (adminPin), or because they're internal state the app
// maintains itself and was never meant to be hand-edited (cashDrawerLedger,
// hopperTarget — corrupting either just silently breaks an auto-fill, with
// no obvious symptom pointing back at "someone edited a raw setting").
// Still settable directly by typing the exact key into the Add form above —
// that's a deliberate technical action, unlike stumbling across it in a list.
const HIDDEN_ADVANCED_KEYS = new Set([
  'adminPin',
  'cashDrawerLedger',
  'hopperTarget',
  'coinEqTable', 'billEqTable', 'rechargeCoinBonus', 'rechargeBillBonus', 'autoCharge',
  'hopperCoinValue', 'hopperMaxDispenseCoins', 'creditRefundSeconds',
  'branding.companyName', 'branding.logo', 'branding.primaryColor', 'branding.accentColor',
  'banners',
  'landingPage.content',
  'wifi.enabled',
  'whatsapp.enabled',
  'loyaltyCard.cost', 'loyaltyCard.credit', 'loyaltyCard.minRecharge',
])

const TABS = [
  { id: 'branding', label: 'Branding', Icon: Palette },
  { id: 'banner', label: 'Banner', Icon: ImageIcon },
  { id: 'landing', label: 'Página Inicial', Icon: Globe },
  { id: 'staff', label: 'Staff & Manutenção', Icon: ShieldCheck },
  { id: 'wifi', label: 'WiFi', Icon: WifiIcon },
  { id: 'alerts', label: 'Alertas', Icon: Bell },
  { id: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
  { id: 'advanced', label: 'Avançado', Icon: SlidersHorizontal },
]

export default function AdminSettings(){
  const [activeTab, setActiveTab] = useState('branding')

  const [list, setList] = useState([])
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')

  // Branding helper state
  const [companyName, setCompanyName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [primaryColor, setPrimaryColor] = useState('')
  const [accentColor, setAccentColor] = useState('')

  // Homepage banner carousel helper state
  const [bannerSlides, setBannerSlides] = useState(DEFAULT_BANNERS)
  const [savingBanners, setSavingBanners] = useState(false)
  const [uploadingBannerIdx, setUploadingBannerIdx] = useState(null)

  // Public landing page (freshbubbles.pt) content helper state
  const [landingContent, setLandingContent] = useState(DEFAULT_LANDING_CONTENT)
  const [savingLanding, setSavingLanding] = useState(false)

  // Staff & maintenance helper state
  const [adminPin, setAdminPin] = useState('')
  const [savingPin, setSavingPin] = useState(false)
  const [kioskLockEnabled, setKioskLockEnabled] = useState(false)
  const [savingLockToggle, setSavingLockToggle] = useState(false)

  // WiFi voucher helper state
  const [wifiEnabled, setWifiEnabled] = useState(false)
  const [savingWifiToggle, setSavingWifiToggle] = useState(false)
  const [wifiDuration, setWifiDuration] = useState('60')
  const [wifiSsid, setWifiSsid] = useState('')
  const [savingWifi, setSavingWifi] = useState(false)

  // Operator alert email helper state
  const [alertsEmail, setAlertsEmail] = useState('')
  const [savingAlertsEmail, setSavingAlertsEmail] = useState(false)

  // WhatsApp (Round 14) helper state
  const [whatsappEnabled, setWhatsappEnabled] = useState(false)
  const [savingWhatsappToggle, setSavingWhatsappToggle] = useState(false)
  const [whatsappStatus, setWhatsappStatus] = useState({ connected: false, qr: null })
  const [disconnectingWhatsapp, setDisconnectingWhatsapp] = useState(false)

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

  async function loadBannerSettings() {
    try {
      const saved = await api.getSetting('banners').catch(() => null)
      const value = saved && Array.isArray(saved.value) ? saved.value : null
      setBannerSlides(value && value.length > 0 ? value : DEFAULT_BANNERS)
    } catch (e) { console.warn('loadBannerSettings failed', e) }
  }

  // Merges saved content onto the defaults field-by-field — mirrors
  // backend/src/views/landing.js's own mergeContent(), so a partial save (or
  // one from before a field existed) never leaves the form with a missing
  // section instead of falling back to real default copy.
  async function loadLandingContent() {
    try {
      const saved = await api.getSetting('landingPage.content').catch(() => null)
      const c = (saved && saved.value && typeof saved.value === 'object') ? saved.value : {}
      const items = (list, fallback) => (Array.isArray(list) && list.length ? list : fallback)
      const b = (c.brand && typeof c.brand === 'object') ? c.brand : {}
      setLandingContent({
        brand: {
          ...DEFAULT_LANDING_CONTENT.brand,
          ...b,
          address: { ...DEFAULT_LANDING_CONTENT.brand.address, ...(b.address || {}) },
          hours: { ...DEFAULT_LANDING_CONTENT.brand.hours, ...(b.hours || {}) },
          rating: { ...DEFAULT_LANDING_CONTENT.brand.rating, ...(b.rating || {}) },
          social: Array.isArray(b.social) ? b.social : DEFAULT_LANDING_CONTENT.brand.social,
        },
        hero: { ...DEFAULT_LANDING_CONTENT.hero, ...(c.hero || {}) },
        steps: { ...DEFAULT_LANDING_CONTENT.steps, ...(c.steps || {}), items: items(c.steps && c.steps.items, DEFAULT_LANDING_CONTENT.steps.items) },
        features: { ...DEFAULT_LANDING_CONTENT.features, ...(c.features || {}), items: items(c.features && c.features.items, DEFAULT_LANDING_CONTENT.features.items) },
        cta: { ...DEFAULT_LANDING_CONTENT.cta, ...(c.cta || {}) },
        visit: { ...DEFAULT_LANDING_CONTENT.visit, ...(c.visit || {}) },
        reviews: {
          ...DEFAULT_LANDING_CONTENT.reviews,
          ...(c.reviews || {}),
          items: items(c.reviews && c.reviews.items, DEFAULT_LANDING_CONTENT.reviews.items),
        },
        customSections: Array.isArray(c.customSections) ? c.customSections : [],
      })
    } catch (e) { console.warn('loadLandingContent failed', e) }
  }

  function updateHero(field, val) {
    setLandingContent((c) => ({ ...c, hero: { ...c.hero, [field]: val } }))
  }

  function updateBrandField(field, val) {
    setLandingContent((c) => ({ ...c, brand: { ...c.brand, [field]: val } }))
  }
  function updateBrandAddress(field, val) {
    setLandingContent((c) => ({ ...c, brand: { ...c.brand, address: { ...c.brand.address, [field]: val } } }))
  }
  function updateBrandHours(field, val) {
    setLandingContent((c) => ({ ...c, brand: { ...c.brand, hours: { ...c.brand.hours, [field]: val } } }))
  }
  function updateBrandRating(field, val) {
    setLandingContent((c) => ({ ...c, brand: { ...c.brand, rating: { ...c.brand.rating, [field]: val } } }))
  }
  function addSocialLink() {
    setLandingContent((c) => ({ ...c, brand: { ...c.brand, social: [...c.brand.social, { name: '', url: '' }] } }))
  }
  function updateSocialLink(idx, field, val) {
    setLandingContent((c) => ({ ...c, brand: { ...c.brand, social: c.brand.social.map((s, i) => (i === idx ? { ...s, [field]: val } : s)) } }))
  }
  function removeSocialLink(idx) {
    setLandingContent((c) => ({ ...c, brand: { ...c.brand, social: c.brand.social.filter((_, i) => i !== idx) } }))
  }
  function updateSectionField(section, field, val) {
    setLandingContent((c) => ({ ...c, [section]: { ...c[section], [field]: val } }))
  }
  function toggleSectionVisible(section) {
    setLandingContent((c) => ({ ...c, [section]: { ...c[section], visible: !c[section].visible } }))
  }
  function updateSectionItem(section, idx, field, val) {
    setLandingContent((c) => ({ ...c, [section]: { ...c[section], items: c[section].items.map((it, i) => (i === idx ? { ...it, [field]: val } : it)) } }))
  }
  function addSectionItem(section) {
    setLandingContent((c) => ({ ...c, [section]: { ...c[section], items: [...c[section].items, { t: '', d: '' }] } }))
  }
  function removeSectionItem(section, idx) {
    setLandingContent((c) => ({ ...c, [section]: { ...c[section], items: c[section].items.filter((_, i) => i !== idx) } }))
  }
  function moveSectionItem(section, idx, dir) {
    setLandingContent((c) => {
      const items = [...c[section].items]
      const target = idx + dir
      if (target < 0 || target >= items.length) return c
      ;[items[idx], items[target]] = [items[target], items[idx]]
      return { ...c, [section]: { ...c[section], items } }
    })
  }

  function updateReview(idx, field, val) {
    setLandingContent((c) => ({ ...c, reviews: { ...c.reviews, items: c.reviews.items.map((r, i) => (i === idx ? { ...r, [field]: val } : r)) } }))
  }
  function addReview() {
    setLandingContent((c) => ({ ...c, reviews: { ...c.reviews, items: [...c.reviews.items, { text: '', author: '' }] } }))
  }
  function removeReview(idx) {
    setLandingContent((c) => ({ ...c, reviews: { ...c.reviews, items: c.reviews.items.filter((_, i) => i !== idx) } }))
  }
  function moveReview(idx, dir) {
    setLandingContent((c) => {
      const items = [...c.reviews.items]
      const target = idx + dir
      if (target < 0 || target >= items.length) return c
      ;[items[idx], items[target]] = [items[target], items[idx]]
      return { ...c, reviews: { ...c.reviews, items } }
    })
  }

  function addCustomSection() {
    setLandingContent((c) => ({ ...c, customSections: [...c.customSections, { id: `custom-${Date.now()}`, visible: true, eyebrow: '', heading: '', body: '', ctaLabel: '', ctaHref: '' }] }))
  }
  function updateCustomSection(idx, field, val) {
    setLandingContent((c) => ({ ...c, customSections: c.customSections.map((s, i) => (i === idx ? { ...s, [field]: val } : s)) }))
  }
  function removeCustomSection(idx) {
    setLandingContent((c) => ({ ...c, customSections: c.customSections.filter((_, i) => i !== idx) }))
  }
  function moveCustomSection(idx, dir) {
    setLandingContent((c) => {
      const sections = [...c.customSections]
      const target = idx + dir
      if (target < 0 || target >= sections.length) return c
      ;[sections[idx], sections[target]] = [sections[target], sections[idx]]
      return { ...c, customSections: sections }
    })
  }

  async function saveLandingContent() {
    setSavingLanding(true)
    try {
      await api.setSetting({ key: 'landingPage.content', value: landingContent })
      toast({ title: 'Página inicial guardada', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao guardar a página inicial', variant: 'destructive' })
    } finally {
      setSavingLanding(false)
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

  async function loadStaffSettings() {
    try {
      const pin = await api.getSetting('adminPin').catch(() => null)
      const lockEnabled = await api.getSetting('kioskLockEnabled').catch(() => null)
      setAdminPin(pin && pin.value != null ? String(pin.value) : '')
      setKioskLockEnabled(Boolean(lockEnabled && lockEnabled.value))
    } catch (e) { console.warn('loadStaffSettings failed', e) }
  }

  async function loadWifiSettings() {
    try {
      const enabled = await api.getSetting('wifi.enabled').catch(() => null)
      const duration = await api.getSetting('wifi.durationMinutes').catch(() => null)
      const ssid = await api.getSetting('wifi.ssid').catch(() => null)
      setWifiEnabled(Boolean(enabled && enabled.value))
      setWifiDuration(duration && duration.value != null ? String(duration.value) : '60')
      setWifiSsid(ssid && ssid.value != null ? String(ssid.value) : '')
    } catch (e) { console.warn('loadWifiSettings failed', e) }
  }

  async function loadAlertsSettings() {
    try {
      const email = await api.getSetting('alerts.email').catch(() => null)
      setAlertsEmail(email && email.value != null ? String(email.value) : '')
    } catch (e) { console.warn('loadAlertsSettings failed', e) }
  }

  async function loadWhatsappSettings() {
    try {
      const enabled = await api.getSetting('whatsapp.enabled').catch(() => null)
      setWhatsappEnabled(Boolean(enabled && enabled.value))
    } catch (e) { console.warn('loadWhatsappSettings failed', e) }
  }

  useEffect(() => { load(); loadBranding(); loadBannerSettings(); loadLandingContent(); loadStaffSettings(); loadWifiSettings(); loadAlertsSettings(); loadWhatsappSettings() }, [])

  // While WhatsApp is enabled but not yet connected, poll for the QR code /
  // connection state — same "poll a status endpoint while pairing" idea the
  // toggle itself relies on to reflect what the backend's Baileys socket is
  // actually doing (a live connection, not something this page controls
  // directly). Runs regardless of which tab is active, so switching back to
  // WhatsApp shows fresh status immediately instead of a blank re-fetch.
  useEffect(() => {
    if (!whatsappEnabled) return
    let cancelled = false
    async function poll() {
      try {
        const s = await api.getWhatsappStatus()
        if (!cancelled) setWhatsappStatus(s)
      } catch (e) { /* transient — next poll retries */ }
    }
    poll()
    const id = setInterval(poll, 4000)
    return () => { cancelled = true; clearInterval(id) }
  }, [whatsappEnabled])

  // Live preview: dispatch branding:update when fields change so app updates immediately
  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('branding:update', { detail: { company: companyName || null, logo: logoUrl || null, primaryColor: primaryColor || null, accentColor: accentColor || null } }))
    } catch { /* a listener that throws must not break the caller */ }
  }, [companyName, logoUrl, primaryColor, accentColor])

  async function save(e) {
    e.preventDefault()
    try {
      // The field is labelled "aceita JSON" — parse it as JSON when possible
      // (numbers, booleans, arrays, objects) so e.g. `123` or `["a","b"]`
      // land as real typed values, not the literal string. Falls back to the
      // raw text for anything that isn't valid JSON, like a plain word.
      let parsedValue = value
      try { parsedValue = JSON.parse(value) } catch { /* not JSON — store as plain text */ }
      await api.setSetting({ key, value: parsedValue })
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
        try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { logo: url } })) } catch { /* a listener that throws must not break the caller */ }
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
      try { window.dispatchEvent(new CustomEvent('branding:update', { detail: { company: companyName, logo: logoUrl, primaryColor, accentColor } })) } catch { /* a listener that throws must not break the caller */ }
    } catch (e) {
      console.error(e)
      toast({ title: 'Failed to update branding', variant: 'destructive' })
    }
  }

  function addBannerSlide() {
    setBannerSlides((prev) => [...prev, { id: `banner-${Date.now()}`, title: '', text: '', image: '' }])
  }

  function removeBannerSlide(idx) {
    setBannerSlides((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateBannerSlide(idx, field, val) {
    setBannerSlides((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: val } : s)))
  }

  function moveBannerSlide(idx, dir) {
    setBannerSlides((prev) => {
      const next = [...prev]
      const target = idx + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  async function uploadBannerSlideImage(idx, file) {
    if (!file) return
    setUploadingBannerIdx(idx)
    try {
      const { url } = await api.uploadBannerImage(file)
      updateBannerSlide(idx, 'image', url)
      toast({ title: 'Imagem carregada', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar imagem', variant: 'destructive' })
    } finally {
      setUploadingBannerIdx(null)
    }
  }

  async function saveBanners() {
    // Must be a real uploaded file (uploadBannerImage's own output shape),
    // not just "truthy" — DEFAULT_BANNERS seeds new slides with an imported
    // asset path (e.g. /src/assets/banner/dry.png in dev, a hashed
    // /assets/... path in a production build) so the editor has something to
    // preview before a real upload. That path only resolves inside the exact
    // frontend build that imported it — saving it as if it were a stable URL
    // means it 404s the moment a different build or environment serves this
    // same Setting. Requiring /uploads/ here forces a real upload before save.
    if (bannerSlides.some((s) => !s.image || !s.image.startsWith('/uploads/'))) {
      return toast({ title: 'Cada slide precisa de uma imagem carregada — escolha um ficheiro para cada slide', variant: 'destructive' })
    }
    setSavingBanners(true)
    try {
      await api.setSetting({ key: 'banners', value: bannerSlides })
      toast({ title: 'Banners guardados', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao guardar banners', variant: 'destructive' })
    } finally {
      setSavingBanners(false)
    }
  }

  async function saveAdminPin(e) {
    e.preventDefault()
    if (adminPin && !/^\d{4,8}$/.test(adminPin)) {
      return toast({ title: 'O PIN deve ter entre 4 e 8 dígitos', variant: 'destructive' })
    }
    setSavingPin(true)
    try {
      await api.setSetting({ key: 'adminPin', value: adminPin || null })
      toast({ title: adminPin ? 'PIN de staff atualizado' : 'PIN de staff removido — ações de staff ficam bloqueadas', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao guardar PIN', variant: 'destructive' })
    } finally {
      setSavingPin(false)
    }
  }

  async function toggleKioskLock(nextEnabled) {
    setSavingLockToggle(true)
    setKioskLockEnabled(nextEnabled) // optimistic — the kiosk polls this, so a beat of lag is fine either way
    try {
      await api.setSetting({ key: 'kioskLockEnabled', value: nextEnabled })
      toast({ title: nextEnabled ? 'Bloqueio de ecrã ativado' : 'Bloqueio de ecrã desativado', variant: 'success' })
    } catch (e) {
      console.error(e)
      setKioskLockEnabled(!nextEnabled)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally {
      setSavingLockToggle(false)
    }
  }

  async function toggleWifiEnabled(nextEnabled) {
    setSavingWifiToggle(true)
    setWifiEnabled(nextEnabled)
    try {
      await api.setSetting({ key: 'wifi.enabled', value: nextEnabled })
      toast({ title: nextEnabled ? 'WiFi grátis ativado' : 'WiFi grátis desativado', variant: 'success' })
    } catch (e) {
      console.error(e)
      setWifiEnabled(!nextEnabled)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally {
      setSavingWifiToggle(false)
    }
  }

  async function saveWifiDetails(e) {
    e.preventDefault()
    const minutes = Number(wifiDuration)
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return toast({ title: 'Duração inválida — indique os minutos de acesso', variant: 'destructive' })
    }
    setSavingWifi(true)
    try {
      await api.setSetting({ key: 'wifi.durationMinutes', value: minutes })
      await api.setSetting({ key: 'wifi.ssid', value: wifiSsid || '' })
      toast({ title: 'Definições de WiFi guardadas', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao guardar definições de WiFi', variant: 'destructive' })
    } finally {
      setSavingWifi(false)
    }
  }

  async function saveAlertsEmail(e) {
    e.preventDefault()
    if (alertsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertsEmail)) {
      return toast({ title: 'Endereço de email inválido', variant: 'destructive' })
    }
    setSavingAlertsEmail(true)
    try {
      await api.setSetting({ key: 'alerts.email', value: alertsEmail || null })
      toast({ title: alertsEmail ? 'Email de alertas guardado' : 'Alertas por email desativados', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally {
      setSavingAlertsEmail(false)
    }
  }

  async function toggleWhatsappEnabled(nextEnabled) {
    setSavingWhatsappToggle(true)
    setWhatsappEnabled(nextEnabled)
    try {
      await api.setSetting({ key: 'whatsapp.enabled', value: nextEnabled })
      toast({ title: nextEnabled ? 'WhatsApp ativado' : 'WhatsApp desativado', variant: 'success' })
      if (!nextEnabled) setWhatsappStatus({ connected: false, qr: null })
    } catch (e) {
      console.error(e)
      setWhatsappEnabled(!nextEnabled)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally {
      setSavingWhatsappToggle(false)
    }
  }

  async function disconnectWhatsapp() {
    if (!confirm('Desligar o WhatsApp? Vai precisar de ler o QR novamente para reativar.')) return
    setDisconnectingWhatsapp(true)
    try {
      await api.disconnectWhatsapp()
      setWhatsappStatus({ connected: false, qr: null })
      toast({ title: 'WhatsApp desligado', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao desligar', variant: 'destructive' })
    } finally {
      setDisconnectingWhatsapp(false)
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-2xl font-bold">Settings</h2>

      {/* Tab bar — one section visible at a time instead of every Card
          stacked and expanded. Sections keep their own state/effects at the
          component's top level regardless of which tab is showing (the
          WhatsApp status poll above, for instance), so switching tabs never
          loses in-flight state. */}
      <div className="border-b flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors
                ${active ? 'border-primary-600 text-primary-700' : 'border-transparent text-neutral-500 hover:text-neutral-800 hover:border-neutral-200'}`}
            >
              <t.Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Branding */}
      {activeTab === 'branding' && (
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
      )}

      {/* Homepage banner carousel */}
      {activeTab === 'banner' && (
      <Card>
        <CardHeader>
          <CardTitle>Banner da página inicial</CardTitle>
          <CardDescription>Imagens e texto do carrossel que os clientes veem ao chegar ao quiosque</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {bannerSlides.map((slide, idx) => (
            <div key={slide.id} className="border rounded-lg p-4 flex flex-col md:flex-row gap-4">
              <div className="shrink-0">
                <div className="w-40 h-24 rounded-lg overflow-hidden bg-muted border flex items-center justify-center">
                  {slide.image ? (
                    <img src={slide.image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <label className="mt-2 block">
                  <span className="sr-only">Carregar imagem</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="text-xs w-40"
                    onChange={(e) => uploadBannerSlideImage(idx, e.target.files && e.target.files[0])}
                    disabled={uploadingBannerIdx === idx}
                  />
                </label>
                {uploadingBannerIdx === idx && <p className="text-xs text-muted-foreground mt-1">A carregar…</p>}
              </div>

              <div className="flex-1 space-y-2">
                <div>
                  <Label htmlFor={`banner-title-${idx}`}>Título</Label>
                  <Input
                    id={`banner-title-${idx}`}
                    value={slide.title}
                    onChange={(e) => updateBannerSlide(idx, 'title', e.target.value)}
                    placeholder="Ex: Lavagem de carpetes"
                  />
                </div>
                <div>
                  <Label htmlFor={`banner-text-${idx}`}>Texto</Label>
                  <Input
                    id={`banner-text-${idx}`}
                    value={slide.text}
                    onChange={(e) => updateBannerSlide(idx, 'text', e.target.value)}
                    placeholder="Ex: Entre em contacto..."
                  />
                </div>
              </div>

              <div className="flex md:flex-col gap-2 shrink-0 justify-end">
                <Button type="button" variant="outline" size="sm" onClick={() => moveBannerSlide(idx, -1)} disabled={idx === 0} aria-label="Mover para cima">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => moveBannerSlide(idx, 1)} disabled={idx === bannerSlides.length - 1} aria-label="Mover para baixo">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={() => removeBannerSlide(idx)} aria-label="Remover slide">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          {bannerSlides.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Sem slides — adicione pelo menos um.</p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="outline" onClick={addBannerSlide}>
              <Plus className="h-4 w-4 mr-2" /> Adicionar slide
            </Button>
            <Button type="button" onClick={saveBanners} disabled={savingBanners}>
              {savingBanners ? 'A guardar…' : 'Guardar Banners'}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Public landing page (freshbubbles.pt) content */}
      {activeTab === 'landing' && (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Hero</CardTitle>
            <CardDescription>O topo da página — a primeira coisa que o visitante vê</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="hero-eyebrow">Etiqueta</Label>
              <Input id="hero-eyebrow" value={landingContent.hero.eyebrow} onChange={(e) => updateHero('eyebrow', e.target.value)} placeholder="Ex: Lavandaria em Loures" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="hero-heading">Título</Label>
                <Input id="hero-heading" value={landingContent.hero.heading} onChange={(e) => updateHero('heading', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="hero-accent">Título (destaque)</Label>
                <Input id="hero-accent" value={landingContent.hero.accent} onChange={(e) => updateHero('accent', e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="hero-sub">Subtítulo</Label>
              <Input id="hero-sub" value={landingContent.hero.subheading} onChange={(e) => updateHero('subheading', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="hero-cta1">Botão principal</Label>
                <Input id="hero-cta1" value={landingContent.hero.ctaPrimaryLabel} onChange={(e) => updateHero('ctaPrimaryLabel', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="hero-cta2">Botão secundário</Label>
                <Input id="hero-cta2" value={landingContent.hero.ctaSecondaryLabel} onChange={(e) => updateHero('ctaSecondaryLabel', e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dados do negócio</CardTitle>
            <CardDescription>Morada, contactos, horário, avaliação e redes sociais — usados também nos dados estruturados que o Google lê (mantém-se tudo sincronizado). O logótipo vem do separador Branding, não daqui.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="brand-name">Nome</Label>
                <Input id="brand-name" value={landingContent.brand.name} onChange={(e) => updateBrandField('name', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="brand-tagline">Etiqueta (sob o nome)</Label>
                <Input id="brand-tagline" value={landingContent.brand.tagline} onChange={(e) => updateBrandField('tagline', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="brand-email">Email</Label>
                <Input id="brand-email" type="email" value={landingContent.brand.email} onChange={(e) => updateBrandField('email', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="brand-phone">Telefone</Label>
                <Input id="brand-phone" value={landingContent.brand.phone} onChange={(e) => updateBrandField('phone', e.target.value)} placeholder="Ex: +351 912 715 258" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <Label htmlFor="brand-street">Morada</Label>
                <Input id="brand-street" value={landingContent.brand.address.street} onChange={(e) => updateBrandAddress('street', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="brand-postal">Código postal</Label>
                <Input id="brand-postal" value={landingContent.brand.address.postal} onChange={(e) => updateBrandAddress('postal', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="brand-city">Localidade</Label>
                <Input id="brand-city" value={landingContent.brand.address.city} onChange={(e) => updateBrandAddress('city', e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="brand-country">País</Label>
                <Input id="brand-country" value={landingContent.brand.address.country} onChange={(e) => updateBrandAddress('country', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="brand-open">Abre às</Label>
                <Input id="brand-open" type="time" value={landingContent.brand.hours.open} onChange={(e) => updateBrandHours('open', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="brand-close">Fecha às</Label>
                <Input id="brand-close" type="time" value={landingContent.brand.hours.close} onChange={(e) => updateBrandHours('close', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="brand-rating-value">Avaliação Google (0–5)</Label>
                <Input id="brand-rating-value" type="number" min="0" max="5" step="0.1" value={landingContent.brand.rating.value} onChange={(e) => updateBrandRating('value', Number(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="brand-rating-count">Número de avaliações</Label>
                <Input id="brand-rating-count" type="number" min="0" step="1" value={landingContent.brand.rating.count} onChange={(e) => updateBrandRating('count', Number(e.target.value))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Redes sociais</Label>
              {landingContent.brand.social.map((s, idx) => (
                <div key={idx} className="flex flex-col md:flex-row gap-2">
                  <Input value={s.name} onChange={(e) => updateSocialLink(idx, 'name', e.target.value)} placeholder="Ex: Instagram, Facebook" className="md:w-48" />
                  <Input value={s.url} onChange={(e) => updateSocialLink(idx, 'url', e.target.value)} placeholder="https://..." className="flex-1" />
                  <Button type="button" variant="destructive" size="sm" onClick={() => removeSocialLink(idx)} aria-label="Remover rede social">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addSocialLink}>
                <Plus className="h-4 w-4 mr-2" /> Adicionar rede social
              </Button>
            </div>
          </CardContent>
        </Card>

        {[
          { key: 'steps', title: 'Como funciona', desc: 'Os passos, em ordem, com o número gerado automaticamente' },
          { key: 'features', title: 'Serviços', desc: 'Os cartões de serviços/vantagens' },
        ].map(({ key, title, desc }) => (
          <Card key={key}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{desc}</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => toggleSectionVisible(key)}>
                {landingContent[key].visible
                  ? (<><Eye className="h-4 w-4 mr-2" />Visível</>)
                  : (<><EyeOff className="h-4 w-4 mr-2" />Oculto</>)}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Etiqueta</Label>
                  <Input value={landingContent[key].eyebrow} onChange={(e) => updateSectionField(key, 'eyebrow', e.target.value)} />
                </div>
                <div>
                  <Label>Título da secção</Label>
                  <Input value={landingContent[key].heading} onChange={(e) => updateSectionField(key, 'heading', e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Descrição</Label>
                <Input value={landingContent[key].description} onChange={(e) => updateSectionField(key, 'description', e.target.value)} />
              </div>

              {landingContent[key].items.map((item, idx) => (
                <div key={idx} className="border rounded-lg p-3 flex flex-col md:flex-row gap-3">
                  <div className="flex-1 space-y-2">
                    <Input value={item.t} onChange={(e) => updateSectionItem(key, idx, 't', e.target.value)} placeholder="Título" />
                    <Input value={item.d} onChange={(e) => updateSectionItem(key, idx, 'd', e.target.value)} placeholder="Texto" />
                  </div>
                  <div className="flex md:flex-col gap-2 shrink-0 justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={() => moveSectionItem(key, idx, -1)} disabled={idx === 0} aria-label="Mover para cima">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => moveSectionItem(key, idx, 1)} disabled={idx === landingContent[key].items.length - 1} aria-label="Mover para baixo">
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => removeSectionItem(key, idx)} aria-label="Remover item">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => addSectionItem(key)}>
                <Plus className="h-4 w-4 mr-2" /> Adicionar item
              </Button>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Chamada para ação</CardTitle>
              <CardDescription>A faixa de destaque antes de "Visite-nos"</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => toggleSectionVisible('cta')}>
              {landingContent.cta.visible
                ? (<><Eye className="h-4 w-4 mr-2" />Visível</>)
                : (<><EyeOff className="h-4 w-4 mr-2" />Oculto</>)}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Título</Label>
              <Input value={landingContent.cta.heading} onChange={(e) => updateSectionField('cta', 'heading', e.target.value)} />
            </div>
            <div>
              <Label>Texto</Label>
              <Input value={landingContent.cta.description} onChange={(e) => updateSectionField('cta', 'description', e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Avaliações (testemunhos)</CardTitle>
              <CardDescription>Secção própria — mais do que uma vira um carrossel automático</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => toggleSectionVisible('reviews')}>
              {landingContent.reviews.visible
                ? (<><Eye className="h-4 w-4 mr-2" />Visível</>)
                : (<><EyeOff className="h-4 w-4 mr-2" />Oculto</>)}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Etiqueta</Label>
                <Input value={landingContent.reviews.eyebrow} onChange={(e) => updateSectionField('reviews', 'eyebrow', e.target.value)} />
              </div>
              <div>
                <Label>Título da secção</Label>
                <Input value={landingContent.reviews.heading} onChange={(e) => updateSectionField('reviews', 'heading', e.target.value)} />
              </div>
            </div>
            {landingContent.reviews.items.map((r, idx) => (
              <div key={idx} className="border rounded-lg p-3 flex flex-col md:flex-row gap-3">
                <div className="flex-1 space-y-2">
                  <Input value={r.text} onChange={(e) => updateReview(idx, 'text', e.target.value)} placeholder="Texto da avaliação" />
                  <Input value={r.author} onChange={(e) => updateReview(idx, 'author', e.target.value)} placeholder="Nome de quem avaliou" />
                </div>
                <div className="flex md:flex-col gap-2 shrink-0 justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={() => moveReview(idx, -1)} disabled={idx === 0} aria-label="Mover para cima">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => moveReview(idx, 1)} disabled={idx === landingContent.reviews.items.length - 1} aria-label="Mover para baixo">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={() => removeReview(idx)} aria-label="Remover avaliação">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addReview}>
              <Plus className="h-4 w-4 mr-2" /> Adicionar avaliação
            </Button>
            <p className="text-xs text-muted-foreground">Use apenas o texto real da avaliação do Google — nunca inventado.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Visite-nos</CardTitle>
              <CardDescription>Morada, telefone, horário e redes sociais editam-se no cartão "Dados do negócio" acima — aqui só o texto à volta</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => toggleSectionVisible('visit')}>
              {landingContent.visit.visible
                ? (<><Eye className="h-4 w-4 mr-2" />Visível</>)
                : (<><EyeOff className="h-4 w-4 mr-2" />Oculto</>)}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Etiqueta</Label>
                <Input value={landingContent.visit.eyebrow} onChange={(e) => updateSectionField('visit', 'eyebrow', e.target.value)} />
              </div>
              <div>
                <Label>Título da secção</Label>
                <Input value={landingContent.visit.heading} onChange={(e) => updateSectionField('visit', 'heading', e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={landingContent.visit.description} onChange={(e) => updateSectionField('visit', 'description', e.target.value)} />
            </div>

            <div className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <p className="text-sm font-medium">Ligação "Área reservada (equipa)"</p>
                <p className="text-xs text-muted-foreground">Um segundo acesso à área de equipa, dentro do cartão de contacto — o menu já tem um em cima.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => updateSectionField('visit', 'showLoginLink', !landingContent.visit.showLoginLink)}>
                {landingContent.visit.showLoginLink !== false
                  ? (<><Eye className="h-4 w-4 mr-2" />Visível</>)
                  : (<><EyeOff className="h-4 w-4 mr-2" />Oculto</>)}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Secções personalizadas</CardTitle>
            <CardDescription>Adicione novas secções à página — título, texto e, opcionalmente, um botão</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {landingContent.customSections.map((cs, idx) => (
              <div key={cs.id || idx} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Secção {idx + 1}</span>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => updateCustomSection(idx, 'visible', cs.visible === false)}>
                      {cs.visible !== false
                        ? (<><Eye className="h-4 w-4 mr-2" />Visível</>)
                        : (<><EyeOff className="h-4 w-4 mr-2" />Oculto</>)}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => moveCustomSection(idx, -1)} disabled={idx === 0} aria-label="Mover para cima">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => moveCustomSection(idx, 1)} disabled={idx === landingContent.customSections.length - 1} aria-label="Mover para baixo">
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => removeCustomSection(idx)} aria-label="Remover secção">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Etiqueta (opcional)</Label>
                    <Input value={cs.eyebrow} onChange={(e) => updateCustomSection(idx, 'eyebrow', e.target.value)} />
                  </div>
                  <div>
                    <Label>Título</Label>
                    <Input value={cs.heading} onChange={(e) => updateCustomSection(idx, 'heading', e.target.value)} placeholder="Obrigatório — sem título a secção não é publicada" />
                  </div>
                </div>
                <div>
                  <Label>Texto</Label>
                  <Input value={cs.body} onChange={(e) => updateCustomSection(idx, 'body', e.target.value)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Texto do botão (opcional)</Label>
                    <Input value={cs.ctaLabel} onChange={(e) => updateCustomSection(idx, 'ctaLabel', e.target.value)} />
                  </div>
                  <div>
                    <Label>Link do botão (opcional)</Label>
                    <Input value={cs.ctaHref} onChange={(e) => updateCustomSection(idx, 'ctaHref', e.target.value)} placeholder="Ex: /promo ou https://..." />
                  </div>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addCustomSection}>
              <Plus className="h-4 w-4 mr-2" /> Adicionar secção
            </Button>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 pb-4">
          <Button type="button" onClick={saveLandingContent} disabled={savingLanding}>
            {savingLanding ? 'A guardar…' : 'Guardar Página Inicial'}
          </Button>
          <Button type="button" variant="outline" onClick={() => setLandingContent(DEFAULT_LANDING_CONTENT)}>
            Repor predefinições
          </Button>
        </div>
      </div>
      )}

      {/* Staff & Maintenance */}
      {activeTab === 'staff' && (
      <Card>
        <CardHeader>
          <CardTitle>Staff &amp; Manutenção</CardTitle>
          <CardDescription>PIN de staff e bloqueio de ecrã do quiosque durante manutenção</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={saveAdminPin} className="space-y-2 max-w-xs">
            <Label htmlFor="adminPin">PIN de staff</Label>
            <Input
              id="adminPin"
              type="text"
              inputMode="numeric"
              placeholder="Ex: 4821"
              value={adminPin}
              onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
            <p className="text-xs text-muted-foreground">
              Necessário no quiosque para pagamento manual, fecho de caixa e bloqueio de ecrã.
              Sem um PIN definido, essas ações ficam bloqueadas — nunca desativadas por omissão.
            </p>
            <Button type="submit" size="sm" disabled={savingPin}>
              {savingPin ? 'A guardar…' : 'Guardar PIN'}
            </Button>
          </form>

          <div className="border-t pt-4 flex items-start justify-between gap-4 max-w-xl">
            <div>
              <div className="font-medium text-sm">Bloqueio de ecrã do quiosque</div>
              <p className="text-xs text-muted-foreground mt-1">
                Quando ativo, o staff pode congelar o ecrã do quiosque (com PIN) durante
                manutenção física — reabastecer o hopper, destravar uma máquina, etc. —
                para que um cliente não possa tocar no ecrã entretanto.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={kioskLockEnabled}
              onClick={() => toggleKioskLock(!kioskLockEnabled)}
              disabled={savingLockToggle}
              className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50
                ${kioskLockEnabled ? 'bg-primary-600' : 'bg-neutral-300'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                  ${kioskLockEnabled ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>
        </CardContent>
      </Card>
      )}

      {/* WiFi Voucher */}
      {activeTab === 'wifi' && (
      <Card>
        <CardHeader>
          <CardTitle>WiFi grátis</CardTitle>
          <CardDescription>Voucher de acesso à internet oferecido após lavagem/secagem</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-start justify-between gap-4 max-w-xl">
            <div>
              <div className="font-medium text-sm">Oferecer WiFi após a compra</div>
              <p className="text-xs text-muted-foreground mt-1">
                Quando ativo, o quiosque mostra um QR code com um código de acesso
                à rede convidado assim que uma lavagem ou secagem é paga.
                Requer um controlador UniFi configurado no servidor.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={wifiEnabled}
              onClick={() => toggleWifiEnabled(!wifiEnabled)}
              disabled={savingWifiToggle}
              className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50
                ${wifiEnabled ? 'bg-primary-600' : 'bg-neutral-300'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                  ${wifiEnabled ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>

          <form onSubmit={saveWifiDetails} className="border-t pt-4 space-y-3 max-w-xs">
            <div className="space-y-2">
              <Label htmlFor="wifiDuration">Duração do acesso (minutos)</Label>
              <Input
                id="wifiDuration"
                type="number"
                min="1"
                placeholder="Ex: 60"
                value={wifiDuration}
                onChange={(e) => setWifiDuration(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Tempo até o cliente ser desligado da rede, a partir da primeira ligação.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wifiSsid">Nome da rede (SSID)</Label>
              <Input
                id="wifiSsid"
                type="text"
                placeholder="Ex: Washbubbles-Guest"
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Mostrado ao cliente como instrução — não configura a rede em si.
              </p>
            </div>
            <Button type="submit" size="sm" disabled={savingWifi}>
              {savingWifi ? 'A guardar…' : 'Guardar'}
            </Button>
          </form>
        </CardContent>
      </Card>
      )}

      {/* Operator Alerts */}
      {activeTab === 'alerts' && (
      <Card>
        <CardHeader>
          <CardTitle>Alertas por email</CardTitle>
          <CardDescription>Avisos automáticos de avarias e quiosques offline</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveAlertsEmail} className="space-y-2 max-w-xs">
            <Label htmlFor="alertsEmail">Email para alertas</Label>
            <Input
              id="alertsEmail"
              type="email"
              placeholder="operador@exemplo.com"
              value={alertsEmail}
              onChange={(e) => setAlertsEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Recebe um email quando um quiosque não comunica com o servidor há
              mais de 15 minutos, ou quando um quiosque reporta uma avaria de
              hardware (hopper vazio, leitor desligado, etc.) enquanto está
              online. Deixe em branco para desativar. Não afeta o quiosque
              offline em si — só o aviso.
            </p>
            <Button type="submit" size="sm" disabled={savingAlertsEmail}>
              {savingAlertsEmail ? 'A guardar…' : 'Guardar'}
            </Button>
          </form>
        </CardContent>
      </Card>
      )}

      {/* WhatsApp cycle-complete notifications */}
      {activeTab === 'whatsapp' && (
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
          <CardDescription>Avisa o cliente por WhatsApp quando a lavagem/secagem termina</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 max-w-xl">
            <div>
              <div className="font-medium text-sm">Ativar notificações por WhatsApp</div>
              <p className="text-xs text-muted-foreground mt-1">
                Usa um número de WhatsApp real, ligado por QR code (como o WhatsApp
                Web) — sem custos, mas não é a API oficial: em uso muito intenso o
                número pode ser sinalizado pelo WhatsApp. Requer que o cartão do
                cliente tenha um número de telemóvel guardado.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={whatsappEnabled}
              onClick={() => toggleWhatsappEnabled(!whatsappEnabled)}
              disabled={savingWhatsappToggle}
              className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50
                ${whatsappEnabled ? 'bg-primary-600' : 'bg-neutral-300'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                  ${whatsappEnabled ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>

          {whatsappEnabled && (
            <div className="border-t pt-4 max-w-xs">
              {whatsappStatus.connected ? (
                <div className="space-y-2">
                  <p className="text-sm text-green-700 font-medium">Ligado ✓</p>
                  <Button type="button" variant="outline" size="sm" onClick={disconnectWhatsapp} disabled={disconnectingWhatsapp}>
                    {disconnectingWhatsapp ? 'A desligar…' : 'Desligar'}
                  </Button>
                </div>
              ) : whatsappStatus.qr ? (
                <div className="space-y-2">
                  <p className="text-sm">Leia este código com o WhatsApp do número que quer usar:</p>
                  <img src={whatsappStatus.qr} alt="QR code do WhatsApp" className="w-48 h-48 border rounded" />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">A gerar QR code…</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Advanced/Raw Settings */}
      {activeTab === 'advanced' && (
      <Card>
        <CardHeader>
          <CardTitle>Configurações Avançadas</CardTitle>
          <CardDescription>Só para chaves de configuração pontuais, fora do que já é gerido nos outros separadores.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={save} className="flex gap-2">
            <Input
              placeholder="Nome da chave"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="w-64"
            />
            <Input
              placeholder="Valor (aceita JSON)"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1"
            />
            <Button type="submit">Adicionar</Button>
          </form>

          <div className="border rounded-lg">
            {list.filter(s => !HIDDEN_ADVANCED_KEYS.has(s.key)).length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground text-center">
                Nenhuma configuração avulsa — as definições comuns têm o seu próprio separador acima.
              </p>
            ) : (
              <ul className="divide-y">
                {list.filter(s => !HIDDEN_ADVANCED_KEYS.has(s.key)).map((s) => (
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
                      Eliminar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  )
}

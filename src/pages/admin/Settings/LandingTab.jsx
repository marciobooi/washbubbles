import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowUp, ArrowDown, Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import LandingTranslations from '@/components/LandingTranslations'
import { DEFAULT_LANDING_CONTENT } from '@/lib/defaultLandingContent'

export default function LandingTab() {
  const [landingContent, setLandingContent] = useState(DEFAULT_LANDING_CONTENT)
  const [landingDefaults, setLandingDefaults] = useState(DEFAULT_LANDING_CONTENT)
  const [savingLanding, setSavingLanding] = useState(false)

  // Merges saved content onto the defaults field-by-field — mirrors
  // backend/src/views/landing.js's own mergeContent(), so a partial save (or
  // one from before a field existed) never leaves the form with a missing
  // section instead of falling back to real default copy.
  async function loadLandingContent() {
    try {
      // The starting page is the shop's own (a new shop gets a neutral one, never another shop's address or reviews)
      const dr = await api.request('/admin/landing/defaults', { method: 'GET', expect: 'json' }).catch(() => null)
      const D = (dr && dr.content) || DEFAULT_LANDING_CONTENT
      setLandingDefaults(D)
      const saved = await api.getSetting('landingPage.content').catch(() => null)
      const c = (saved && saved.value && typeof saved.value === 'object') ? saved.value : {}
      const items = (list, fallback) => (Array.isArray(list) && list.length ? list : fallback)
      const b = (c.brand && typeof c.brand === 'object') ? c.brand : {}
      setLandingContent({
        brand: {
          ...D.brand,
          ...b,
          address: { ...D.brand.address, ...(b.address || {}) },
          hours: { ...D.brand.hours, ...(b.hours || {}) },
          rating: { ...D.brand.rating, ...(b.rating || {}) },
          social: Array.isArray(b.social) ? b.social : D.brand.social,
        },
        hero: { ...D.hero, ...(c.hero || {}) },
        steps: { ...D.steps, ...(c.steps || {}), items: items(c.steps && c.steps.items, D.steps.items) },
        features: { ...D.features, ...(c.features || {}), items: items(c.features && c.features.items, D.features.items) },
        prices: { ...D.prices, ...(c.prices || {}) },
        cta: { ...D.cta, ...(c.cta || {}) },
        visit: { ...D.visit, ...(c.visit || {}) },
        reviews: {
          ...D.reviews,
          ...(c.reviews || {}),
          items: items(c.reviews && c.reviews.items, D.reviews.items),
        },
        customSections: Array.isArray(c.customSections) ? c.customSections : [],
      })
    } catch (e) { console.warn('loadLandingContent failed', e) }
  }

  useEffect(() => { loadLandingContent() }, [])

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
      toast({ title: 'Página inicial guardada', description: 'As traduções são atualizadas automaticamente (cerca de 1 minuto).', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao guardar a página inicial', variant: 'destructive' })
    } finally {
      setSavingLanding(false)
    }
  }

  return (
    <div className="space-y-4">
      <LandingTranslations />
      <Card>
        <CardHeader>
          <CardTitle>Hero</CardTitle>
          <CardDescription>O topo da página — a primeira coisa que o visitante vê</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="hero-eyebrow">Etiqueta</Label>
            <Input id="hero-eyebrow" value={landingContent.hero.eyebrow} onChange={(e) => updateHero('eyebrow', e.target.value)} placeholder="Ex: Lavandaria self-service" />
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
            <CardTitle>Preços</CardTitle>
            <CardDescription>A tabela vem sozinha da base de dados (Preços e Máquinas) — aqui só escreve o título e a introdução</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => toggleSectionVisible('prices')}>
            {landingContent.prices.visible
              ? (<><Eye className="h-4 w-4 mr-2" />Visível</>)
              : (<><EyeOff className="h-4 w-4 mr-2" />Oculto</>)}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Etiqueta</Label>
            <Input value={landingContent.prices.eyebrow} onChange={(e) => updateSectionField('prices', 'eyebrow', e.target.value)} />
          </div>
          <div>
            <Label>Título</Label>
            <Input value={landingContent.prices.heading} onChange={(e) => updateSectionField('prices', 'heading', e.target.value)} />
          </div>
          <div>
            <Label>Texto</Label>
            <Input value={landingContent.prices.description} onChange={(e) => updateSectionField('prices', 'description', e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">Mostra apenas tamanhos que tenham pelo menos uma máquina. Para mudar um preço, use a página Preços.</p>
        </CardContent>
      </Card>

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
                <div className="flex justify-end gap-2">
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

      <div className="flex items-center justify-end gap-2 pb-4">
        <Button type="button" onClick={saveLandingContent} disabled={savingLanding}>
          {savingLanding ? 'A guardar…' : 'Guardar Página Inicial'}
        </Button>
        <Button type="button" variant="outline" onClick={() => setLandingContent(landingDefaults)}>
          Repor predefinições
        </Button>
      </div>
    </div>
  )
}

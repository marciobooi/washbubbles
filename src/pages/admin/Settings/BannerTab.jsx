import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Image as ImageIcon, ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react'
import { DEFAULT_BANNERS } from '@/lib/defaultBanners'

export default function BannerTab() {
  const [bannerSlides, setBannerSlides] = useState(DEFAULT_BANNERS)
  const [savingBanners, setSavingBanners] = useState(false)
  const [uploadingBannerIdx, setUploadingBannerIdx] = useState(null)

  async function loadBannerSettings() {
    try {
      const saved = await api.getSetting('banners').catch(() => null)
      const value = saved && Array.isArray(saved.value) ? saved.value : null
      setBannerSlides(value && value.length > 0 ? value : DEFAULT_BANNERS)
    } catch (e) { console.warn('loadBannerSettings failed', e) }
  }

  useEffect(() => { loadBannerSettings() }, [])

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Banner da página inicial</CardTitle>
        <CardDescription>Imagens e texto do carrossel que os clientes veem ao chegar ao quiosque. Escreva o texto só em português: ao guardar, o servidor traduz sozinho para inglês, francês, alemão e espanhol.</CardDescription>
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

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={addBannerSlide}>
            <Plus className="h-4 w-4 mr-2" /> Adicionar slide
          </Button>
          <Button type="button" onClick={saveBanners} disabled={savingBanners}>
            {savingBanners ? 'A guardar…' : 'Guardar Banners'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

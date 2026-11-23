import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DEFAULT_LEGAL, DEFAULT_PRIVACY_PT, DEFAULT_TERMS_PT, mergeLegal } from '@/lib/defaultLegal'

export default function LegalTab() {
  const [legal, setLegal] = useState(DEFAULT_LEGAL)
  const [savingLegal, setSavingLegal] = useState(false)
  const [legalStatus, setLegalStatus] = useState({ state: 'never' })
  const [legalTranslations, setLegalTranslations] = useState({})

  async function loadLegalStatus() {
    try {
      const r = await api.request('/admin/legal/status', { method: 'GET', expect: 'json' })
      setLegalStatus({ ...(r.status || { state: 'never' }), translatorEnabled: r.translatorEnabled })
      setLegalTranslations(r.translations || {})
      return r.status?.state
    } catch (e) { return null }
  }

  // The server translates in the background; follow it until it finishes (a couple of minutes at most).
  async function followLegalTranslation() {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 4000))
      const state = await loadLegalStatus()
      if (state && state !== 'running') return
    }
  }

  async function loadLegal() {
    try {
      const saved = await api.getSetting('legal.info').catch(() => null)
      setLegal(mergeLegal(saved && saved.value))
      loadLegalStatus()
    } catch (e) { console.warn('loadLegal failed', e) }
  }

  useEffect(() => { loadLegal() }, [])

  async function saveLegal(e) {
    e && e.preventDefault()
    if (legal.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(legal.email)) {
      return toast({ title: 'Email inválido', variant: 'destructive' })
    }
    setSavingLegal(true)
    try {
      // only the Portuguese is authored; the other languages are produced by the server
      const value = { ...legal, privacy: { pt: legal.privacy.pt }, terms: { pt: legal.terms.pt } }
      await api.setSetting({ key: 'legal.info', value })
      toast({ title: 'Textos legais guardados', description: 'A traduzir para inglês, francês, alemão e espanhol…', variant: 'success' })
      setLegalStatus((s) => ({ ...s, state: 'running' }))
      followLegalTranslation()
    } catch (err) {
      console.error(err)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally { setSavingLegal(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Legal / RGPD</CardTitle>
        <CardDescription>Escreva só em português: ao guardar, o servidor traduz sozinho para inglês, francês, alemão e espanhol e o quiosque vai buscar o texto na língua do cliente</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={saveLegal} className="space-y-5 max-w-3xl">
          <div className="grid sm:grid-cols-2 gap-3">
            {[['company', 'Entidade responsável (nome legal)'], ['nif', 'NIF'], ['address', 'Morada'], ['phone', 'Telefone de contacto'], ['email', 'Email de contacto (direitos RGPD)'], ['complaintsUrl', 'Endereço do Livro de Reclamações online']].map(([k, label]) => (
              <div key={k} className={k === 'address' || k === 'complaintsUrl' ? 'sm:col-span-2' : ''}>
                <Label htmlFor={`legal-${k}`}>{label}</Label>
                <Input id={`legal-${k}`} value={legal[k] || ''} onChange={(e) => setLegal((l) => ({ ...l, [k]: e.target.value }))} />
              </div>
            ))}
          </div>

          <div>
            <Label htmlFor="legal-privacy">Política de Privacidade (RGPD) — português</Label>
            <textarea id="legal-privacy" rows={14} className="w-full rounded-md border p-3 text-sm"
              value={legal.privacy.pt || ''}
              onChange={(e) => setLegal((l) => ({ ...l, privacy: { ...l.privacy, pt: e.target.value } }))} />
            <button type="button" className="text-xs underline text-primary-700 hover:text-primary-900 mt-1 transition-colors focus-visible:outline-2 focus-visible:outline-primary-500 rounded" onClick={() => setLegal((l) => ({ ...l, privacy: { ...l.privacy, pt: DEFAULT_PRIVACY_PT } }))}>Repor o texto modelo</button>
          </div>

          <div>
            <Label htmlFor="legal-terms">Termos e Regras de Utilização — português</Label>
            <textarea id="legal-terms" rows={14} className="w-full rounded-md border p-3 text-sm"
              value={legal.terms.pt || ''}
              onChange={(e) => setLegal((l) => ({ ...l, terms: { ...l.terms, pt: e.target.value } }))} />
            <button type="button" className="text-xs underline text-primary-700 hover:text-primary-900 mt-1 transition-colors focus-visible:outline-2 focus-visible:outline-primary-500 rounded" onClick={() => setLegal((l) => ({ ...l, terms: { ...l.terms, pt: DEFAULT_TERMS_PT } }))}>Repor o texto modelo</button>
          </div>

          <p className="text-xs text-muted-foreground">
            Formato: uma linha que começa por <code>## </code> é um título de secção e uma linha que começa por <code>- </code> é um ponto de lista.
            Os textos são <b>modelos</b> para uma lavandaria self-service em Portugal: confirme o que se aplica ao seu espaço antes de os publicar
            (por exemplo horário, videovigilância — se tiver câmaras tem de informar —, avarias, peças esquecidas, reembolsos) e, se possível, reveja-os com quem trata do RGPD.
          </p>

          {/* one button: saves and translates into every language; this line only reports how it went */}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={savingLegal || legalStatus.state === 'running'}>
              {savingLegal || legalStatus.state === 'running' ? 'A traduzir para inglês, francês, alemão e espanhol…' : 'Guardar e traduzir'}
            </Button>
            <span className="text-sm text-neutral-600">
              {legalStatus.state === 'done' && `Traduzido (EN, FR, DE, ES)${legalStatus.finishedAt ? ' — ' + new Date(legalStatus.finishedAt).toLocaleString('pt-PT') : ''}`}
              {legalStatus.state === 'partial' && 'Algumas línguas falharam — carregue outra vez em Guardar e traduzir'}
              {legalStatus.state === 'error' && 'Não foi possível traduzir — carregue outra vez em Guardar e traduzir'}
              {legalStatus.state === 'never' && 'Ainda não traduzido'}
            </span>
          </div>
          {legalStatus.translatorEnabled === false && (
            <p className="text-xs text-red-700">O tradutor automático não está configurado neste servidor (TRANSLATE_URL).</p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

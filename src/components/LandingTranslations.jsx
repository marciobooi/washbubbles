import React, { useEffect, useState, useCallback } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
]

const fmtDate = (d) => {
  try { return new Date(d).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) } catch { return '' }
}

/**
 * The public page exists in English, French, German and Spanish too. The text written above is
 * translated automatically (free, self-hosted LibreTranslate) every time it is saved; this panel shows
 * how that went and lets the admin run it again.
 */
export default function LandingTranslations() {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setInfo(await api.request('/admin/landing/translations', { method: 'GET', expect: 'json' })) } catch { /* not allowed or offline: the panel just stays empty */ }
  }, [])

  useEffect(() => { load() }, [load])
  // While a translation is running, look again every few seconds.
  useEffect(() => {
    if (info?.status?.state !== 'running') return undefined
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [info?.status?.state, load])

  async function translateNow() {
    setBusy(true)
    try {
      await api.request('/admin/landing/translate', { method: 'POST', expect: 'json' })
      toast({ title: 'A traduzir a página…', description: 'Demora cerca de um minuto.', variant: 'success' })
      setTimeout(load, 800)
    } catch (e) {
      toast({ title: 'Não foi possível traduzir', description: e?.message || String(e), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (!info) return null
  const { enabled, status, langs } = info
  const running = status?.state === 'running'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Traduções automáticas</CardTitle>
        <CardDescription>
          A página também existe em inglês, francês, alemão e espanhol. Ao guardar a página inicial, o texto abaixo é traduzido
          automaticamente. O nome, a morada, o telefone e o horário não são traduzidos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!enabled && (
          <p className="text-sm text-amber-700">A tradução automática não está ativa neste servidor — a página só aparece em português.</p>
        )}
        <ul className="space-y-1.5">
          {LANGS.map((l) => {
            const stored = langs?.[l.code]
            const failed = status?.failed?.[l.code]
            return (
              <li key={l.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="w-24 font-medium">{l.label}</span>
                {stored ? (
                  <>
                    <span className="text-emerald-700">traduzido {fmtDate(stored.at)}</span>
                    <a className="underline text-primary-700" href={`/${l.code}`} target="_blank" rel="noopener noreferrer">ver /{l.code}</a>
                  </>
                ) : (
                  <span className="text-neutral-500">ainda sem tradução</span>
                )}
                {failed && <span className="text-red-600">falhou: {failed}</span>}
              </li>
            )
          })}
        </ul>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" disabled={!enabled || busy || running} onClick={translateNow}>
            {running ? 'A traduzir…' : 'Traduzir agora'}
          </Button>
          {status?.state === 'error' && <span className="text-sm text-red-600">A última tentativa falhou. Tente de novo dentro de momentos.</span>}
        </div>
      </CardContent>
    </Card>
  )
}

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

const COLS = [
  { key: 'pt', label: 'Português' },
  { key: 'en', label: 'English' },
  { key: 'fr', label: 'Français' },
  { key: 'de', label: 'Deutsch' },
  { key: 'es', label: 'Español' },
]

/**
 * The small dictionary behind the translations: words and phrases that the free translator gets wrong. A text that is
 * exactly a row is not machine translated at all; a row's words inside a longer text are always rendered as written
 * here. Saving it translates the page again. Once saved, this list replaces the built-in one ("Repor" brings it back).
 */
function GlossaryEditor({ onSaved }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null) // { entries, isDefault }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setData(await api.request('/admin/landing/glossary', { method: 'GET', expect: 'json' })) } catch (e) { toast({ title: 'Não foi possível abrir o dicionário', description: e?.message, variant: 'destructive' }) }
  }, [])
  useEffect(() => { if (open && !data) load() }, [open, data, load])

  const setCell = (i, key, value) => setData((d) => ({ ...d, entries: d.entries.map((r, k) => (k === i ? { ...r, [key]: value } : r)) }))
  const addRow = () => setData((d) => ({ ...d, entries: [{ pt: '', en: '', fr: '', de: '', es: '' }, ...d.entries] }))
  const removeRow = (i) => setData((d) => ({ ...d, entries: d.entries.filter((_, k) => k !== i) }))

  async function save() {
    setBusy(true)
    try {
      const r = await api.request('/admin/landing/glossary', { method: 'PUT', json: { entries: data.entries }, expect: 'json' })
      setData({ entries: r.entries, isDefault: false })
      toast({ title: 'Dicionário guardado', description: 'A traduzir a página outra vez (cerca de 2 minutos).', variant: 'success' })
      onSaved && onSaved()
    } catch (e) {
      toast({ title: 'Não foi possível guardar', description: e?.message || String(e), variant: 'destructive' })
    } finally { setBusy(false) }
  }
  async function reset() {
    if (!window.confirm('Repor o dicionário predefinido? As suas alterações ao dicionário perdem-se.')) return
    setBusy(true)
    try {
      const r = await api.request('/admin/landing/glossary', { method: 'DELETE', expect: 'json' })
      setData({ entries: r.entries, isDefault: true })
      toast({ title: 'Dicionário predefinido reposto', variant: 'success' })
      onSaved && onSaved()
    } catch (e) {
      toast({ title: 'Não foi possível repor', description: e?.message || String(e), variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <div className="border-t pt-3">
      <button type="button" className="text-sm font-medium underline underline-offset-2 transition-colors hover:text-[var(--primary,#0d9488)] focus-visible:outline-2 focus-visible:outline-[var(--primary,#0d9488)] rounded" onClick={() => setOpen((o) => !o)}>
        {open ? 'Fechar o dicionário' : 'Dicionário de traduções (palavras que o tradutor automático erra)'}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Escreva em português uma palavra ou frase e como deve ficar em cada língua. Se um texto da página for exatamente uma linha,
            usa-se a sua tradução; se a linha estiver dentro de um texto maior, essa parte fica sempre como escreveu. Deixe uma língua em branco
            para a traduzir automaticamente. Em alemão, francês e espanhol prefira frases com o artigo (&quot;o seu cartão&quot;).
            {data?.isDefault ? ' (Esta é a lista predefinida.)' : ''}
          </p>
          {!data ? <p className="text-sm text-neutral-500">A abrir…</p> : (
            <>
              <div className="max-h-[420px] overflow-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr>
                      {COLS.map((c) => <th key={c.key} className="text-left font-semibold px-2 py-2">{c.label}</th>)}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((row, i) => (
                      <tr key={i} className="border-t">
                        {COLS.map((c) => (
                          <td key={c.key} className="px-1 py-1">
                            <input
                              className="w-full min-w-[110px] rounded border border-neutral-200 px-2 py-1"
                              value={row[c.key] || ''}
                              onChange={(e) => setCell(i, c.key, e.target.value)}
                              aria-label={`${c.label}: linha ${i + 1}`}
                            />
                          </td>
                        ))}
                        <td className="px-1 text-center">
                          <button type="button" className="text-red-600 text-base leading-none rounded p-1 transition-colors hover:text-[#be123c] hover:bg-[#fff1f2] focus-visible:outline-2 focus-visible:outline-[#be123c]" onClick={() => removeRow(i)} aria-label={`Apagar linha ${i + 1}`} title="Apagar">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addRow}>Adicionar linha</Button>
                <Button type="button" size="sm" disabled={busy} onClick={save}>Guardar e traduzir de novo</Button>
                <Button type="button" variant="outline" size="sm" disabled={busy || data.isDefault} onClick={reset}>Repor predefinição</Button>
                <span className="text-xs text-neutral-500">{data.entries.length} linhas</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

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
        <GlossaryEditor onSaved={() => setTimeout(load, 1200)} />
      </CardContent>
    </Card>
  )
}

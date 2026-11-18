import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** The switches: which alerts and reports the admin wants by e-mail. The list comes from the server (services/alertTypes.js). */
export default function AlertPrefsCard() {
  const [catalog, setCatalog] = useState(null)
  const [prefs, setPrefs] = useState({})
  const [saved, setSaved] = useState({})
  const [saving, setSaving] = useState(false)

  async function load() {
    try {
      const c = await api.request('/admin/alerts/catalog', { method: 'GET', expect: 'json' })
      setCatalog(c)
      setPrefs(c.prefs)
      setSaved(c.prefs)
    } catch (e) {
      console.error(e)
      toast({ title: 'Não foi possível carregar a lista de alertas', variant: 'destructive' })
    }
  }
  useEffect(() => { load() }, [])

  if (!catalog) return null
  const dirty = catalog.types.some((t) => prefs[t.key] !== saved[t.key])

  function toggle(t) {
    const on = !prefs[t.key]
    // turning off an alert about a customer's money: ask first
    if (!on && t.critical && !confirm(`"${t.label}" avisa quando há dinheiro de um cliente em causa.\n\nSe o desligar, pode haver clientes sem serviço ou sem troco que ninguém vê. Desligar mesmo assim?`)) return
    setPrefs((p) => ({ ...p, [t.key]: on }))
  }
  function setGroup(group, on) {
    const list = catalog.types.filter((t) => t.group === group)
    if (!on && list.some((t) => t.critical) && !confirm('Este grupo inclui alertas sobre dinheiro de clientes. Desligar todos mesmo assim?')) return
    setPrefs((p) => ({ ...p, ...Object.fromEntries(list.map((t) => [t.key, on])) }))
  }

  async function save() {
    setSaving(true)
    try {
      const r = await api.request('/admin/alerts/prefs', { method: 'PUT', json: { prefs }, expect: 'json' })
      setPrefs(r.prefs); setSaved(r.prefs)
      toast({ title: 'Alertas guardados', variant: 'success' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>O que quer receber</CardTitle>
        <CardDescription>Escolha cada alerta e relatório. O que não estiver nesta lista é sempre enviado, para nunca ficar nada em silêncio por engano.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {catalog.groups.map((g) => {
          const list = catalog.types.filter((t) => t.group === g.key)
          if (!list.length) return null
          const allOn = list.every((t) => prefs[t.key])
          return (
            <div key={g.key}>
              <div className="flex items-center justify-between gap-3 border-b pb-2 mb-1">
                <div className="font-semibold text-slate-800">{g.label}</div>
                <button type="button" onClick={() => setGroup(g.key, !allOn)} className="text-xs font-semibold text-emerald-700 hover:underline">
                  {allOn ? 'Desligar todos' : 'Ligar todos'}
                </button>
              </div>
              <ul className="divide-y">
                {list.map((t) => (
                  <li key={t.key} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">
                        {t.label}
                        {t.critical && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">dinheiro</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{t.help}</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!prefs[t.key]}
                      aria-label={t.label}
                      onClick={() => toggle(t)}
                      className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${prefs[t.key] ? 'bg-emerald-400' : 'bg-neutral-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${prefs[t.key] ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
        <div className="flex gap-2">
          <Button type="button" onClick={save} disabled={!dirty || saving}>{saving ? 'A guardar…' : 'Guardar escolhas'}</Button>
          <Button type="button" variant="outline" onClick={() => setPrefs(saved)} disabled={!dirty || saving}>Reverter</Button>
        </div>
      </CardContent>
    </Card>
  )
}

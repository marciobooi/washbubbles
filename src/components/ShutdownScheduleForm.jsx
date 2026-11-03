import React, { useEffect, useState } from 'react'
import { shopDayKey } from '@/lib/shopTime'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const KEY = 'schedule.shutdown'
// index = Date.getDay() (0 = Sunday), shown Monday first
const NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const ORDER = [1, 2, 3, 4, 5, 6, 0]
const blank = () => Array.from({ length: 7 }, () => ({ enabled: true, time: '23:30' }))
const today = () => shopDayKey() // the PC runs on the shop's clock, so "today" is the shop's day

/** Shutdown of the shop PC at night (done by the PC itself: backend/src/services/shutdownScheduler.js). */
export default function ShutdownScheduleForm() {
  const [cfg, setCfg] = useState({ enabled: false, days: blank(), skipDate: null })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.getSetting(KEY).then((r) => {
      const v = r && r.value && typeof r.value === 'object' ? r.value : null
      if (!v) return
      // an older setting had one time for every day
      const days = Array.isArray(v.days) && v.days.length === 7 ? v.days : Array.from({ length: 7 }, () => ({ enabled: true, time: v.time || '23:30' }))
      setCfg({ enabled: !!v.enabled, days, skipDate: v.skipDate || null })
    }).catch(() => {})
  }, [])

  async function save(next, okTitle) {
    setBusy(true)
    try { await api.setSetting({ key: KEY, value: next }); setCfg(next); toast({ title: okTitle, variant: 'success' }) }
    catch (err) { toast({ title: err?.body?.error || err?.message || 'Não foi possível guardar', variant: 'destructive' }) }
    finally { setBusy(false) }
  }
  const setDay = (i, patch) => setCfg((c) => ({ ...c, days: c.days.map((d, k) => (k === i ? { ...d, ...patch } : d)) }))
  const copyFirst = () => setCfg((c) => { const t = c.days[ORDER[0]].time; return { ...c, days: c.days.map((d) => ({ ...d, time: t })) } })
  const skipped = cfg.skipDate === today()

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Desligar o computador à noite</CardTitle>
        <CardDescription>Desliga sozinho, com cuidado, à hora definida em cada dia — ou fica sempre ligado</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 max-w-xl">
        <div className="flex flex-col gap-2 text-sm font-medium">
          <label className="flex items-center gap-2"><input type="radio" name="shutdownMode" checked={!cfg.enabled} onChange={() => setCfg({ ...cfg, enabled: false })} /> Sempre ligado (24 horas)</label>
          <label className="flex items-center gap-2"><input type="radio" name="shutdownMode" checked={!!cfg.enabled} onChange={() => setCfg({ ...cfg, enabled: true })} /> Desligar à hora marcada</label>
        </div>

        {cfg.enabled && (
          <div className="rounded-lg border divide-y">
            {ORDER.map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <label className="flex items-center gap-2 w-36 text-sm"><input type="checkbox" checked={!!cfg.days[i].enabled} onChange={(e) => setDay(i, { enabled: e.target.checked })} />{NAMES[i]}</label>
                {cfg.days[i].enabled
                  ? <Input type="time" className="w-32" value={cfg.days[i].time} onChange={(e) => setDay(i, { time: e.target.value })} />
                  : <span className="text-xs text-muted-foreground">fica ligado</span>}
              </div>
            ))}
            <div className="px-3 py-2"><button type="button" className="text-xs underline" onClick={copyFirst}>Usar a hora de segunda em todos os dias</button></div>
          </div>
        )}

        <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
          <li>Nos últimos 3 minutos aparece no ecrã do quiosque uma contagem decrescente animada («O quiosque vai desligar»). Um toque esconde-a (o cliente pode estar a pagar) e volta no último minuto.</li>
          <li>Se um cliente ainda tiver crédito na máquina, espera até 10 minutos.</li>
          <li>Fecha por ordem: envia as vendas em falta ao servidor, fecha o ecrã do quiosque, pára os programas e a base de dados, e só depois o Windows desliga (10 segundos; para cancelar: <code>shutdown /a</code>).</li>
          <li><b>Se a tomada tem um relógio que corta a corrente</b> (por exemplo às 23:40): ponha aqui uma hora pelo menos <b>15 minutos antes</b> (por exemplo 23:25). Se a corrente cortar antes de o Windows desligar, o computador desliga-se à bruta.</li>
          <li><b>Para ligar de manhã:</b> no BIOS do computador ative «ao voltar a corrente, ligar» (Restore on AC Power Loss = Power On). Assim, quando a tomada volta a dar corrente (por exemplo às 7:00), o computador arranca sozinho. O programa não consegue ligar um computador desligado.</li>
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => save(cfg, cfg.enabled ? 'Horário de desligar guardado' : 'Sempre ligado')}>Guardar</Button>
          {cfg.enabled && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => save({ ...cfg, skipDate: skipped ? null : today() }, skipped ? 'Hoje volta a desligar à hora marcada' : 'Hoje não desliga')}>
              {skipped ? 'Voltar a desligar hoje' : 'Não desligar hoje'}
            </Button>
          )}
        </div>
        {skipped && <p className="text-xs text-amber-700">Hoje não vai desligar (só hoje).</p>}
      </CardContent>
    </Card>
  )
}

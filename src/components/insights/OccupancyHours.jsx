import React, { useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { CARD_CLASS } from './fmt'

const pad = (h) => String(h).padStart(2, '0')

function HoursEditor({ open, close, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [o, setO] = useState(open)
  const [c, setC] = useState(close)
  const [saving, setSaving] = useState(false)
  const valid = Number.isInteger(o) && Number.isInteger(c) && o >= 0 && o <= 23 && c >= 0 && c <= 23 && c > o

  async function save() {
    setSaving(true)
    try {
      await api.setSetting({ key: 'shop.hours', value: { open: o, close: c } })
      toast({ title: 'Horário guardado', variant: 'success' })
      setEditing(false)
      onSaved?.()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao guardar o horário', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => { setO(open); setC(close); setEditing(true) }} className="text-xs font-semibold text-[#0d6b60] underline cursor-pointer bg-transparent border-0 p-0">
        Alterar horário
      </button>
    )
  }
  const inp = 'h-8 w-16 rounded-lg border border-black/10 bg-white px-2 text-sm'
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1">Abre às <input type="number" min={0} max={23} value={Number.isNaN(o) ? '' : o} onChange={(e) => setO(parseInt(e.target.value, 10))} className={inp} />h</label>
      <label className="flex items-center gap-1">Fecha às <input type="number" min={0} max={23} value={Number.isNaN(c) ? '' : c} onChange={(e) => setC(parseInt(e.target.value, 10))} className={inp} />h</label>
      <button type="button" disabled={!valid || saving} onClick={save} className="h-8 px-3 rounded-full bg-[#0c2b26] text-white font-semibold transition-colors hover:bg-[color-mix(in_srgb,#0c2b26_88%,black)] focus-visible:outline-2 focus-visible:outline-[var(--primary,#0d9488)] disabled:opacity-40 cursor-pointer">Guardar</button>
      <button type="button" onClick={() => setEditing(false)} className="h-8 px-3 rounded-full border border-black/[0.12] bg-white font-semibold transition-colors hover:bg-white hover:border-[var(--primary,#0d9488)] hover:text-[var(--primary,#0d9488)] focus-visible:outline-2 focus-visible:outline-[var(--primary,#0d9488)] cursor-pointer">Cancelar</button>
      {!valid && <span className="text-[#b91c1c]">O fecho tem de ser depois da abertura (0-23).</span>}
    </div>
  )
}

export default function OccupancyHours({ data, onSaved }) {
  const hours = data?.hours
  if (!hours) return null
  const { configured, typicalFirst, typicalLast } = hours
  const byHour = new Map((hours.hourly || []).map((x) => [x.hour, x]))
  const list = Array.from({ length: 24 }, (_, h) => byHour.get(h) || { hour: h, cycles: 0, occupancyPct: 0 })
  const max = Math.max(10, ...list.map((x) => x.occupancyPct || 0))

  return (
    <div className={`${CARD_CLASS} flex flex-col gap-3 min-w-0`}>
      <div>
        <h3 className="m-0 mb-0.5 text-[16px] font-extrabold">Ocupação por hora</h3>
        <p className="m-0 text-xs text-[#8a8478]">Percentagem das máquinas ocupadas em cada hora · no período ({hours.days} {hours.days === 1 ? 'dia' : 'dias'})</p>
      </div>
      <div className="flex items-end gap-[3px] h-[130px]">
        {list.map((x, i) => {
          const inside = x.hour >= configured.open && x.hour < configured.close
          const side = i < 6 ? 'left-0' : i > 17 ? 'right-0' : 'left-1/2 -translate-x-1/2'
          return (
            <div key={x.hour} className="group relative flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1">
              <div className="w-full flex-1 flex items-end">
                <div className={`w-full rounded-t ${inside ? 'bg-primary-500' : 'bg-[#d6d2c8]'} group-hover:opacity-80`} style={{ height: `${Math.max(2, (x.occupancyPct / max) * 100)}%` }} />
              </div>
              <div className="h-3 text-[9px] sm:text-[10px] text-[#8a8478] leading-3">{x.hour % 3 === 0 ? pad(x.hour) : ''}</div>
              <div className={`hidden group-hover:block absolute bottom-full mb-1 z-20 w-max max-w-[220px] ${side} rounded-xl bg-[#1c2530] text-white text-xs px-3 py-2 shadow-lg pointer-events-none`}>
                {pad(x.hour)}h: {x.cycles} ciclos · {Math.round(x.occupancyPct)}% das máquinas ocupadas
              </div>
            </div>
          )
        })}
      </div>
      <p className="m-0 text-[12.5px] text-[#8a8478]">
        Aberto das {configured.open}h às {configured.close}h (configurado)
        {typicalFirst != null && typicalLast != null ? <> · primeiro pagamento típico às {typicalFirst}h, último às {typicalLast}h</> : null}
      </p>
      <HoursEditor key={`${configured.open}-${configured.close}`} open={configured.open} close={configured.close} onSaved={onSaved} />
    </div>
  )
}

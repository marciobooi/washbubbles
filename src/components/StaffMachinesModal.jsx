import React, { useEffect, useState, useCallback } from 'react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'

function getKioskApiKey() {
  const electronKey = typeof window !== 'undefined' && window.electronAPI?.kioskKey ? window.electronAPI.kioskKey() : null
  return electronKey || (typeof localStorage !== 'undefined' ? localStorage.getItem('kiosk_api_key') : null) || import.meta.env.VITE_KIOSK_API_KEY
}

const STATUS = {
  free: { label: 'Livre', dot: 'bg-teal-500' },
  working: { label: 'Ocupada', dot: 'bg-amber-500' },
  reserved: { label: 'Reservada', dot: 'bg-indigo-500' },
  fault: { label: 'Avariada', dot: 'bg-red-500' },
  offline: { label: 'Offline', dot: 'bg-slate-400' },
}

/**
 * Staff screen on the kiosk: put a machine to work by hand (no payment) or release it, behind the staff PIN.
 * A dryer asks for the number of cycles, like a customer's purchase (1 to 8).
 * `pin` is the staff PIN already accepted to reach this screen; the server checks it again on every action.
 */
export default function StaffMachinesModal({ open, onClose, pin }) {
  const [machines, setMachines] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [dry, setDry] = useState(null) // { m, blocks }
  const [confirmStop, setConfirmStop] = useState(null)

  const load = useCallback(async () => {
    try {
      const list = await api.getPublicMachines(undefined, { apiKey: getKioskApiKey() })
      setMachines((Array.isArray(list) ? list : []).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt', { numeric: true })))
    } catch { /* keep what is shown; the next refresh tries again */ } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    load()
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [open, load])

  async function run(m, kind, blocks = 1) {
    setBusyId(m._id)
    try {
      const body = kind === 'start' ? { pin, blocks } : { pin }
      if (kind === 'start') await api.staffStartMachine(m._id, body, { apiKey: getKioskApiKey() })
      else await api.staffEndMachine(m._id, body, { apiKey: getKioskApiKey() })
      toast({ title: kind === 'start' ? `${m.name} iniciada${blocks > 1 ? ` (${blocks} ciclos)` : ''}` : `${m.name} libertada`, variant: 'success' })
      await load()
    } catch (e) {
      toast({ title: kind === 'start' ? 'Não foi possível iniciar' : 'Não foi possível parar', description: e?.body?.error || e?.message, variant: 'destructive' })
    } finally { setBusyId(null) }
  }

  const stopTap = (m) => {
    if (confirmStop === m._id) { setConfirmStop(null); run(m, 'end'); return }
    setConfirmStop(m._id)
    setTimeout(() => setConfirmStop((c) => (c === m._id ? null : c)), 4000)
  }

  const gap = (m) => (Number(m?.tImp) > 0 ? Number(m.tImp) : 15)
  const setBlocks = (b) => setDry((d) => ({ ...d, blocks: Math.min(8, Math.max(1, b)) }))

  return (
    <Modal open={open} onClose={onClose} title="Máquinas" wide>
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">Iniciar ou libertar uma máquina sem pagamento. As secadoras perguntam quantos ciclos.</p>
        {loading ? <div className="py-8 text-center text-neutral-500">A carregar…</div> : (
          <div className="grid grid-cols-2 gap-3">
            {machines.map((m) => {
              const st = m.outOfService ? STATUS.offline : (STATUS[m.status] || STATUS.free)
              const canStart = !m.outOfService && m.status !== 'working' && m.status !== 'fault' && m.status !== 'offline'
              return (
                <div key={m._id} className="rounded-2xl border border-neutral-200 p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-lg">{m.name}</div>
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700"><span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />{m.outOfService ? 'Fora de serviço' : st.label}</div>
                  </div>
                  {canStart && (
                    <button disabled={busyId === m._id} onClick={() => (m.type === 'dry' ? setDry({ m, blocks: 1 }) : run(m, 'start'))} className="h-14 rounded-xl bg-teal-600 text-white text-xl font-bold disabled:opacity-50 active:scale-95">Iniciar</button>
                  )}
                  {m.status === 'working' && (
                    <button disabled={busyId === m._id} onClick={() => stopTap(m)} className={`h-14 rounded-xl text-xl font-bold disabled:opacity-50 active:scale-95 ${confirmStop === m._id ? 'bg-red-600 text-white' : 'border border-neutral-300 text-neutral-800'}`}>{confirmStop === m._id ? 'Confirmar parar?' : 'Parar'}</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <button onClick={onClose} className="w-full py-3 rounded-xl border text-lg">Fechar</button>
      </div>

      {dry && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="m-0 mb-1 text-xl font-extrabold">Iniciar {dry.m.name}</h3>
            <p className="m-0 mb-4 text-neutral-600">Quantos ciclos de {gap(dry.m)} min?</p>
            <div className="flex items-center justify-center gap-5 mb-2">
              <button type="button" aria-label="Menos um ciclo" onClick={() => setBlocks(dry.blocks - 1)} disabled={dry.blocks <= 1} className="w-16 h-16 rounded-full border text-4xl font-bold disabled:opacity-40">−</button>
              <div className="text-center min-w-[110px]"><div className="text-5xl font-extrabold tabular-nums">{dry.blocks}</div><div className="text-sm text-neutral-500">{dry.blocks === 1 ? 'ciclo' : 'ciclos'}</div></div>
              <button type="button" aria-label="Mais um ciclo" onClick={() => setBlocks(dry.blocks + 1)} disabled={dry.blocks >= 8} className="w-16 h-16 rounded-full border text-4xl font-bold disabled:opacity-40">+</button>
            </div>
            <div className="text-center text-lg font-semibold mb-5">{dry.blocks * gap(dry.m)} min no total</div>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setDry(null)} className="h-14 rounded-xl border text-lg font-semibold">Cancelar</button>
              <button type="button" onClick={() => { const d = dry; setDry(null); run(d.m, 'start', d.blocks) }} className="h-14 rounded-xl bg-teal-600 text-white text-xl font-bold">Iniciar</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

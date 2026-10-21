import React, { useEffect, useState, useCallback } from 'react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import { WasherIcon, DryerIcon } from './icons/MachineIcons'

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

  const isFree = (m) => !m.outOfService && m.status !== 'working' && m.status !== 'fault' && m.status !== 'offline' && m.status !== 'reserved'
  const wash = machines.filter((m) => (m.type || 'wash') !== 'dry')
  const dryers = machines.filter((m) => m.type === 'dry')
  const freeCount = machines.filter(isFree).length
  const workingCount = machines.filter((m) => m.status === 'working').length

  const Tile = ({ m }) => {
    const working = m.status === 'working'
    const free = isFree(m)
    const stopping = confirmStop === m._id
    const label = m.outOfService ? 'Fora de serviço' : m.status === 'fault' ? 'Avariada' : m.status === 'reserved' ? 'Reservada' : m.status === 'offline' ? 'Offline' : working ? 'Ocupada' : 'Livre'
    const tone = working
      ? (stopping ? 'border-red-500 bg-red-50' : 'border-amber-300 bg-amber-50')
      : free ? 'border-teal-200 bg-white active:bg-teal-50' : 'border-neutral-200 bg-neutral-100 opacity-60'
    const dot = working ? 'bg-amber-500' : free ? 'bg-teal-500' : 'bg-neutral-400'
    const Icon = m.type === 'dry' ? DryerIcon : WasherIcon
    const action = working ? (stopping ? 'Confirmar?' : 'Parar') : free ? 'Iniciar' : null
    const pill = working ? (stopping ? 'bg-red-600 text-white' : 'bg-white text-amber-800 border border-amber-300') : 'bg-teal-600 text-white'
    return (
      <button
        type="button"
        disabled={busyId === m._id || (!working && !free)}
        onClick={() => (working ? stopTap(m) : m.type === 'dry' ? setDry({ m, blocks: 1 }) : run(m, 'start'))}
        className={`flex flex-col items-center gap-2 rounded-3xl border-2 px-3 pt-4 pb-3 text-center transition active:scale-[0.97] disabled:cursor-default ${tone}`}
      >
        <Icon animated={working} className="w-16 h-16" />
        <div className="text-xl font-extrabold text-neutral-800 leading-tight">{m.name}</div>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-neutral-600"><span className={`w-2.5 h-2.5 rounded-full ${dot}`} />{label}</div>
        <div className="h-9 flex items-center">
          {action && <span className={`px-5 py-1.5 rounded-full text-base font-bold ${pill}`}>{busyId === m._id ? '…' : action}</span>}
        </div>
      </button>
    )
  }

  const Section = ({ title, list }) => (list.length === 0 ? null : (
    <section>
      <h3 className="m-0 mb-2 text-sm font-bold uppercase tracking-wider text-neutral-500">{title}</h3>
      <div className="grid grid-cols-3 gap-3">
        {list.map((m) => <Tile key={m._id} m={m} />)}
      </div>
    </section>
  ))

  return (
    <Modal open={open} onClose={onClose} title="Máquinas" wide>
      <div className="space-y-5">
        <header className="pr-14">
          <h2 className="m-0 text-3xl font-extrabold text-neutral-800">Máquinas</h2>
          <p className="m-0 mt-1 text-base text-neutral-500">
            {loading ? 'A carregar…' : `${freeCount} ${freeCount === 1 ? 'livre' : 'livres'} · ${workingCount} ${workingCount === 1 ? 'ocupada' : 'ocupadas'}`}
            <span className="block text-sm mt-0.5">Toque numa máquina livre para a iniciar, ou numa ocupada para a libertar.</span>
          </p>
        </header>
        {!loading && (
          <>
            <Section title="Lavagem" list={wash} />
            <Section title="Secagem" list={dryers} />
          </>
        )}
      </div>

      {dry && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-1">
              <DryerIcon animated={false} className="w-12 h-12" />
              <h3 className="m-0 text-2xl font-extrabold">{dry.m.name}</h3>
            </div>
            <p className="m-0 mb-4 text-neutral-600">Quantos ciclos de {gap(dry.m)} min?</p>
            <div className="flex items-center justify-center gap-5 mb-2">
              <button type="button" aria-label="Menos um ciclo" onClick={() => setBlocks(dry.blocks - 1)} disabled={dry.blocks <= 1} className="w-16 h-16 rounded-full border-2 text-4xl font-bold disabled:opacity-40 active:scale-95">−</button>
              <div className="text-center min-w-[110px]"><div className="text-6xl font-extrabold tabular-nums">{dry.blocks}</div><div className="text-sm text-neutral-500">{dry.blocks === 1 ? 'ciclo' : 'ciclos'}</div></div>
              <button type="button" aria-label="Mais um ciclo" onClick={() => setBlocks(dry.blocks + 1)} disabled={dry.blocks >= 8} className="w-16 h-16 rounded-full border-2 text-4xl font-bold disabled:opacity-40 active:scale-95">+</button>
            </div>
            <div className="text-center text-lg font-semibold mb-5">{dry.blocks * gap(dry.m)} min no total</div>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setDry(null)} className="h-14 rounded-2xl border-2 text-lg font-semibold active:scale-95">Cancelar</button>
              <button type="button" onClick={() => { const d = dry; setDry(null); run(d.m, 'start', d.blocks) }} className="h-14 rounded-2xl bg-teal-600 text-white text-xl font-bold active:scale-95">Iniciar</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

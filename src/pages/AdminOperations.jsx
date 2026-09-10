import React from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import { Play, Square, X, Power, Wrench, CheckCircle2, RefreshCw } from 'lucide-react'
import { connect, subscribe } from '@/services/websocket'

function WashIcon(props) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7" {...props}>
      <rect x="4" y="3" width="16" height="18" rx="4" />
      <circle cx="12" cy="13" r="5" />
      <line x1="8" y1="6" x2="10" y2="6" />
    </svg>
  )
}

function DryIcon(props) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7" {...props}>
      <rect x="4" y="3" width="16" height="18" rx="4" />
      <circle cx="12" cy="13" r="5" />
      <line x1="9.3" y1="10.3" x2="14.7" y2="15.7" />
      <line x1="14.7" y1="10.3" x2="9.3" y2="15.7" />
    </svg>
  )
}

// Status dot colour + Portuguese label, keyed by the machine's real status enum.
const DOT_COLOR = { free: '#14b8a6', working: '#f59e0b', offline: '#94a3b8', fault: '#ef4444', reserved: '#6366f1' }
const STATUS_LABEL = { free: 'Livre', working: 'Ocupado', offline: 'Offline', fault: 'Avariada', reserved: 'Reservado' }

function StatusDot({ status }) {
  const c = DOT_COLOR[status] || DOT_COLOR.free
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c, boxShadow: `0 0 0 4px ${c}22` }} />
}

export default function AdminOperations() {
  const [machines, setMachines] = React.useState([])
  const [loading, setLoading] = React.useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await api.getMachines()
      setMachines(data)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar máquinas', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    load()
    connect()
    const unsub = subscribe((message) => {
      console.debug('[ws] AdminOperations received message', message)
      if (typeof message === 'object' && message.type === 'machine-status' && Array.isArray(message.payload)) {
        setMachines(message.payload)
      } else if (typeof message === 'object' && message.type === 'machine-update') {
        const m = message.payload
        if (!m) return
        setMachines((prev) => {
          const found = prev.find((x) => x._id === m._id)
          if (found) return prev.map((x) => (x._id === m._id ? m : x))
          return [...prev, m]
        })
      }
    })
    return () => unsub()
  }, [])

  async function setMachineStatus(m, status, statusText) {
    const prevStatus = m.status
    const prevText = m.statusText
    try {
      await api.updateMachine(m._id, { status, statusText })
      // update local list
      setMachines((s) => s.map(x => x._id === m._id ? { ...x, status, statusText } : x))
      // show toast with undo action
      const { toast: sonnerToast } = await import('sonner')
      sonnerToast(`Máquina ${m.name} atualizada`, {
        action: {
          label: 'Desfazer',
          onClick: async () => {
            try {
              await api.updateMachine(m._id, { status: prevStatus, statusText: prevText })
              setMachines((s) => s.map(x => x._id === m._id ? { ...x, status: prevStatus, statusText: prevText } : x))
            } catch (e) {
              console.error(e)
              toast({ title: 'Erro ao desfazer', variant: 'destructive' })
            }
          }
        }
      })
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao atualizar estado', variant: 'destructive' })
    }
  }

  // shorthand helpers
  const startMachine = async (m) => {
    await setMachineStatus(m, 'working', 'Ocupado')
    try {
      // record admin-initiated start as a transaction (no price)
      await api.createTransaction({ machineId: m._id, amount: 0, type: 'admin_start' })
    } catch (e) {
      console.warn('Failed to record admin start transaction', e)
    }
  }
  const stopMachine = (m) => setMachineStatus(m, 'free', 'Livre')
  const setOffline = (m) => setMachineStatus(m, 'offline', 'Offline')
  const setOnline = (m) => setMachineStatus(m, 'free', 'Livre')
  // "Avariar" / "Reparado": the machine's own status enum already has a
  // `fault` state distinct from `offline` — offline is an admin choice (e.g.
  // taken out of rotation for cleaning), fault means it's broken and needs a
  // technician. Both matter for "put a machine in/out of service" but they are
  // not the same action, so both get their own button.
  const setFault = (m) => setMachineStatus(m, 'fault', 'Avariada')
  const setRepaired = (m) => setMachineStatus(m, 'free', 'Livre')

  const wash = machines.filter(m => (m.type || 'wash') === 'wash')
  const dry = machines.filter(m => m.type === 'dry')

  // A labelled action button — deliberately not a hover-only icon+tooltip.
  // Tooltips need a hover state a touchscreen never provides, so on a phone
  // the old icon-only buttons had no visible explanation at all.
  // Three labelled buttons in one flex row truncated to "Inici...", "Ava...",
  // "Offli..." even at full phone width — there just isn't 1/3 of a card's
  // width to spare for a 7-letter word plus an icon. A 2-column grid gives
  // each button roughly half the tile's width, which fits every label used
  // here; a leftover 3rd button (the common case) wraps to its own row
  // instead of squeezing into the first, and a single button (Reparada) can
  // span both columns to read as the one clear action available.
  const PRIMARY = 'inline-flex items-center gap-2 h-[42px] px-5 rounded-full border border-black/[0.12] text-[#1c2530] font-semibold text-sm cursor-pointer transition-colors duration-150 hover:bg-[#f7f5f1] disabled:opacity-60'
  const SECONDARY = 'inline-flex items-center gap-2 h-[42px] px-5 rounded-full border border-black/[0.12] text-[#1c2530] font-semibold text-sm cursor-pointer transition-colors duration-150 hover:bg-[#f7f5f1] disabled:opacity-60'

  const ActionButton = ({ onClick, variant, Icon, children, full = false }) => (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 h-[38px] rounded-full font-bold text-[13.5px] cursor-pointer transition-[transform,background,box-shadow] duration-150 ${variant === 'primary' ? PRIMARY : SECONDARY} ${full ? 'col-span-2' : ''}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
      {children}
    </button>
  )

  const MachineTile = ({ m }) => {
    const isDry = m.type === 'dry'
    return (
      <div className="flex flex-col gap-3.5 bg-card rounded-[18px] p-4 shadow-[0_1px_2px_rgba(20,25,30,0.04),0_8px_20px_-12px_rgba(20,25,30,0.08)] transition-transform duration-200 hover:-translate-y-0.5">
        <div className="flex items-center gap-3">
          {/* Machine.icon is a stale public/-relative path left over from the
              Round 9 asset migration and 404s on every machine — never trust
              it for display. These badge icons are drawn locally instead. */}
          <div className={`w-[54px] h-[54px] rounded-[18px] flex items-center justify-center shrink-0 ${isDry ? 'bg-[#f7eac8]' : 'bg-[#a9e0bc]'}`}>
            {isDry ? <DryIcon /> : <WashIcon />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[15px] truncate">{m.name}</div>
            <div className="text-xs text-[#8a8478]">{m.weight ? `${m.weight} kg` : ''}</div>
          </div>
        </div>


        <div className="flex items-center gap-[7px]">
          <StatusDot status={m.status} />
          <span className="text-[12.5px] font-bold text-[#3a352c]">{m.statusText || STATUS_LABEL[m.status] || STATUS_LABEL.free}</span>
        </div>

        <div className="h-px bg-black/[0.07]" />

        <div className="grid grid-cols-2 gap-2">
          {m.status !== 'working' && m.status !== 'fault' && (
            <ActionButton onClick={() => startMachine(m)} variant="primary" Icon={Play}>Iniciar</ActionButton>
          )}
          {m.status === 'working' && (
            <ActionButton onClick={() => stopMachine(m)} variant="secondary" Icon={Square}>Parar</ActionButton>
          )}
          {m.status === 'reserved' && (
            <ActionButton onClick={() => setMachineStatus(m, 'free', 'Livre')} variant="secondary" Icon={X}>Cancelar</ActionButton>
          )}
          {m.status === 'fault' ? (
            <ActionButton onClick={() => setRepaired(m)} variant="primary" Icon={CheckCircle2} full>Reparada</ActionButton>
          ) : (
            <ActionButton onClick={() => setFault(m)} variant="secondary" Icon={Wrench}>Avariar</ActionButton>
          )}
          {m.status !== 'offline' && m.status !== 'fault' && (
            <ActionButton onClick={() => setOffline(m)} variant="secondary" Icon={Power}>Offline</ActionButton>
          )}
          {m.status === 'offline' && (
            <ActionButton onClick={() => setOnline(m)} variant="secondary" Icon={Power}>Online</ActionButton>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[26px] max-w-[1180px]">
      <div className="flex items-center justify-between gap-3">
        <h1 className="m-0 text-[28px] font-extrabold tracking-tight">Operações</h1>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 h-[42px] px-5 rounded-full border border-black/[0.12] text-[#1c2530] font-semibold text-sm cursor-pointer transition-colors duration-150 hover:bg-[#f7f5f1] disabled:opacity-60"
        >
          <RefreshCw className={`w-[15px] h-[15px] ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Atualizar
        </button>
      </div>

      <div>
        <h4 className="m-0 mb-3.5 text-[13px] uppercase tracking-[0.06em] text-[#8a8478] font-bold">Lavagem</h4>
        {loading ? <div className="text-[#8a8478]">Carregando...</div> : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {wash.map((m) => <MachineTile key={m._id} m={m} />)}
          </div>
        )}
      </div>

      <div>
        <h4 className="m-0 mb-3.5 text-[13px] uppercase tracking-[0.06em] text-[#8a8478] font-bold">Secagem</h4>
        {loading ? <div className="text-[#8a8478]">Carregando...</div> : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {dry.map((m) => <MachineTile key={m._id} m={m} />)}
          </div>
        )}
      </div>
    </div>
  )
}

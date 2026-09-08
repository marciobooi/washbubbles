import React from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import { Button } from '@/components/ui/button'
import { Play, Square, X, Power, Wrench, CheckCircle2, RefreshCw } from 'lucide-react'
import { connect, subscribe } from '@/services/websocket'

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

  const STATUS_STYLE = {
    working: { card: 'bg-yellow-50 border-yellow-200', badge: 'bg-yellow-100 text-yellow-800', label: 'Ocupado' },
    offline: { card: 'bg-gray-50 border-gray-200', badge: 'bg-gray-100 text-gray-800', label: 'Offline' },
    fault: { card: 'bg-red-50 border-red-200', badge: 'bg-red-100 text-red-800', label: 'Avariada' },
    free: { card: 'bg-white', badge: 'bg-green-100 text-green-800', label: 'Livre' },
  }

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
  const ActionButton = ({ onClick, variant, Icon, children, full = false }) => (
    <Button
      variant={variant}
      onClick={onClick}
      className={`min-h-11 gap-1.5 px-2 ${full ? 'col-span-2' : ''}`}
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden />
      <span className="text-sm">{children}</span>
    </Button>
  )

  const MachineTile = ({ m }) => {
    const style = STATUS_STYLE[m.status] || STATUS_STYLE.free
    return (
      <div className={`flex flex-col p-4 rounded-lg border transition ${style.card}`}>
        <div className="flex items-center gap-3">
          {m.icon && <img src={m.icon} alt="" className="h-12 w-12 object-contain tealFilter shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate">{m.name}</div>
            <div className="text-xs text-muted-foreground">{m.weight ? `${m.weight} kg` : ''}</div>
          </div>
          <span className={`text-xs px-2 py-1 rounded whitespace-nowrap ${style.badge}`}>{m.statusText || style.label}</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {m.status !== 'working' && m.status !== 'fault' && (
            <ActionButton onClick={() => startMachine(m)} variant="default" Icon={Play}>Iniciar</ActionButton>
          )}
          {m.status === 'working' && (
            <ActionButton onClick={() => stopMachine(m)} variant="destructive" Icon={Square}>Parar</ActionButton>
          )}
          {m.status === 'reserved' && (
            <ActionButton onClick={() => setMachineStatus(m, 'free', 'Livre')} variant="ghost" Icon={X}>Cancelar</ActionButton>
          )}
          {m.status === 'fault' ? (
            <ActionButton onClick={() => setRepaired(m)} variant="default" Icon={CheckCircle2} full={m.status === 'fault'}>Reparada</ActionButton>
          ) : (
            <ActionButton onClick={() => setFault(m)} variant="outline" Icon={Wrench}>Avariar</ActionButton>
          )}
          {m.status !== 'offline' && m.status !== 'fault' && (
            <ActionButton onClick={() => setOffline(m)} variant="outline" Icon={Power}>Offline</ActionButton>
          )}
          {m.status === 'offline' && (
            <ActionButton onClick={() => setOnline(m)} variant="outline" Icon={Power}>Online</ActionButton>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="text-lg font-semibold">Operações</h2>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Atualizar
        </Button>
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Lavagem</div>
        </div>
        {loading ? <div>Carregando...</div> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {wash.map((m) => <MachineTile key={m._id} m={m} />)}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Secagem</div>
        </div>
        {loading ? <div>Carregando...</div> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {dry.map((m) => <MachineTile key={m._id} m={m} />)}
          </div>
        )}
      </div>
    </div>
  )
}
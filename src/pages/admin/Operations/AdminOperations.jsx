import React from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import { Play, Plus, Square, X, Power, Wrench, CheckCircle2, RefreshCw } from 'lucide-react'
import { connect, subscribe } from '@/services/websocket'
import { useAuth } from '@/context/AuthContext'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Skeleton from '@/components/ui/Skeleton'

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

function ActionButton({ onClick, variant = 'secondary', Icon, children, full = false, disabled, ...props }) {
  return (
    <Button
      onClick={onClick}
      variant={variant === 'primary' ? 'default' : 'outline'}
      size="sm"
      className={`${full ? 'col-span-2' : ''}`}
      disabled={disabled}
      {...props}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
      {children}
    </Button>
  )
}

function DryerStartModal({ machine, blocks, setBlocks, onClose, onConfirm, add }) {
  const gap = Number(machine?.tImp) > 0 ? Number(machine.tImp) : 15
  const set = (b) => setBlocks(Math.min(8, Math.max(1, b)))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="m-0 mb-1 text-lg font-extrabold">{add ? 'Enviar impulso a' : 'Iniciar'} {machine?.name}</h3>
        <p className="m-0 mb-4 text-sm text-[#8a8478]">{add ? `A máquina já está a trabalhar: acrescenta ciclos de ${gap} min.` : `Quantos ciclos de ${gap} min?`}</p>
        <div className="flex items-center justify-center gap-4 mb-2">
          <Button variant="outline" size="icon" onClick={() => set(blocks - 1)} disabled={blocks <= 1} aria-label="Menos um ciclo">
            −
          </Button>
          <div className="text-center min-w-[96px]">
            <div className="text-4xl font-extrabold tabular-nums">{blocks}</div>
            <div className="text-xs text-[#8a8478]">{blocks === 1 ? 'ciclo' : 'ciclos'}</div>
          </div>
          <Button variant="outline" size="icon" onClick={() => set(blocks + 1)} disabled={blocks >= 8} aria-label="Mais um ciclo">
            +
          </Button>
        </div>
        <div className="text-center text-sm font-semibold mb-5">{blocks * gap} min no total</div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={onConfirm}>{add ? 'Enviar' : 'Iniciar'}</Button>
        </div>
      </div>
    </div>
  )
}

function OfflineBanner({ shop }) {
  return (
    <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
      <strong>A loja está sem ligação à internet</strong>
      {shop.offlineSeconds != null ? ` há ${shop.offlineSeconds >= 120 ? Math.round(shop.offlineSeconds / 60) + ' min' : shop.offlineSeconds + ' s'}` : ''}. Iniciar, Libertar e Enviar impulso não chegam à loja até voltar a ligação. No quiosque, as máquinas continuam a funcionar com dinheiro e as vendas são enviadas quando voltar.
    </div>
  )
}

function MachineSection({ title, machines, loading, tileProps }) {
  return (
    <div>
      <h4 className="m-0 mb-3.5 text-[13px] uppercase tracking-[0.06em] text-[#8a8478] font-bold">{title}</h4>
      {loading ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="card" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {machines.map((m) => <MachineTile key={m._id} m={m} {...tileProps} onStart={() => tileProps.startMachine(m)} onStop={() => tileProps.stopMachine(m)} onImpulse={() => tileProps.impulseMachine(m)} onSetFault={() => tileProps.setFault(m)} onSetRepaired={() => tileProps.setRepaired(m)} onSetOffline={() => tileProps.setOffline(m)} onSetOnline={() => tileProps.setOnline(m)} />)}
        </div>
      )}
    </div>
  )
}

function MachineTile({ m, onStart, onStop, onImpulse, onSetFault, onSetRepaired, onSetOffline, onSetOnline, isOperator }) {
  const isDry = m.type === 'dry'

  return (
    <Card className="flex flex-col gap-3.5 p-4 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-center gap-3">
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
          <ActionButton onClick={onStart} variant="primary" Icon={Play}>Iniciar</ActionButton>
        )}
        {m.status === 'working' && (
          <ActionButton onClick={onStop} variant="secondary" Icon={Square}>Libertar</ActionButton>
        )}
        {isDry && m.status === 'working' && (
          <ActionButton onClick={onImpulse} variant="primary" Icon={Plus}>Enviar impulso</ActionButton>
        )}
        {!isOperator && m.status === 'reserved' && (
          <ActionButton onClick={() => onSetOnline()} variant="secondary" Icon={X}>Cancelar</ActionButton>
        )}
        {!isOperator ? (
          m.status === 'fault' ? (
            <ActionButton onClick={onSetRepaired} variant="primary" Icon={CheckCircle2} full>Reparada</ActionButton>
          ) : (
            <ActionButton onClick={onSetFault} variant="secondary" Icon={Wrench}>Avariar</ActionButton>
          )
        ) : null}
        {!isOperator && m.status !== 'offline' && m.status !== 'fault' && (
          <ActionButton onClick={onSetOffline} variant="secondary" Icon={Power}>Offline</ActionButton>
        )}
        {!isOperator && m.status === 'offline' && (
          <ActionButton onClick={onSetOnline} variant="secondary" Icon={Power}>Online</ActionButton>
        )}
      </div>
    </Card>
  )
}

export default function AdminOperations() {
  // An OPERATOR (shop assistant) only gets Iniciar / Parar: the service-state buttons (Avariar, Offline, ...) are for the admin.
  const { role } = useAuth()
  const isOperator = role === 'OPERATOR'
  const [machines, setMachines] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  // Is the shop talking to this server? null = unknown (e.g. this IS the shop PC: nothing to report).
  const [shop, setShop] = React.useState(null)
  const [dryPick, setDryPick] = React.useState(null) // { m, blocks }

  React.useEffect(() => {
    let alive = true
    const poll = () => api.adminShopStatus().then((s) => { if (alive) setShop(s?.known ? s : null) }).catch(() => {})
    poll()
    const id = setInterval(poll, 10_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

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
      toast({
        title: `Máquina ${m.name} atualizada`,
        variant: 'success',
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
  // Start / end really act on the machine (no payment). On the central server the request is
  // queued for the shop, which does it within seconds; the machine's status here changes when
  // the shop reports back, so it is NOT set optimistically.
  const runAdminAction = async (m, action, blocks = 1) => {
    try {
      const r = action === 'start' ? await api.adminStartMachine(m._id, blocks) : action === 'impulse' ? await api.adminImpulseMachine(m._id, blocks) : await api.adminEndMachine(m._id)
      if (r?.queued) {
        toast({ title: `Pedido enviado ao posto`, description: `${action === 'start' ? 'Iniciar' : action === 'impulse' ? 'Enviar impulso a' : 'Libertar'} ${m.name}. O estado atualiza quando o posto confirmar.`, variant: 'success' })
      } else {
        toast({ title: action === 'impulse' ? `${blocks > 1 ? blocks + ' impulsos enviados' : 'Impulso enviado'} à ${m.name}` : action === 'start' ? `${m.name} iniciada${blocks > 1 ? ` (${blocks} ciclos)` : ''}` : `${m.name} libertada`, variant: 'success' })
        if (action !== 'impulse') setMachines((s) => s.map((x) => x._id === m._id ? { ...x, status: action === 'start' ? 'working' : 'free', statusText: action === 'start' ? 'Ocupado' : 'Livre' } : x))
      }
      return true
    } catch (e) {
      toast({ title: action === 'start' ? 'Não foi possível iniciar' : action === 'impulse' ? 'Não foi possível enviar o impulso' : 'Não foi possível libertar', description: e?.message || String(e), variant: 'destructive' })
      return false
    }
  }

  const startMachine = (m) => (m.type === 'dry' ? setDryPick({ m, blocks: 1 }) : runAdminAction(m, 'start'))

  const impulseMachine = (m) => setDryPick({ m, blocks: 1, add: true })

  const stopMachine = async (m) => {
    if (await runAdminAction(m, 'end')) toast({ title: `${m.name}: só libertada no sistema`, description: 'A máquina não pára: o ciclo em curso continua até ao fim. Para o cortar, usa o botão de parar na própria máquina ou desliga-a da corrente.' })
  }

  const setOffline = (m) => setMachineStatus(m, 'offline', 'Offline')
  const setOnline = (m) => setMachineStatus(m, 'free', 'Livre')
  const setFault = (m) => setMachineStatus(m, 'fault', 'Avariada')
  const setRepaired = (m) => setMachineStatus(m, 'free', 'Livre')

  const tileProps = { isOperator, startMachine, stopMachine, impulseMachine, setFault, setRepaired, setOffline, setOnline }
  const wash = machines.filter(m => (m.type || 'wash') === 'wash')
  const dry = machines.filter(m => m.type === 'dry')

  return (
    <div className="flex flex-col gap-[26px] max-w-[1180px] mx-auto p-4 md:p-6">
      <PageHeader
        title="Operações"
        actions={
          <Button onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
          </Button>
        }
      />

      {dryPick && (
        <DryerStartModal
          machine={dryPick.m}
          blocks={dryPick.blocks}
          setBlocks={(b) => setDryPick((d) => ({ ...d, blocks: b }))}
          onClose={() => setDryPick(null)}
          add={dryPick.add}
          onConfirm={() => { const d = dryPick; setDryPick(null); runAdminAction(d.m, d.add ? 'impulse' : 'start', d.blocks) }}
        />
      )}

      {shop && !shop.online && <OfflineBanner shop={shop} />}

      <MachineSection
        title="Lavagem"
        machines={wash}
        loading={loading}
        tileProps={tileProps}
      />

      <MachineSection
        title="Secagem"
        machines={dry}
        loading={loading}
        tileProps={tileProps}
      />
    </div>
  )
}
import React from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import { Button } from '@/components/ui/button'
import { Play, Square, X, Power } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip' 

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

  React.useEffect(() => { load() }, [])

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
  const startMachine = (m) => setMachineStatus(m, 'working', 'Ocupado')
  const stopMachine = (m) => setMachineStatus(m, 'free', 'Livre')
  const setOffline = (m) => setMachineStatus(m, 'offline', 'Offline')
  const setOnline = (m) => setMachineStatus(m, 'free', 'Livre')

  const wash = machines.filter(m => (m.type || 'wash') === 'wash')
  const dry = machines.filter(m => m.type === 'dry')

  const MachineTile = ({ m }) => (
    <div className={`aspect-square flex flex-col p-4 rounded-lg border hover:shadow-md transition ${m.status === 'working' ? 'bg-yellow-50' : m.status === 'offline' ? 'bg-gray-50' : 'bg-white'}`}>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
        {m.icon && <img src={m.icon} alt="icon" className="h-16 w-16 object-contain tealFilter" />}
        <div className="font-semibold">{m.name}</div>
        <div className="text-xs text-muted-foreground">{m.weight ? `${m.weight} kg` : ''}</div>
      </div>
      <div className="mt-3 flex flex-col items-end gap-2">
        <span className={`text-xs px-2 py-1 rounded ${m.status === 'working' ? 'bg-yellow-100 text-yellow-800' : m.status === 'offline' ? 'bg-gray-100 text-gray-800' : 'bg-green-100 text-green-800'}`}>{m.statusText || (m.status === 'working' ? 'Ocupado' : m.status === 'offline' ? 'Offline' : 'Livre')}</span>
        <div className="flex gap-2 mt-2">
          {m.status !== 'working' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" className="p-2" onClick={() => startMachine(m)} aria-label="Iniciar">
                  <Play className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>Iniciar</TooltipContent>
            </Tooltip>
          )}
          {m.status === 'working' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="destructive" className="p-2" onClick={() => stopMachine(m)} aria-label="Parar">
                  <Square className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>Parar</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" className="p-2" onClick={() => setMachineStatus(m, 'free', 'Livre')} aria-label="Cancelar">
                <X className="w-5 h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent sideOffset={6}>Cancelar</TooltipContent>
          </Tooltip>
          {m.status !== 'offline' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" className="p-2" onClick={() => setOffline(m)} aria-label="Offline">
                  <Power className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>Offline</TooltipContent>
            </Tooltip>
          )}
          {m.status === 'offline' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" className="p-2" onClick={() => setOnline(m)} aria-label="Online">
                  <Power className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>Online</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <TooltipProvider>
      <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Operações</h2>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Lavagem</div>
          <div className="text-sm text-muted-foreground">Use os controlos em cada cartão para alterar o estado</div>
        </div>
        {loading ? <div>Carregando...</div> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {wash.map((m) => <MachineTile key={m._id} m={m} />)}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">Secagem</div>
        </div>
        {loading ? <div>Carregando...</div> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {dry.map((m) => <MachineTile key={m._id} m={m} />)}
          </div>
        )}
      </div>
    </div>
    </TooltipProvider>
  )
}
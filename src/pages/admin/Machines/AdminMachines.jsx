import React, { useEffect, useState } from 'react'
import { shopDate } from '@/lib/shopTime'
import { useNavigate } from 'react-router-dom'
import Skeleton from '@/components/ui/Skeleton'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import * as ws from '@/services/websocket'
import Modal from '@/components/ui/Modal'
import { Pencil, Trash2, Plus, Check, X, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WasherIcon, DryerIcon } from '@/components/icons/MachineIcons'
import PageHeader from '@/components/PageHeader'
import { useAuth } from '@/context/AuthContext'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// A machine that is broken (fault) or taken out of service is red, whatever else its state says.
const isBroken = (m) => Boolean(m) && (m.status === 'fault' || m.outOfService === true)
const statusTone = (m) => isBroken(m) ? 'bg-red-100 text-red-800' : m?.status === 'working' ? 'bg-yellow-100 text-yellow-800' : m?.status === 'offline' ? 'bg-gray-100 text-gray-800' : 'bg-green-100 text-green-800'

// A live update (WebSocket) has the machine's state but not what the list adds: the cycles and the populated interface.
// Without this the first live update erased them (cycles back to 0, the interface shown as its raw id).
function keepListFields(prev, live) {
  if (!prev) return live
  const keepIface = typeof live.interfaceId === 'string' && prev.interfaceId && typeof prev.interfaceId === 'object'
  return { ...live, cycle: prev.cycle ?? live.cycle, ...(keepIface ? { interfaceId: prev.interfaceId } : {}) }
}

function MachineForm({ 
  editing, 
  modalOpen, 
  onClose, 
  onSubmit,
  interfaces,
  machines,
  isSaving,
  formData,
  setFormData,
  errors,
  setErrors,
  interfacePortOptions
}) {
  const { name, machineNumber, machineBrand, machineModel, machineSerial, status, weight, type, selectedInterfacePort, activation, tImp } = formData

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => { const c = { ...prev }; delete c[field]; return c })
    }
  }

  const handleSelectChange = (field, value) => {
    handleInputChange(field, value)
  }

  return (
    <Modal open={modalOpen} onClose={onClose} title={editing ? 'Editar Máquina' : 'Nova Máquina'} wide>
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left column: main fields */}
          <div className="md:col-span-2 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="machine-number">Número <span className="text-red-500">*</span></Label>
                <Input 
                  id="machine-number" 
                  type="number" 
                  placeholder="Número" 
                  value={machineNumber} 
                  onChange={(e) => handleInputChange('machineNumber', e.target.value)} 
                />
              </div>
              <div>
                <Label htmlFor="machine-name">Nome <span className="text-red-500">*</span></Label>
                <Input 
                  id="machine-name" 
                  placeholder="Nome" 
                  value={name} 
                  onChange={(e) => handleInputChange('name', e.target.value)} 
                />
                {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="machine-brand">Marca</Label>
                <Input id="machine-brand" placeholder="Marca" value={machineBrand} onChange={(e) => handleInputChange('machineBrand', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="machine-model">Modelo</Label>
                <Input id="machine-model" placeholder="Modelo" value={machineModel} onChange={(e) => handleInputChange('machineModel', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="machine-serial">Número de série <span className="text-red-500">*</span></Label>
                <Input id="machine-serial" placeholder="Número de série" value={machineSerial} onChange={(e) => handleInputChange('machineSerial', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="machine-type">Tipo</Label>
                <Select value={type} onValueChange={(v) => handleSelectChange('type', v)}>
                  <SelectTrigger id="machine-type">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wash">Lavagem (wash)</SelectItem>
                    <SelectItem value="dry">Secagem (dry)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="machine-activation">Activação <span className="text-red-500">*</span></Label>
                <Select value={activation} onValueChange={(v) => handleSelectChange('activation', v)}>
                  <SelectTrigger id="machine-activation">
                    <SelectValue placeholder="Activação" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">high</SelectItem>
                    <SelectItem value="low">low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="machine-port">Porto <span className="text-red-500">*</span></Label>
                <Select value={selectedInterfacePort || '__none__'} onValueChange={(v) => handleSelectChange('selectedInterfacePort', v === '__none__' ? '' : v)}>
                  <SelectTrigger id="machine-port">
                    <SelectValue placeholder="-- Seleccionar --" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" disabled>-- Seleccionar --</SelectItem>
                    {interfacePortOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="machine-weight">Peso (kg) <span className="text-red-500">*</span></Label>
                <Input 
                  id="machine-weight" 
                  type="number" 
                  placeholder="Peso (kg)" 
                  value={weight} 
                  onChange={(e) => handleInputChange('weight', e.target.value)} 
                />
                {errors.weight && <p className="text-xs text-destructive mt-1">{errors.weight}</p>}
                <p className="text-xs text-muted-foreground mt-1">O preço é definido automaticamente com base no peso e tipo.</p>
              </div>
              {type === 'dry' && (
                <div>
                  <Label htmlFor="machine-timp">t/imp. [min.] <span className="text-red-500">*</span></Label>
                  <Input id="machine-timp" type="number" step="0.1" placeholder="t/imp. [min.]" value={tImp} onChange={(e) => handleInputChange('tImp', e.target.value)} />
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="machine-status">Estado</Label>
              <Select value={status} onValueChange={(v) => handleSelectChange('status', v)}>
                <SelectTrigger id="machine-status">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Livre</SelectItem>
                  <SelectItem value="working">Ocupado</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="fault">Avariada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Right column: preview */}
          <div className="md:col-span-1">
            <Card className="h-full">
              <CardContent className="flex flex-col gap-4 h-full justify-between p-4">
                <div>
                  <div className="font-semibold">{name || (editing ? editing.name : 'Nome da máquina')}</div>
                  <div className="text-xs text-muted-foreground">{type === 'wash' ? 'Lavagem' : 'Secagem'} • {weight !== '' ? weight + ' kg' : '—'}</div>
                </div>

                <div>
                  <div className={`flex justify-center text-xs px-2 py-1 rounded ${statusTone({ status, outOfService: false })}`}>
                    {status === 'free' ? 'Livre' : status === 'working' ? 'Ocupado' : status === 'offline' ? 'Offline' : 'Avariada'}
                  </div>
                </div>

                <div className="flex justify-center">
                  <span className="block h-12 w-12 transition-transform duration-300">{type === 'dry' ? <DryerIcon /> : <WasherIcon />}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Full-width action row */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" type="button" onClick={onClose}>
            <X className="h-4 w-4 mr-2" /> Cancelar
          </Button>
          <Button type="submit" disabled={isSaving} aria-disabled={isSaving}>
            {isSaving ? 'A guardar...' : <> <Check className="h-4 w-4 mr-2" /> Guardar </>}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default function AdminMachines() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const canEdit = role === 'ADMIN' || role === 'SUPERADMIN'
  const canService = canEdit || role === 'TECHNICIAN'
  const [servicingId, setServicingId] = useState(null)
  const [machines, setMachines] = useState([])
  const [interfaces, setInterfaces] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [animating, setAnimating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [formData, setFormData] = useState({
    name: '',
    machineNumber: '',
    machineBrand: '',
    machineModel: '',
    machineSerial: '',
    status: 'free',
    weight: '',
    type: 'wash',
    selectedInterfacePort: '',
    activation: 'high',
    tImp: '',
  })

  async function loadInterfaces() {
    try {
      const data = await api.getInterfaces()
      setInterfaces(data)
    } catch (e) {
      console.error('Error loading interfaces', e)
    }
  }

  async function load() {
    setLoading(true)
    try {
      const data = await api.getMachines()
      setMachines(data)
    } catch (e) {
      console.error(e)
      if (e && e.status === 401) {
        toast({ title: 'Sessão expirada, faça login novamente', variant: 'destructive' })
        navigate('/admin/login')
        return
      }
      toast({ title: 'Erro ao carregar máquinas', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(); loadInterfaces() }, [])

  // WebSocket subscription for real-time machine updates
  useEffect(() => {
    ws.connect()
    const unsubscribe = ws.subscribe((data) => {
      if (!data || typeof data !== 'object') return
      
      if (data.type === 'machine-status' && Array.isArray(data.payload)) {
        setMachines(prev => data.payload.map(m => keepListFields(prev.find(p => p._id === m._id), m)))
      }
      
      if (data.type === 'machine-update' && data.payload) {
        const updated = data.payload
        setMachines(prev => {
          const idx = prev.findIndex(m => m._id === updated._id)
          if (idx === -1) {
            return [...prev, updated]
          } else {
            const next = [...prev]
            next[idx] = keepListFields(prev[idx], updated)
            return next
          }
        })
      }
    })
    return () => {
      unsubscribe()
      ws.disconnect()
    }
  }, [])

  // animate preview when type changes
  useEffect(() => {
    setAnimating(true)
    const t = setTimeout(() => setAnimating(false), 320)
    return () => clearTimeout(t)
  }, [formData.type])

  // Build a set of used interface+port combos (excluding current machine being edited)
  const usedPorts = new Set(
    machines
      .filter(m => m.interfaceId && m.port && (!editing || m._id !== editing._id))
      .map(m => {
        const ifaceId = typeof m.interfaceId === 'object' ? m.interfaceId._id : m.interfaceId
        return `${ifaceId}:${m.port}`
      })
  )

  // Build interface+port options
  const interfacePortOptions = interfaces.flatMap(iface => {
    const ports = iface.ports || 2
    const statusLabel = iface.status === 'active' ? '' : iface.status === 'fault' ? ' [AVARIA]' : ' [inactivo]'
    return Array.from({ length: ports }, (_, i) => {
      const value = `${iface._id}:${i + 1}`
      const isUsed = usedPorts.has(value)
      return {
        value,
        label: `Interface: ${iface.address}, Porto: ${i + 1}${statusLabel}${isUsed ? ' [EM USO]' : ''}`,
        interfaceId: iface._id,
        port: i + 1,
        status: iface.status,
        disabled: isUsed,
      }
    })
  })

  function openNew() {
    setEditing(null)
    setFormData({
      name: '',
      machineNumber: '',
      machineBrand: '',
      machineModel: '',
      machineSerial: '',
      status: 'free',
      weight: '',
      type: 'wash',
      selectedInterfacePort: '',
      activation: 'high',
      tImp: '',
    })
    setErrors({})
    setModalOpen(true)
  }

  function openEdit(m) {
    setEditing(m)
    setFormData({
      name: m.name,
      machineNumber: m.number !== undefined && m.number !== null ? String(m.number) : '',
      machineBrand: m.brand || '',
      machineModel: m.model || '',
      machineSerial: m.serialNumber || '',
      status: m.status || 'free',
      weight: m.weight !== undefined && m.weight !== null ? String(m.weight) : '',
      type: m.type || 'wash',
      selectedInterfacePort: m.interfaceId && m.port ? `${typeof m.interfaceId === 'object' ? m.interfaceId._id : m.interfaceId}:${m.port}` : '',
      activation: m.activation || 'high',
      tImp: m.tImp !== undefined && m.tImp !== null ? String(m.tImp) : '',
    })
    setErrors({})
    setModalOpen(true)
  }

  async function save(e) {
    e?.preventDefault()
    const newErrors = {}
    if (!formData.name || !formData.name.trim()) newErrors.name = 'Nome é obrigatório.'

    if (formData.weight !== '') {
      const w = parseFloat(formData.weight)
      if (Number.isNaN(w) || w < 0) newErrors.weight = 'Peso deve ser maior ou igual a 0.'
    }

    if (Object.keys(newErrors).length) {
      setErrors(newErrors)
      return
    }

    // Parse interface+port selection
    let interfaceId = null
    let port = null
    if (formData.selectedInterfacePort) {
      const [ifId, portNum] = formData.selectedInterfacePort.split(':')
      interfaceId = ifId
      port = parseInt(portNum, 10)
    }

    setIsSaving(true)
    try {
      const payload = {
        name: formData.name,
        number: formData.machineNumber ? parseInt(formData.machineNumber, 10) : null,
        brand: formData.machineBrand,
        model: formData.machineModel,
        serialNumber: formData.machineSerial,
        status: formData.status,
        statusText: 'Livre',
        weight: formData.weight === '' ? 0 : parseFloat(formData.weight),
        type: formData.type,
        interfaceId,
        port,
        activation: formData.activation,
        tImp: formData.type === 'dry' && formData.tImp !== '' ? parseFloat(formData.tImp) : null,
      }
      if (editing) {
        await api.updateMachine(editing._id, payload)
        toast({ title: 'Máquina atualizada', variant: 'success' })
      } else {
        await api.createMachine(payload)
        toast({ title: 'Máquina criada', variant: 'success' })
      }
      setModalOpen(false)
      load()
    } catch (e) {
      console.error(e)
      if (e && e.status === 401) {
        toast({ title: 'Sessão expirada, faça login novamente', variant: 'destructive' })
        navigate('/admin/login')
        return
      }
      toast({ title: 'Erro', variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }

  async function logService(id) {
    setServicingId(id)
    try {
      await api.logMachineService(id)
      toast({ title: 'Manutenção registada', variant: 'success' })
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao registar manutenção', variant: 'destructive' })
    } finally {
      setServicingId(null)
    }
  }

  async function remove(id) {
    if (!confirm('Remover esta máquina?')) return
    try {
      await api.deleteMachine(id)
      toast({ title: 'Máquina removida', variant: 'success' })
      load()
    } catch (e) {
      console.error(e)
      if (e && e.status === 401) {
        toast({ title: 'Sessão expirada, faça login novamente', variant: 'destructive' })
        navigate('/admin/login')
        return
      }
      toast({ title: 'Erro ao remover', variant: 'destructive' })
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-[1180px] mx-auto">
      <PageHeader
        title="Máquinas"
        actions={canEdit ? (
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" aria-hidden /> Nova Máquina
          </Button>
        ) : null}
      />

      <Card className="overflow-auto">
        <table className="min-w-full divide-y text-sm">
          <thead className="bg-muted-foreground/5">
            <tr>
              <th className="px-4 py-2 text-left">Nº</th>
              <th className="px-4 py-2 text-left">Nome</th>
              <th className="px-4 py-2 text-left">Tipo</th>
              <th className="px-4 py-2 text-left">Peso</th>
              <th className="px-4 py-2 text-left">Porto</th>
              <th className="px-4 py-2 text-left">Estado</th>
              <th className="px-4 py-2 text-left">Ciclos</th>
              <th className="px-4 py-2 text-left">Última manutenção</th>
              <th className="px-4 py-2 text-left">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06]">
            {loading ? (
              <tr>
                <td colSpan={9} className="p-4"><Skeleton height="1.25rem" /></td>
              </tr>
            ) : machines.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-4 text-center text-[#8a8478]">Nenhuma máquina</td>
              </tr>
            ) : (
              machines.map((m) => (
                <tr key={m._id} className="hover:bg-neutral-50/50">
                  <td className="px-4 py-3 text-center font-semibold">{m.number || '—'}</td>
                  <td className="px-4 py-3 flex items-center gap-2">
                    {m.type === 'dry' ? <DryerIcon animated={false} className="h-8 w-8" /> : <WasherIcon animated={false} className="h-8 w-8" />}
                    <div>{m.name}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{m.type === 'wash' ? 'Lavagem' : 'Secagem'}</td>
                  <td className="px-4 py-3">{m.weight ? m.weight + ' kg' : '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    {m.interfaceId ? (
                      <span>Interface: {m.interfaceId.address || m.interfaceId}, Porto: {m.port}</span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded ${statusTone(m)}`}>
                      {m.statusText || (isBroken(m) ? 'Avariada' : m.status === 'working' ? 'Ocupado' : m.status === 'offline' ? 'Offline' : 'Livre')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{m.cycle || 0}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {m.lastServicedAt ? shopDate(m.lastServicedAt) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canService && (
                        <Button variant="ghost" size="icon" title="Registar manutenção" aria-label="Registar manutenção" onClick={() => logService(m._id)} disabled={servicingId === m._id}>
                          <Wrench />
                        </Button>
                      )}
                      {canEdit && (
                        <>
                          <Button variant="ghost" size="icon" title="Editar" aria-label="Editar" onClick={() => openEdit(m)}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon" title="Remover" aria-label="Remover" onClick={() => remove(m._id)} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <MachineForm
        editing={editing}
        modalOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        interfaces={interfaces}
        machines={machines}
        isSaving={isSaving}
        formData={formData}
        setFormData={setFormData}
        errors={errors}
        setErrors={setErrors}
        interfacePortOptions={interfacePortOptions}
      />
    </div>
  )
}
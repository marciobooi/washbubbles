import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import Modal from '@/components/ui/Modal'
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AdminMachines(){
  const navigate = useNavigate()
  const [machines, setMachines] = useState([])
  const [interfaces, setInterfaces] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [machineNumber, setMachineNumber] = useState('')
  const [machineBrand, setMachineBrand] = useState('')
  const [machineModel, setMachineModel] = useState('')
  const [machineSerial, setMachineSerial] = useState('')
  const [status, setStatus] = useState('free')
  const [weight, setWeight] = useState('')
  const [type, setType] = useState('wash')
  const [selectedInterfacePort, setSelectedInterfacePort] = useState('') // format: interfaceId:port
  const [activation, setActivation] = useState('high')
  const [tImp, setTImp] = useState('') // time per impulse in minutes (dry machines only)

  // Validation state
  const [errors, setErrors] = useState({})
  const [isSaving, setIsSaving] = useState(false)
  // animate preview when type changes
  const [animating, setAnimating] = useState(false)

  async function loadInterfaces() {
    try {
      const data = await api.getInterfaces()
      // Show all interfaces, user can select any
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

  // animate preview when type changes
  useEffect(() => {
    setAnimating(true)
    const t = setTimeout(() => setAnimating(false), 320)
    return () => clearTimeout(t)
  }, [type])

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
    setName('')
    setMachineNumber('')
    setMachineBrand('')
    setMachineModel('')
    setMachineSerial('')
    setStatus('free')
    setWeight('')
    setType('wash')
    setSelectedInterfacePort('')
    setActivation('high')
    setTImp('')
    setErrors({})
    setModalOpen(true)
  }

  function openEdit(m) {
    setEditing(m)
    setName(m.name)
    setMachineNumber(m.number !== undefined && m.number !== null ? String(m.number) : '')
    setMachineBrand(m.brand || '')
    setMachineModel(m.model || '')
    setMachineSerial(m.serialNumber || '')
    setStatus(m.status || 'free')
    setWeight(m.weight !== undefined && m.weight !== null ? String(m.weight) : '')
    setType(m.type || 'wash')
    // Set interface+port combo
    if (m.interfaceId && m.port) {
      const ifaceId = typeof m.interfaceId === 'object' ? m.interfaceId._id : m.interfaceId
      setSelectedInterfacePort(`${ifaceId}:${m.port}`)
    } else {
      setSelectedInterfacePort('')
    }
    setActivation(m.activation || 'high')
    setTImp(m.tImp !== undefined && m.tImp !== null ? String(m.tImp) : '')
    setErrors({})
    setModalOpen(true)
  }

  async function save(e) {
    e?.preventDefault()
    // Client-side validation
    const newErrors = {}
    if (!name || !name.trim()) newErrors.name = 'Nome é obrigatório.'

    if (weight !== '') {
      const w = parseFloat(weight)
      if (Number.isNaN(w) || w < 0) newErrors.weight = 'Peso deve ser maior ou igual a 0.'
    }

    if (Object.keys(newErrors).length) {
      setErrors(newErrors)
      return
    }

    // Parse interface+port selection
    let interfaceId = null
    let port = null
    if (selectedInterfacePort) {
      const [ifId, portNum] = selectedInterfacePort.split(':')
      interfaceId = ifId
      port = parseInt(portNum, 10)
    }

    setIsSaving(true)
    try {
      const payload = {
        name,
        number: machineNumber ? parseInt(machineNumber, 10) : null,
        brand: machineBrand,
        model: machineModel,
        serialNumber: machineSerial,
        status,
        statusText: 'Livre',
        weight: weight === '' ? 0 : parseFloat(weight),
        type,
        interfaceId,
        port,
        activation,
        tImp: type === 'dry' && tImp !== '' ? parseFloat(tImp) : null,
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
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Máquinas</h2>
        <div>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Nova Máquina</Button>
        </div>
      </div>

      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full divide-y text-sm">
          <thead className="bg-muted-foreground/5">
            <tr>
              <th className="px-4 py-2 text-left">Nº</th>
              <th className="px-4 py-2 text-left">Nome</th>
              <th className="px-4 py-2 text-left">Tipo</th>
              <th className="px-4 py-2 text-left">Peso</th>
              <th className="px-4 py-2 text-left">Porto</th>
              <th className="px-4 py-2 text-left">Estado</th>
              <th className="px-4 py-2 text-left">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={7} className="p-4">Loading...</td>
              </tr>
            ) : machines.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-4">Nenhuma máquina</td>
              </tr>
            ) : (
              machines.map((m) => (
                <tr key={m._id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 text-center font-semibold">{m.number || '—'}</td>
                  <td className="px-4 py-3 flex items-center gap-2">
                    {m.icon && <img src={m.icon} alt="icon" className="h-8 w-8 object-contain" />}
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
                    <span className={`text-xs px-2 py-1 rounded ${m.status === 'working' ? 'bg-yellow-100 text-yellow-800' : m.status === 'offline' ? 'bg-gray-100 text-gray-800' : 'bg-green-100 text-green-800'}`}>{m.statusText || (m.status === 'working' ? 'Ocupado' : m.status === 'offline' ? 'Offline' : 'Livre')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button className="btn p-2" title="Editar" aria-label="Editar" onClick={() => openEdit(m)}>
                        <Pencil className="h-6 w-6" />
                      </button>
                      <button className="btn btn-destructive p-2" title="Remover" aria-label="Remover" onClick={() => remove(m._id)}>
                        <Trash2 className="h-6 w-6" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Máquina' : 'Nova Máquina'}>
        <form onSubmit={save} className="machine-form grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          {/* Left column: main fields */}
          <div className="md:col-span-2 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="machine-number" className="text-sm font-medium">Número <span className="text-red-500">*</span></label>
                <input id="machine-number" className="border p-2 rounded mt-1 w-full" placeholder="Número" type="number" value={machineNumber} onChange={(e) => setMachineNumber(e.target.value)} />
              </div>
              <div>
                <label htmlFor="machine-name" className="text-sm font-medium">Nome <span className="text-red-500">*</span></label>
                <input id="machine-name" className="border p-2 rounded mt-1 w-full" placeholder="Nome" value={name} onChange={(e) => { setName(e.target.value); if (errors.name && e.target.value.trim()) setErrors((s) => { const c = { ...s }; delete c.name; return c }); }} />
                {errors.name && <div className="text-xs text-destructive mt-1">{errors.name}</div>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="machine-brand" className="text-sm font-medium">Marca</label>
                <input id="machine-brand" className="border p-2 rounded mt-1 w-full" placeholder="Marca" value={machineBrand} onChange={(e) => setMachineBrand(e.target.value)} />
              </div>
              <div>
                <label htmlFor="machine-model" className="text-sm font-medium">Modelo</label>
                <input id="machine-model" className="border p-2 rounded mt-1 w-full" placeholder="Modelo" value={machineModel} onChange={(e) => setMachineModel(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="machine-serial" className="text-sm font-medium">Número de série <span className="text-red-500">*</span></label>
                <input id="machine-serial" className="border p-2 rounded mt-1 w-full" placeholder="Número de série" value={machineSerial} onChange={(e) => setMachineSerial(e.target.value)} />
              </div>
              <div>
                <label htmlFor="machine-type" className="text-sm font-medium">Tipo</label>
                <select id="machine-type" className="border p-2 rounded mt-1 w-full" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="wash">Lavagem (wash)</option>
                  <option value="dry">Secagem (dry)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="machine-activation" className="text-sm font-medium">Activação <span className="text-red-500">*</span></label>
                <select id="machine-activation" className="border p-2 rounded mt-1 w-full" value={activation} onChange={(e) => setActivation(e.target.value)}>
                  <option value="high">high</option>
                  <option value="low">low</option>
                </select>
              </div>
              <div>
                <label htmlFor="machine-port" className="text-sm font-medium">Porto <span className="text-red-500">*</span></label>
                <select id="machine-port" className="border p-2 rounded mt-1 w-full" value={selectedInterfacePort} onChange={(e) => setSelectedInterfacePort(e.target.value)}>
                  <option value="">-- Seleccionar --</option>
                  {interfacePortOptions.map(opt => (
                    <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="machine-weight" className="text-sm font-medium">Peso (kg) <span className="text-red-500">*</span></label>
                <input id="machine-weight" className="border p-2 rounded mt-1 w-full" placeholder="Peso (kg)" type="number" value={weight} onChange={(e) => { setWeight(e.target.value); const v = parseFloat(e.target.value); if (errors.weight && !isNaN(v) && v >= 0) setErrors((s) => { const c = { ...s }; delete c.weight; return c }); }} />
                {errors.weight && <div className="text-xs text-destructive mt-1">{errors.weight}</div>}
                <div className="text-xs text-muted-foreground mt-1">O preço é definido automaticamente com base no peso e tipo.</div>
              </div>
              {type === 'dry' && (
                <div>
                  <label htmlFor="machine-timp" className="text-sm font-medium">t/imp. [min.] <span className="text-red-500">*</span></label>
                  <input id="machine-timp" className="border p-2 rounded mt-1 w-full" placeholder="t/imp. [min.]" type="number" step="0.1" value={tImp} onChange={(e) => setTImp(e.target.value)} />
                </div>
              )}
            </div>

          </div>

          {/* Right column: preview */}
          <div className="md:col-span-1">
            <div className="border rounded p-3 bg-muted-foreground/5 h-full">
              <div className="flex flex-col gap-3 h-full justify-between">
                <div>
                  <div className="font-semibold">{name || (editing ? editing.name : 'Nome da máquina')}</div>
                  <div className="text-xs text-muted-foreground">{type === 'wash' ? 'Lavagem' : 'Secagem'} • {weight !== '' ? weight + ' kg' : '—'}</div>
                </div>

                <div>
                  <div className={`flex justify-center  text-xs px-2 py-1 rounded ${editing?.status === 'working' ? 'bg-yellow-100 text-yellow-800' : editing?.status === 'offline' ? 'bg-gray-100 text-gray-800' : 'bg-green-100 text-green-800'}`}>{editing?.statusText || (editing?.status === 'working' ? 'Ocupado' : editing?.status === 'offline' ? 'Offline' : 'Livre')}</div>
                </div>

                <div className="flex justify-center">
                  <img src={(editing && editing.icon) || (type === 'dry' ? '/drymachine/S1.png' : '/washingmashine/L1.png')} alt="preview" className={`h-12 w-12 object-contain rounded transition-transform duration-300 ${animating ? 'scale-95 opacity-60' : 'scale-100 opacity-100'} tealFilter`} aria-hidden />
                </div>
              </div>
            </div>
          </div>

          {/* Full-width action row */}
          <div className="md:col-span-3 flex justify-end gap-2 mt-4">
            <Button variant="outline" type="button" onClick={() => setModalOpen(false)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
            <Button type="submit" disabled={isSaving} aria-disabled={isSaving}>{isSaving ? 'Salvando...' : (<><Check className="h-4 w-4 mr-2" />Salvar</>)}</Button>
          </div>

        </form>
      </Modal>
    </div>
  )
}
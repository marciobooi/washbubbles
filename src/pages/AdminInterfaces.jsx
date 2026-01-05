import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'

const EMPTY_FORM = {
  name: '',
  brand: '',
  model: '',
  serialNumber: '',
  address: '',
  ports: '2',
  tOn: '100',
  tOff: '100',
}

export default function AdminInterfaces() {
  const [interfaces, setInterfaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await api.getInterfaces()
      setInterfaces(data)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar interfaces', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEdit(iface) {
    setEditing(iface)
    setForm({
      name: iface.name || '',
      brand: iface.brand || '',
      model: iface.model || '',
      serialNumber: iface.serialNumber || '',
      address: String(iface.address ?? ''),
      ports: String(iface.ports ?? '2'),
      tOn: String(iface.tOn ?? '100'),
      tOff: String(iface.tOff ?? '100'),
    })
    setModalOpen(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.serialNumber || form.address === '' || form.ports === '' || form.tOn === '' || form.tOff === '') {
      toast({ title: 'Preencha os campos obrigatórios', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        brand: form.brand,
        model: form.model,
        serialNumber: form.serialNumber,
        address: Number(form.address),
        ports: Number(form.ports),
        tOn: Number(form.tOn),
        tOff: Number(form.tOff),
      }
      if (editing) {
        await api.updateInterface(editing._id, payload)
        toast({ title: 'Interface atualizada', variant: 'success' })
      } else {
        await api.createInterface(payload)
        toast({ title: 'Interface criada', variant: 'success' })
      }
      setModalOpen(false)
      load()
    } catch (e) {
      console.error(e)
      const msg = e?.body?.error || e?.message || 'Erro'
      toast({ title: msg, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remover interface?')) return
    try {
      await api.deleteInterface(id)
      toast({ title: 'Interface removida', variant: 'success' })
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao remover', variant: 'destructive' })
    }
  }

  async function handleStatus(id, status) {
    try {
      await api.setInterfaceStatus(id, status)
      toast({ title: `Status alterado para ${status}`, variant: 'success' })
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao alterar status', variant: 'destructive' })
    }
  }

  const statusColors = {
    active: 'bg-green-100 text-green-800',
    inactive: 'bg-neutral-100 text-neutral-700',
  }

  const statusLabels = {
    active: 'Activo',
    inactive: 'Inactivo',
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Interfaces</h2>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> Nova Interface</Button>
      </div>

      {loading ? (
        <div className="text-neutral-500">A carregar...</div>
      ) : interfaces.length === 0 ? (
        <div className="text-neutral-500">Nenhuma interface registada.</div>
      ) : (
        <TooltipProvider>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {interfaces.map((iface) => (
              <div key={iface._id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
                {/* Header */}
                <div className="p-4 border-b">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-lg">{iface.name}</h3>
                    <span className={`text-xs px-3 py-1 rounded-full font-medium ${statusColors[iface.status] || statusColors.inactive}`}>
                      {statusLabels[iface.status] || iface.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <img src="/geral/interface.png" alt="Interface" className="w-12 h-12 object-contain rounded" />
                    <div className="flex-1 text-sm text-neutral-600">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">S/N:</span>
                        <span className="text-neutral-800">{iface.serialNumber}</span>
                      </div>
                      {iface.brand && (
                        <div className="text-neutral-500 text-xs mt-0.5">
                          {iface.brand} {iface.model}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Specs Grid */}
                <div className="p-4 p-4 border-b">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-white rounded px-3 py-2">
                      <div className="text-xs text-neutral-500 mb-0.5">Endereço</div>
                      <div className="font-semibold text-neutral-800">{iface.address}</div>
                    </div>
                    <div className="bg-white rounded px-3 py-2">
                      <div className="text-xs text-neutral-500 mb-0.5">Portos</div>
                      <div className="font-semibold text-neutral-800">{iface.ports || 2}</div>
                    </div>
                    <div className="bg-white rounded px-3 py-2">
                      <div className="text-xs text-neutral-500 mb-0.5">t_on</div>
                      <div className="font-semibold text-neutral-800">{iface.tOn} ms</div>
                    </div>
                    <div className="bg-white rounded px-3 py-2">
                      <div className="text-xs text-neutral-500 mb-0.5">t_off</div>
                      <div className="font-semibold text-neutral-800">{iface.tOff} ms</div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-4 flex gap-2">
                  {iface.status === 'active' ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="btn p-2 bg-green-600 text-white hover:bg-green-700 transition-colors" onClick={() => handleStatus(iface._id, 'inactive')}>
                          <Check className="h-5 w-5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={6}>Activo - Clique para desactivar</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="btn p-2 bg-neutral-200 text-neutral-800 hover:bg-neutral-300 transition-colors" onClick={() => handleStatus(iface._id, 'active')}>
                          <X className="h-5 w-5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={6}>Inactivo - Clique para activar</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="btn p-2 hover:bg-neutral-100 transition-colors" onClick={() => openEdit(iface)}>
                        <Pencil className="h-5 w-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent sideOffset={6}>Editar</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="btn btn-destructive p-2 ml-auto hover:bg-red-700 transition-colors" onClick={() => handleDelete(iface._id)}>
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent sideOffset={6}>Eliminar</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </TooltipProvider>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Interface' : 'Nova Interface'}>
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Nome <span className="text-red-500">*</span></label>
              <input className="border p-2 rounded w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Número de série <span className="text-red-500">*</span></label>
              <input className="border p-2 rounded w-full" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Marca</label>
              <input className="border p-2 rounded w-full" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Modelo</label>
              <input className="border p-2 rounded w-full" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Endereço <span className="text-red-500">*</span></label>
              <input className="border p-2 rounded w-full" type="number" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Portos <span className="text-red-500">*</span></label>
              <input className="border p-2 rounded w-full" type="number" min="1" max="16" value={form.ports} onChange={(e) => setForm({ ...form, ports: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">t_on [ms] <span className="text-red-500">*</span></label>
              <input className="border p-2 rounded w-full" type="number" value={form.tOn} onChange={(e) => setForm({ ...form, tOn: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">t_off [ms] <span className="text-red-500">*</span></label>
              <input className="border p-2 rounded w-full" type="number" value={form.tOff} onChange={(e) => setForm({ ...form, tOff: e.target.value })} required />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? 'A guardar...' : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

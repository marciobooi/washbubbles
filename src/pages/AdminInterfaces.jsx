import React, { useEffect, useState } from 'react'
import interfaceIcon from '@/assets/geral/interface.png'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Plus, Pencil, Trash2 } from 'lucide-react'
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
    active: 'bg-[#a9e0bc] text-[#0f2a2c]',
    inactive: 'bg-[#e4e7f0] text-[#4b5573]',
  }

  const statusLabels = {
    active: 'Activo',
    inactive: 'Inactivo',
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Interfaces</h2>
        <button
          onClick={openCreate}
          className="abtn"
        >
          <Plus className="w-[15px] h-[15px]" aria-hidden /> Nova Interface
        </button>
      </div>

      {loading ? (
        <div className="text-neutral-500">A carregar...</div>
      ) : interfaces.length === 0 ? (
        <div className="text-neutral-500">Nenhuma interface registada.</div>
      ) : (
        <TooltipProvider>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {interfaces.map((iface) => (
              <div key={iface._id} className="bg-white rounded-[20px] p-6 shadow-[0_1px_2px_rgba(20,25,30,0.04),0_8px_20px_-12px_rgba(20,25,30,0.08)] transition-shadow hover:shadow-[0_1px_2px_rgba(20,25,30,0.04),0_12px_28px_-12px_rgba(20,25,30,0.14)]">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-14 h-14 rounded-2xl bg-[#f0f4f2] flex items-center justify-center shrink-0 overflow-hidden">
                      <img src={interfaceIcon} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-extrabold text-xl text-[#1c2530] truncate">{iface.name}</div>
                      <div className="text-xs text-[#8a8478] mt-0.5 truncate">
                        S/N {iface.serialNumber}
                        {(iface.brand || iface.model) ? ` · ${[iface.brand, iface.model].filter(Boolean).join(' ')}` : ''}
                      </div>
                    </div>
                  </div>
                  <span className={`text-xs px-3 py-1.5 rounded-full font-bold shrink-0 ${statusColors[iface.status] || statusColors.inactive}`}>
                    {statusLabels[iface.status] || iface.status}
                  </span>
                </div>

                {/* Specs Grid */}
                <div className="bg-[#f7f5f1] rounded-2xl grid grid-cols-4 divide-x divide-black/[0.06] mb-5">
                  <div className="px-2 py-3 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-[#8a8478] font-bold mb-1">Endereço</div>
                    <div className="font-extrabold text-[#1c2530]">{iface.address}</div>
                  </div>
                  <div className="px-2 py-3 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-[#8a8478] font-bold mb-1">Portos</div>
                    <div className="font-extrabold text-[#1c2530]">{iface.ports || 2}</div>
                  </div>
                  <div className="px-2 py-3 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-[#8a8478] font-bold mb-1">T_ON</div>
                    <div className="font-extrabold text-[#1c2530]">{iface.tOn}ms</div>
                  </div>
                  <div className="px-2 py-3 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-[#8a8478] font-bold mb-1">T_OFF</div>
                    <div className="font-extrabold text-[#1c2530]">{iface.tOff}ms</div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={iface.status === 'active'}
                        onClick={() => handleStatus(iface._id, iface.status === 'active' ? 'inactive' : 'active')}
                        className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${iface.status === 'active' ? 'bg-[#a9e0bc]' : 'bg-neutral-300'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${iface.status === 'active' ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent sideOffset={6}>{iface.status === 'active' ? 'Activo - Clique para desactivar' : 'Inactivo - Clique para activar'}</TooltipContent>
                  </Tooltip>

                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="abtn abtn-icon" onClick={() => openEdit(iface)}>
                          <Pencil className="h-4 w-4 text-[#1c2530]" strokeWidth={1.7} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={6}>Editar</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="abtn abtn-icon abtn-danger" onClick={() => handleDelete(iface._id)}>
                          <Trash2 />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={6}>Eliminar</TooltipContent>
                    </Tooltip>
                  </div>
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

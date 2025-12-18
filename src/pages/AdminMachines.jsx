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
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [name, setName] = useState('')
  const [status, setStatus] = useState('active')

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

  useEffect(() => { load() }, [])

  function openNew() {
    setEditing(null)
    setName('')
    setStatus('active')
    setModalOpen(true)
  }

  function openEdit(m) {
    setEditing(m)
    setName(m.name)
    setStatus(m.status || 'active')
    setModalOpen(true)
  }

  async function save(e) {
    e?.preventDefault()
    try {
      if (editing) {
        await api.updateMachine(editing._id, { name, status })
        toast({ title: 'Máquina atualizada', variant: 'success' })
      } else {
        await api.createMachine({ name, status })
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
              <th className="px-4 py-2 text-left">Nome</th>
              <th className="px-4 py-2 text-left">Estado</th>
              <th className="px-4 py-2 text-left">Criado</th>
              <th className="px-4 py-2 text-left">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={4} className="p-4">Loading...</td>
              </tr>
            ) : machines.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4">Nenhuma máquina</td>
              </tr>
            ) : (
              machines.map((m) => (
                <tr key={m._id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">{m.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{m.status}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button className="btn p-2" title="Editar" aria-label="Editar" onClick={() => openEdit(m)}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button className="btn btn-destructive p-2" title="Remover" aria-label="Remover" onClick={() => remove(m._id)}>
                        <Trash2 className="h-4 w-4" />
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
        <form onSubmit={save} className="flex flex-col gap-2">
          <input className="border p-2 rounded" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="border p-2 rounded" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">active</option>
            <option value="offline">offline</option>
          </select>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setModalOpen(false)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
            <Button type="submit"><Check className="h-4 w-4 mr-2" />Salvar</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
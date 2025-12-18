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
  const [status, setStatus] = useState('free')
  const [weight, setWeight] = useState(0)
  const [moneyPrice, setMoneyPrice] = useState(0)
  const [loyaltyPrice, setLoyaltyPrice] = useState(0)
  const [type, setType] = useState('wash')

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
    setStatus('free')
    setWeight(0)
    setMoneyPrice(0)
    setLoyaltyPrice(0)
    setType('wash')
    setModalOpen(true)
  }

  function openEdit(m) {
    setEditing(m)
    setName(m.name)
    setStatus(m.status || 'free')
    setWeight(m.weight || 0)
    setMoneyPrice(m.price || 0)
    setLoyaltyPrice(m.loyaltyPrice || 0)
    setType(m.type || 'wash')
    setModalOpen(true)
  }

  async function save(e) {
    e?.preventDefault()
    try {
      const payload = { name, status, statusText: 'Livre', weight, price: moneyPrice, loyaltyPrice, type }
      if (icon) payload.icon = icon
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
              <th className="px-4 py-2 text-left">Tipo</th>
              <th className="px-4 py-2 text-left">Preço</th>
              <th className="px-4 py-2 text-left">Fidelidade</th>
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
                  <td className="px-4 py-3 flex items-center gap-2">
                    {m.icon && <img src={m.icon} alt="icon" className="h-8 w-8 object-contain" />}
                    <div>{m.name}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{m.type}</td>
                  <td className="px-4 py-3">{typeof m.price === 'number' ? m.price.toFixed(2) + '€' : m.price}</td>
                  <td className="px-4 py-3">{typeof m.loyaltyPrice === 'number' ? m.loyaltyPrice.toFixed(2) + '€' : m.loyaltyPrice}</td>
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
          <div>
            <label htmlFor="machine-name" className="text-sm font-medium">Nome</label>
            <input id="machine-name" className="border p-2 rounded mt-1 w-full" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label htmlFor="machine-weight" className="text-sm font-medium">Peso (kg)</label>
              <input id="machine-weight" className="border p-2 rounded mt-1 w-full" placeholder="Peso (kg)" type="number" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
            </div>

            <div>
              <label htmlFor="machine-price" className="text-sm font-medium">Preço (€)</label>
              <input id="machine-price" className="border p-2 rounded mt-1 w-full" placeholder="Preço (€)" type="number" step="0.01" value={moneyPrice} onChange={(e) => setMoneyPrice(Number(e.target.value))} />
            </div>

            <div>
              <label htmlFor="machine-loyalty" className="text-sm font-medium">Fidelidade (€)</label>
              <input id="machine-loyalty" className="border p-2 rounded mt-1 w-full" placeholder="Fidelidade (€)" type="number" step="0.01" value={loyaltyPrice} onChange={(e) => setLoyaltyPrice(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <div>
              <label htmlFor="machine-type" className="text-sm font-medium">Tipo</label>
              <select id="machine-type" className="border p-2 rounded mt-1 w-full" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="wash">Lavagem (wash)</option>
                <option value="dry">Secagem (dry)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">Pré-visualização</div>
              <img src={(editing && editing.icon) || (type === 'dry' ? '/drymachine/S1.png' : '/washingmashine/L1.png')} alt="preview" className="h-10 w-10 object-contain tealFilter" aria-hidden />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setModalOpen(false)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
            <Button type="submit"><Check className="h-4 w-4 mr-2" />Salvar</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
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
  const [weight, setWeight] = useState('')
  const [moneyPrice, setMoneyPrice] = useState('')
  const [loyaltyPrice, setLoyaltyPrice] = useState('')
  const [type, setType] = useState('wash')

  // Validation state
  const [errors, setErrors] = useState({})
  const [isSaving, setIsSaving] = useState(false)
  // animate preview when type changes
  const [animating, setAnimating] = useState(false)

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

  // animate preview when type changes
  useEffect(() => {
    setAnimating(true)
    const t = setTimeout(() => setAnimating(false), 320)
    return () => clearTimeout(t)
  }, [type])

  function openNew() {
    setEditing(null)
    setName('')
    setStatus('free')
    setWeight('')
    setMoneyPrice('')
    setLoyaltyPrice('')
    setType('wash')
    setErrors({})
    setModalOpen(true)
  }

  function openEdit(m) {
    setEditing(m)
    setName(m.name)
    setStatus(m.status || 'free')
    setWeight(m.weight !== undefined && m.weight !== null ? String(m.weight) : '')
    setMoneyPrice(m.price !== undefined && m.price !== null ? String(m.price) : '')
    setLoyaltyPrice(m.loyaltyPrice !== undefined && m.loyaltyPrice !== null ? String(m.loyaltyPrice) : '')
    setType(m.type || 'wash')
    setErrors({})
    setModalOpen(true)
  }

  async function save(e) {
    e?.preventDefault()
    // Client-side validation
    const newErrors = {}
    if (!name || !name.trim()) newErrors.name = 'Nome é obrigatório.'
    const mp = parseFloat(moneyPrice)
    if (moneyPrice === '' || Number.isNaN(mp)) newErrors.moneyPrice = 'Preço é obrigatório.'
    else if (mp < 0) newErrors.moneyPrice = 'Preço deve ser maior ou igual a 0.'
    if (loyaltyPrice !== '') {
      const lp = parseFloat(loyaltyPrice)
      if (Number.isNaN(lp) || lp < 0) newErrors.loyaltyPrice = 'Fidelidade deve ser maior ou igual a 0.'
    }

    if (weight !== '') {
      const w = parseFloat(weight)
      if (Number.isNaN(w) || w < 0) newErrors.weight = 'Peso deve ser maior ou igual a 0.'
    }

    if (Object.keys(newErrors).length) {
      setErrors(newErrors)
      return
    }

    setIsSaving(true)
    try {
      const payload = { name, status, statusText: 'Livre', weight: weight === '' ? 0 : parseFloat(weight), price: parseFloat(moneyPrice), loyaltyPrice: loyaltyPrice === '' ? 0 : parseFloat(loyaltyPrice), type }
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
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded ${m.status === 'working' ? 'bg-yellow-100 text-yellow-800' : m.status === 'offline' ? 'bg-gray-100 text-gray-800' : 'bg-green-100 text-green-800'}`}>{m.statusText || (m.status === 'working' ? 'Ocupado' : m.status === 'offline' ? 'Offline' : 'Livre')}</span>
                  </td>
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
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          {/* Left column: main fields */}
          <div className="md:col-span-2 space-y-3">
            <div>
              <label htmlFor="machine-name" className="text-sm font-medium">Nome</label>
              <input id="machine-name" className="border p-2 rounded mt-1 w-full" placeholder="Nome" value={name} onChange={(e) => { setName(e.target.value); if (errors.name && e.target.value.trim()) setErrors((s) => { const c = { ...s }; delete c.name; return c }); }} />
              {errors.name && <div className="text-xs text-destructive mt-1">{errors.name}</div>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="machine-weight" className="text-sm font-medium">Peso (kg)</label>
                <input id="machine-weight" className="border p-2 rounded mt-1 w-full" placeholder="Peso (kg)" type="number" value={weight} onChange={(e) => { setWeight(e.target.value); const v = parseFloat(e.target.value); if (errors.weight && !isNaN(v) && v >= 0) setErrors((s) => { const c = { ...s }; delete c.weight; return c }); }} />
                {errors.weight && <div className="text-xs text-destructive mt-1">{errors.weight}</div>}
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
                <label htmlFor="machine-price" className="text-sm font-medium">Preço (€)</label>
                <input id="machine-price" className="border p-2 rounded mt-1 w-full" placeholder="Preço (€)" type="number" step="0.01" value={moneyPrice} onChange={(e) => { setMoneyPrice(e.target.value); const v = parseFloat(e.target.value); if (errors.moneyPrice && !isNaN(v) && v >= 0) setErrors((s) => { const c = { ...s }; delete c.moneyPrice; return c }); }} />
                {errors.moneyPrice && <div className="text-xs text-destructive mt-1">{errors.moneyPrice}</div>}
              </div>

              <div>
                <label htmlFor="machine-loyalty" className="text-sm font-medium">Fidelidade (€)</label>
                <input id="machine-loyalty" className="border p-2 rounded mt-1 w-full" placeholder="Fidelidade (€)" type="number" step="0.01" value={loyaltyPrice} onChange={(e) => { setLoyaltyPrice(e.target.value); const v = parseFloat(e.target.value); if (errors.loyaltyPrice && !isNaN(v) && v >= 0) setErrors((s) => { const c = { ...s }; delete c.loyaltyPrice; return c }); }} />
                {errors.loyaltyPrice && <div className="text-xs text-destructive mt-1">{errors.loyaltyPrice}</div>}
              </div>
            </div>


          </div>

          {/* Right column: preview */}
          <div className="md:col-span-1">
            <div className="border rounded p-3 bg-muted-foreground/5">
              <div className="flex items-center gap-3">
                <img src={(editing && editing.icon) || (type === 'dry' ? '/drymachine/S1.png' : '/washingmashine/L1.png')} alt="preview" className={`h-12 w-12 object-contain rounded transition-transform duration-300 tealFilter ${animating ? 'scale-95 opacity-60' : 'scale-100 opacity-100'}`} aria-hidden />
                <div className="flex-1">
                    <div className="font-semibold">{name || (editing ? editing.name : 'Nome da máquina')}</div>
                    <div className="text-xs text-muted-foreground">{type === 'wash' ? 'Lavagem' : 'Secagem'} • {weight !== '' ? weight + ' kg' : '—'}</div>
                    <div className="text-sm mt-1">{moneyPrice !== '' ? Number(moneyPrice).toFixed(2) : (editing && editing.price ? editing.price.toFixed(2) : '—')}€ • Fidelidade: {loyaltyPrice !== '' ? Number(loyaltyPrice).toFixed(2) : (editing && typeof editing.loyaltyPrice === 'number' ? editing.loyaltyPrice.toFixed(2) : '—')}€</div>
                </div>

                {/* Dynamic status badge */}
                <div className={`text-xs px-2 py-1 rounded ${editing?.status === 'working' ? 'bg-yellow-100 text-yellow-800' : editing?.status === 'offline' ? 'bg-gray-100 text-gray-800' : 'bg-green-100 text-green-800'}`}>{editing?.statusText || (editing?.status === 'working' ? 'Ocupado' : editing?.status === 'offline' ? 'Offline' : 'Livre')}</div>
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
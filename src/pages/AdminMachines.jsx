import React, { useEffect, useState } from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'

export default function AdminMachines(){
  const [machines, setMachines] = useState([])
  const [loading, setLoading] = useState(false)
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
      toast({ title: 'Erro ao carregar máquinas', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function startEdit(m) {
    setEditing(m)
    setName(m.name)
    setStatus(m.status || 'active')
  }

  function resetForm() {
    setEditing(null)
    setName('')
    setStatus('active')
  }

  async function submit(e) {
    e.preventDefault()
    try {
      if (editing) {
        await api.updateMachine(editing._id, { name, status })
        toast({ title: 'Máquina atualizada', variant: 'success' })
      } else {
        await api.createMachine({ name, status })
        toast({ title: 'Máquina criada', variant: 'success' })
      }
      resetForm()
      load()
    } catch (e) {
      console.error(e)
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
      toast({ title: 'Erro ao remover', variant: 'destructive' })
    }
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Máquinas</h2>

      <div className="bg-white rounded shadow p-4 mb-4">
        <form onSubmit={submit} className="flex gap-2">
          <input className="border p-2 rounded flex-1" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="border p-2 rounded" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">active</option>
            <option value="offline">offline</option>
          </select>
          <button className="btn btn-primary" type="submit">{editing ? 'Atualizar' : 'Criar'}</button>
          {editing && <button type="button" className="btn" onClick={resetForm}>Cancelar</button>}
        </form>
      </div>

      <div className="bg-white rounded shadow p-4">
        {loading ? <div>Loading...</div> : (
          <ul>
            {machines.map((m) => (
              <li key={m._id} className="py-2 flex justify-between items-center border-b">
                <div>
                  <div className="font-semibold">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{m.status}</div>
                </div>
                <div className="flex gap-2">
                  <button className="btn" onClick={() => startEdit(m)}>Edit</button>
                  <button className="btn btn-destructive" onClick={() => remove(m._id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
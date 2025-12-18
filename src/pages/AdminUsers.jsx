import React, { useEffect, useState } from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'

export default function AdminUsers(){
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('user')

  async function load() {
    setLoading(true)
    try {
      const data = await api.getUsers()
      setUsers(data)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar utilizadores', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function startEdit(u) {
    setEditing(u)
    setUsername(u.username)
    setRole(u.role)
  }

  function resetForm() {
    setEditing(null)
    setUsername('')
    setRole('user')
  }

  async function submit(e) {
    e.preventDefault()
    try {
      if (editing) {
        await api.updateUser(editing._id, { username, role })
        toast({ title: 'Utilizador atualizado', variant: 'success' })
      } else {
        // Admin-level creation
        await api.createUser({ username, role })
        toast({ title: 'Utilizador criado', variant: 'success' })
      }
      resetForm()
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro', variant: 'destructive' })
    }
  }

  async function remove(id) {
    if (!confirm('Remover este utilizador?')) return
    try {
      await api.deleteUser(id)
      toast({ title: 'Utilizador removido', variant: 'success' })
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao remover', variant: 'destructive' })
    }
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Utilizadores</h2>

      <div className="bg-white rounded shadow p-4 mb-4">
        <form onSubmit={submit} className="flex gap-2">
          <input className="border p-2 rounded flex-1" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <select className="border p-2 rounded" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button className="btn btn-primary" type="submit">{editing ? 'Atualizar' : 'Criar'}</button>
          {editing && <button type="button" className="btn" onClick={resetForm}>Cancelar</button>}
        </form>
      </div>

      <div className="bg-white rounded shadow p-4">
        {loading ? <div>Loading...</div> : (
          <ul>
            {users.map((u) => (
              <li key={u._id} className="py-2 flex justify-between items-center border-b">
                <div>
                  <div className="font-semibold">{u.username}</div>
                  <div className="text-xs text-muted-foreground">{u.role}</div>
                </div>
                <div className="flex gap-2">
                  <button className="btn" onClick={() => startEdit(u)}>Edit</button>
                  <button className="btn btn-destructive" onClick={() => remove(u._id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
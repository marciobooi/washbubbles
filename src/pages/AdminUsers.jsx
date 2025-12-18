import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import Modal from '@/components/ui/Modal'
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AdminUsers(){
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('user')
  const [isSaving, setIsSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await api.getUsers()
      setUsers(data)
    } catch (e) {
      console.error(e)
      if (e && e.status === 401) {
        toast({ title: 'Sessão expirada, faça login novamente', variant: 'destructive' })
        navigate('/admin/login')
        return
      }
      toast({ title: 'Erro ao carregar utilizadores', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setEditing(null)
    setUsername('')
    setRole('user')
    setModalOpen(true)
  }

  function openEdit(u) {
    setEditing(u)
    setUsername(u.username)
    setRole(u.role)
    setModalOpen(true)
  }

  function resetForm() {
    setEditing(null)
    setUsername('')
    setRole('user')
    setModalOpen(false)
  }

  async function save(e) {
    e?.preventDefault()
    setIsSaving(true)
    try {
      if (editing) {
        await api.updateUser(editing._id, { username, role })
        toast({ title: 'Utilizador atualizado', variant: 'success' })
      } else {
        await api.createUser({ username, role })
        toast({ title: 'Utilizador criado', variant: 'success' })
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
    if (!confirm('Remover este utilizador?')) return
    try {
      await api.deleteUser(id)
      toast({ title: 'Utilizador removido', variant: 'success' })
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
        <h2 className="text-lg font-semibold">Utilizadores</h2>
        <div>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo Utilizador</Button>
        </div>
      </div>

      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full divide-y text-sm">
          <thead className="bg-muted-foreground/5">
            <tr>
              <th className="px-4 py-2 text-left">Username</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-left">API Key</th>
              <th className="px-4 py-2 text-left">Criado</th>
              <th className="px-4 py-2 text-left">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={5} className="p-4">Loading...</td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4">Nenhum utilizador</td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u._id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">{u.username}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{u.role}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{u.apiKey || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{u.createdAt ? new Date(u.createdAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button className="btn p-2" title="Editar" aria-label="Editar" onClick={() => openEdit(u)}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button className="btn btn-destructive p-2" title="Remover" aria-label="Remover" onClick={() => remove(u._id)}>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Utilizador' : 'Novo Utilizador'}>
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          <div className="md:col-span-2 space-y-3">
            <div>
              <label htmlFor="user-username" className="text-sm font-medium">Username</label>
              <input id="user-username" className="border p-2 rounded mt-1 w-full" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>

            <div>
              <label htmlFor="user-role" className="text-sm font-medium">Role</label>
              <select id="user-role" className="border p-2 rounded mt-1 w-full" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
          </div>

          <div className="md:col-span-1">
            <div className="border rounded p-3 bg-muted-foreground/5 h-full">
              <div className="flex flex-col gap-3 h-full justify-between">
                <div>
                  <div className="font-semibold">{username || (editing ? editing.username : 'Username')}</div>
                  <div className="text-xs text-muted-foreground">{role}</div>
                </div>

                <div className="flex justify-center">
                  <div className="h-12 w-12 rounded bg-neutral-50 flex items-center justify-center text-sm text-neutral-500">Key</div>
                </div>
              </div>
            </div>
          </div>

          <div className="md:col-span-3 flex justify-end gap-2 mt-4">
            <Button variant="outline" type="button" onClick={() => setModalOpen(false)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
            <Button type="submit" disabled={isSaving} aria-disabled={isSaving}>{isSaving ? 'Salvando...' : (<><Check className="h-4 w-4 mr-2" />Salvar</>)}</Button>
          </div>

        </form>
      </Modal>
    </div>
  )
}
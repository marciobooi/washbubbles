import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import Modal from '@/components/ui/Modal'
import PasswordInput from '@/components/ui/PasswordInput'
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../context/AuthContext' 

export default function AdminUsers(){
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('USER')
  const { role: myRole } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
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
    setRole('USER')
    setPassword('')
    setConfirmPassword('')
    setModalOpen(true)
  }

  function openEdit(u) {
    setEditing(u)
    setUsername(u.username)
    setRole((u.role || 'USER').toUpperCase())
    setPassword('')
    setConfirmPassword('')
    setModalOpen(true)
  }



  async function save(e) {
    e?.preventDefault()
    setIsSaving(true)
    try {
      // validate passwords when creating or when provided on update
      if (!editing) {
        if (!password || password.length < 8) throw new Error('A palavra-passe deve ter pelo menos 8 caracteres')
        if (password !== confirmPassword) throw new Error('Passwords do not match')
      } else if (password) {
        if (password.length < 8) throw new Error('A palavra-passe deve ter pelo menos 8 caracteres')
        if (password !== confirmPassword) throw new Error('Passwords do not match')
      }

      const payload = { username, role }
      if (password) payload.password = password

      if (editing) {
        await api.updateUser(editing._id, payload)
        toast({ title: 'Utilizador atualizado', variant: 'success' })
      } else {
        await api.createUser(payload)
        toast({ title: 'Utilizador criado', variant: 'success' })
      }
      setModalOpen(false)
      load()
    } catch (e) {
      console.error(e)
      const msg = e?.body?.error || e?.message || 'Erro'
      if (e && e.status === 401) {
        toast({ title: 'Sessão expirada, faça login novamente', variant: 'destructive' })
        navigate('/admin/login')
        return
      }
      toast({ title: msg, variant: 'destructive' })
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
          <button
            onClick={openNew}
            className="abtn"
          >
            <Plus className="w-[15px] h-[15px]" aria-hidden /> Novo Utilizador
          </button>
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
                      <button className="abtn abtn-icon" title="Editar" aria-label="Editar" onClick={() => openEdit(u)}>
                        <Pencil />
                      </button>
                      <button className="abtn abtn-icon abtn-danger" title="Remover" aria-label="Remover" onClick={() => remove(u._id)}>
                        <Trash2 />
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
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">

            <div>
              <label htmlFor="user-username" className="text-sm font-medium">Username</label>
              <input id="user-username" className="border p-2 rounded mt-1 w-full" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>

            <div>
              <label htmlFor="user-role" className="text-sm font-medium">Role</label>
              <select id="user-role" className="border p-2 rounded mt-1 w-full" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="USER">user</option>
                <option value="ADMIN">admin</option>
                <option value="KIOSK">kiosk</option>
                <option value="STAFF">staff (só leitura)</option>
                <option value="TECHNICIAN">técnico (máquinas/manutenção)</option>
                <option value="OPERATOR">operador (só iniciar / parar máquinas)</option>
                {myRole === 'SUPERADMIN' && <option value="SUPERADMIN">superadmin</option>}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">Password</label>
              <PasswordInput className="mt-2" autoComplete="new-password" placeholder="Definir password (opcional ao editar)" value={password} onChange={(e)=>setPassword(e.target.value)} />
            </div>

            <div>
              <label className="text-sm font-medium">Confirmar password</label>
              <PasswordInput className="mt-2" autoComplete="new-password" placeholder="Confirmar password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} />
            </div>

            <div className="md:col-span-2 text-xs text-muted-foreground">Password mínima: 8 caracteres. Deixe em branco para não alterar.</div>

          <div className="md:col-span-2 flex justify-end gap-2 mt-4">
            <Button variant="outline" type="button" onClick={() => setModalOpen(false)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
            <Button type="submit" disabled={isSaving} aria-disabled={isSaving}>{isSaving ? 'Salvando...' : (<><Check className="h-4 w-4 mr-2" />Salvar</>)}</Button>
          </div>

        </form>
      </Modal>
    </div>
  )
}
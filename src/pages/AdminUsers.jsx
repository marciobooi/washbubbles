import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import Modal from '@/components/ui/Modal'
import PasswordInput from '@/components/ui/PasswordInput'
import { Pencil, Trash2, Plus, Check, X, Lock, KeyRound, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../context/AuthContext' 

export default function AdminUsers(){
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  // Kiosk key: ask first, then show the new key ONCE.
  const [keyTarget, setKeyTarget] = useState(null) // the kiosk user being re-keyed (confirmation)
  const [newKey, setNewKey] = useState(null) // { username, key } shown once
  const [rotating, setRotating] = useState(false)
  async function rotateKiosk() {
    setRotating(true)
    try {
      const r = await api.rotateUserKey(keyTarget._id)
      setNewKey({ username: keyTarget.username, key: r.apiKey })
      setKeyTarget(null)
      load()
    } catch (e) {
      toast({ title: 'Não foi possível gerar a chave', description: e?.body?.error || e?.message, variant: 'destructive' })
    } finally { setRotating(false) }
  }
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
                    {u.role === 'KIOSK' ? (
                      // System account (API key, no password): listed, never editable from here.
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.12] px-3 py-1 text-xs font-semibold text-neutral-500" title="Utilizador de sistema do quiosque: tem chave de acesso e não tem palavra-passe. Não pode ser alterado nem removido aqui.">
                        <Lock className="h-3.5 w-3.5" aria-hidden /> Sistema
                      </span>
                    ) : null}
                    {u.role === 'KIOSK' ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button className="abtn abtn-sm" onClick={() => setKeyTarget(u)} title="Gerar uma chave nova para este quiosque">
                          <KeyRound /> Gerar nova chave
                        </button>
                        {u.pendingKey && <span className="text-xs font-semibold text-amber-700">Nova chave ainda por usar</span>}
                      </div>
                    ) : (
                    <div className="flex gap-2">
                      <button className="abtn abtn-icon" title="Editar" aria-label="Editar" onClick={() => openEdit(u)}>
                        <Pencil />
                      </button>
                      <button className="abtn abtn-icon abtn-danger" title="Remover" aria-label="Remover" onClick={() => remove(u._id)}>
                        <Trash2 />
                      </button>
                    </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={!!keyTarget} onClose={() => setKeyTarget(null)} title="Gerar nova chave do quiosque">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold m-0">Gerar nova chave do quiosque?</h3>
          <p className="text-sm text-neutral-600 m-0">
            É a chave com que a loja fala com este servidor. A chave atual <strong>continua a funcionar</strong> até a nova ser usada pela primeira vez, por isso a loja não fica sem ligação.
            Depois de gerada, introduza-a no quiosque (engrenagem → PIN → <em>Chave do servidor</em>). Quando a loja a usar pela primeira vez, a antiga deixa de funcionar.
          </p>
          <div className="flex justify-end gap-2">
            <button className="abtn" onClick={() => setKeyTarget(null)} disabled={rotating}>Cancelar</button>
            <button className="abtn abtn-primary" onClick={rotateKiosk} disabled={rotating}>{rotating ? 'A gerar…' : 'Gerar chave'}</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!newKey} onClose={() => setNewKey(null)} title="Nova chave do quiosque">
        {newKey && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold m-0">Nova chave de «{newKey.username}»</h3>
            <p className="text-sm text-neutral-600 m-0">Copie-a agora: <strong>só aparece desta vez</strong>. No quiosque: engrenagem → PIN → <em>Chave do servidor</em> → escreva-a (os traços são opcionais).</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-xl border bg-neutral-50 px-4 py-3 text-lg font-bold tracking-wider text-center select-all">{newKey.key}</code>
              <button className="abtn abtn-icon" aria-label="Copiar" title="Copiar" onClick={() => { try { navigator.clipboard.writeText(newKey.key); toast({ title: 'Chave copiada', variant: 'success' }) } catch { /* the key is selectable */ } }}><Copy /></button>
            </div>
            <p className="text-xs text-neutral-500 m-0">Se a perder, gere outra: a que ainda não foi usada é substituída.</p>
            <div className="flex justify-end"><button className="abtn abtn-primary" onClick={() => setNewKey(null)}>Já a copiei</button></div>
          </div>
        )}
      </Modal>

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
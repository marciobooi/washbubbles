import React, { useEffect, useState } from 'react'
import { shopDateTime } from '@/lib/shopTime'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import Modal from '@/components/ui/Modal'
import PasswordInput from '@/components/ui/PasswordInput'
import { Pencil, Trash2, Plus, Check, X, Lock, KeyRound, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Skeleton from '@/components/ui/Skeleton'
import PageHeader from '@/components/PageHeader'
import { useAuth } from '@/context/AuthContext'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

function UserForm({ 
  editing, 
  modalOpen, 
  onClose, 
  onSubmit,
  isSaving,
  formData,
  setFormData,
  myRole
}) {
  const { username, role, password, confirmPassword } = formData
  const roles = [
    { value: 'USER', label: 'user' },
    { value: 'ADMIN', label: 'admin' },
    { value: 'KIOSK', label: 'kiosk' },
    { value: 'STAFF', label: 'staff (só leitura)' },
    { value: 'TECHNICIAN', label: 'técnico (máquinas/manutenção)' },
    { value: 'OPERATOR', label: 'operador (máquinas, fecho de caixa e hopper)' },
    ...(myRole === 'SUPERADMIN' ? [{ value: 'SUPERADMIN', label: 'superadmin' }] : []),
  ]

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  return (
    <Modal open={modalOpen} onClose={onClose} title={editing ? 'Editar Utilizador' : 'Novo Utilizador'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="user-username">Username</Label>
            <Input id="user-username" placeholder="Username" value={username} onChange={(e) => handleInputChange('username', e.target.value)} />
          </div>

          <div>
            <Label htmlFor="user-role">Role</Label>
            <Select value={role} onValueChange={(v) => handleInputChange('role', v)}>
              <SelectTrigger id="user-role">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Password</Label>
            <PasswordInput className="mt-2" autoComplete="new-password" placeholder="Definir password (opcional ao editar)" value={password} onChange={(e) => handleInputChange('password', e.target.value)} />
          </div>

          <div>
            <Label>Confirmar password</Label>
            <PasswordInput className="mt-2" autoComplete="new-password" placeholder="Confirmar password" value={confirmPassword} onChange={(e) => handleInputChange('confirmPassword', e.target.value)} />
          </div>

          <div className="md:col-span-2 text-xs text-muted-foreground">Password mínima: 8 caracteres. Deixe em branco para não alterar.</div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t mt-4">
          <Button variant="outline" type="button" onClick={onClose}>
            <X className="h-4 w-4 mr-2" /> Cancelar
          </Button>
          <Button type="submit" disabled={isSaving} aria-disabled={isSaving}>
            {isSaving ? 'A guardar...' : <> <Check className="h-4 w-4 mr-2" /> Guardar </>}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function KioskKeyModal({ keyTarget, newKey, rotating, onCloseKeyTarget, onCloseNewKey, onRotateKiosk }) {
  if (keyTarget) {
    return (
      <Modal open={true} onClose={onCloseKeyTarget} title="Gerar nova chave do quiosque">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold m-0">Gerar nova chave do quiosque?</h3>
          <p className="text-sm text-neutral-600 m-0">
            É a chave com que a loja fala com este servidor. A chave atual <strong>continua a funcionar</strong> até a nova ser usada pela primeira vez, por isso a loja não fica sem ligação.
            Depois de gerada, introduza-a no quiosque (engrenagem → PIN → <em>Chave do servidor</em>). Quando a loja a usar pela primeira vez, a antiga deixa de funcionar.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCloseKeyTarget} disabled={rotating}>Cancelar</Button>
            <Button onClick={onRotateKiosk} disabled={rotating}>{rotating ? 'A gerar…' : 'Gerar chave'}</Button>
          </div>
        </div>
      </Modal>
    )
  }

  if (newKey) {
    return (
      <Modal open={true} onClose={onCloseNewKey} title="Nova chave do quiosque">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold m-0">Nova chave de «{newKey.username}»</h3>
          <p className="text-sm text-neutral-600 m-0">Copie-a agora: <strong>só aparece desta vez</strong>. No quiosque: engrenagem → PIN → <em>Chave do servidor</em> → escreva-a (os traços são opcionais).</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-xl border bg-neutral-50 px-4 py-3 text-lg font-bold tracking-wider text-center select-all">{newKey.key}</code>
            <Button variant="ghost" size="icon" aria-label="Copiar" title="Copiar" onClick={() => { try { navigator.clipboard.writeText(newKey.key); toast({ title: 'Chave copiada', variant: 'success' }) } catch { /* the key is selectable */ } }}>
              <Copy />
            </Button>
          </div>
          <p className="text-xs text-neutral-500 m-0">Se a perder, gere outra: a que ainda não foi usada é substituída.</p>
          <div className="flex justify-end"><Button onClick={onCloseNewKey}>Já a copiei</Button></div>
        </div>
      </Modal>
    )
  }

  return null
}

export default function AdminUsers() {
  const navigate = useNavigate()
  const { role: myRole } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [keyTarget, setKeyTarget] = useState(null)
  const [newKey, setNewKey] = useState(null)
  const [rotating, setRotating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState({
    username: '',
    role: 'USER',
    password: '',
    confirmPassword: '',
  })

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
    setFormData({
      username: '',
      role: 'USER',
      password: '',
      confirmPassword: '',
    })
    setModalOpen(true)
  }

  function openEdit(u) {
    setEditing(u)
    setFormData({
      username: u.username,
      role: (u.role || 'USER').toUpperCase(),
      password: '',
      confirmPassword: '',
    })
    setModalOpen(true)
  }

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

  async function save(e) {
    e?.preventDefault()
    setIsSaving(true)
    try {
      // validate passwords when creating or when provided on update
      if (!editing) {
        if (!formData.password || formData.password.length < 8) throw new Error('A palavra-passe deve ter pelo menos 8 caracteres')
        if (formData.password !== formData.confirmPassword) throw new Error('Passwords do not match')
      } else if (formData.password) {
        if (formData.password.length < 8) throw new Error('A palavra-passe deve ter pelo menos 8 caracteres')
        if (formData.password !== formData.confirmPassword) throw new Error('Passwords do not match')
      }

      const payload = { username: formData.username, role: formData.role }
      if (formData.password) payload.password = formData.password

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
    <div className="p-4 md:p-6 max-w-[1180px] mx-auto">
      <PageHeader
        title="Utilizadores"
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" aria-hidden /> Novo Utilizador
          </Button>
        }
      />

      <Card className="overflow-auto">
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
          <tbody className="divide-y divide-black/[0.06]">
            {loading ? (
              <tr>
                <td colSpan={5} className="p-4"><Skeleton height="1.25rem" /></td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-center text-[#8a8478]">Nenhum utilizador</td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u._id} className="hover:bg-neutral-50/50">
                  <td className="px-4 py-3">{u.username}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{u.role}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{u.apiKey || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{u.createdAt ? shopDateTime(u.createdAt) : '—'}</td>
                  <td className="px-4 py-3">
                    {u.role === 'KIOSK' ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.12] px-3 py-1 text-xs font-semibold text-neutral-500" title="Utilizador de sistema do quiosque: tem chave de acesso e não tem palavra-passe. Não pode ser alterado nem removido aqui.">
                          <Lock className="h-3.5 w-3.5" aria-hidden /> Sistema
                        </span>
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setKeyTarget(u)} title="Gerar uma chave nova para este quiosque">
                            <KeyRound className="h-3.5 w-3.5 mr-1" /> Gerar nova chave
                          </Button>
                          {u.pendingKey && <span className="text-xs font-semibold text-amber-700">Nova chave ainda por usar</span>}
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" title="Editar" aria-label="Editar" onClick={() => openEdit(u)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon" title="Remover" aria-label="Remover" onClick={() => remove(u._id)} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <KioskKeyModal
        keyTarget={keyTarget}
        newKey={newKey}
        rotating={rotating}
        onCloseKeyTarget={() => setKeyTarget(null)}
        onCloseNewKey={() => setNewKey(null)}
        onRotateKiosk={rotateKiosk}
      />

      <UserForm
        editing={editing}
        modalOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={save}
        isSaving={isSaving}
        formData={formData}
        setFormData={setFormData}
        myRole={myRole}
      />
    </div>
  )
}
import React, { useEffect, useState } from 'react'
import { useTenant } from '../context/TenantContext'
import RequireSuperAdmin from '../components/RequireSuperAdmin'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import api from '@/services/api'
import { Pencil, UserPlus, Plus, Check, X } from 'lucide-react'

export default function AdminTenants() {
  const { tenants = [], loading, loadError, refreshTenants, createTenant, updateTenant, assignUser } = useTenant()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [domains, setDomains] = useState('') // site addresses, comma separated
  const [renameDomains, setRenameDomains] = useState('')
  const [creating, setCreating] = useState(false)

  const [users, setUsers] = useState([])
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [assignTarget, setAssignTarget] = useState(null)
  const [assignUserId, setAssignUserId] = useState('')
  const [assignRole, setAssignRole] = useState('MEMBER')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => {})
    refreshTenants()
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    if (!name || !slug) return
    setCreating(true)
    try {
      await createTenant({ name, slug, domains })
      toast({ title: 'Loja criada — começa vazia: crie os preços, interfaces e máquinas dela', variant: 'success' })
      setName(''); setSlug(''); setDomains('')
    } catch (err) {
      toast({ title: err?.body?.error || err?.message || 'Erro ao criar tenant', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  function openRename(t) {
    setRenameTarget(t)
    setRenameValue(t.name)
    setRenameDomains((t.domains || []).join(', '))
  }

  async function saveRename(e) {
    e.preventDefault()
    if (!renameValue) return
    setSaving(true)
    try {
      await updateTenant(renameTarget._id, { name: renameValue, domains: renameDomains })
      toast({ title: 'Tenant atualizado', variant: 'success' })
      setRenameTarget(null)
    } catch (err) {
      toast({ title: err?.body?.error || err?.message || 'Erro ao atualizar tenant', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  function openAssign(t) {
    setAssignTarget(t)
    setAssignUserId('')
    setAssignRole('MEMBER')
  }

  async function saveAssign(e) {
    e.preventDefault()
    if (!assignUserId) return
    setSaving(true)
    try {
      await assignUser(assignTarget._id, assignUserId, assignRole)
      toast({ title: 'Utilizador associado ao tenant', variant: 'success' })
      setAssignTarget(null)
    } catch (err) {
      toast({ title: err?.body?.error || err?.message || 'Erro ao associar utilizador', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <RequireSuperAdmin>
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-4">Tenants</h2>

        <form onSubmit={handleCreate} className="flex flex-wrap gap-2 mb-4">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="border rounded px-3 py-2 text-sm" />
          <input placeholder="Slug" value={slug} onChange={(e) => setSlug(e.target.value)} className="border rounded px-3 py-2 text-sm" />
          <input placeholder="Endereços do site (ex: marcioslvinc.ro, www.marcioslvinc.ro)" value={domains} onChange={(e) => setDomains(e.target.value)} className="border rounded px-3 py-2 text-sm min-w-[320px]" />
          <Button type="submit" disabled={creating}>
            <Plus className="h-4 w-4 mr-2" /> {creating ? 'A criar...' : 'Create'}
          </Button>
        </form>

        <div className="bg-white rounded shadow divide-y">
          {tenants.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              {loading ? 'A carregar…' : loadError ? (<>Não foi possível carregar as lojas. <button type="button" className="underline" onClick={() => refreshTenants()}>Tentar de novo</button></>) : 'Nenhuma loja'}
            </div>
          ) : (
            tenants.map((t) => (
              <div key={t._id} className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.slug} · {t._id}</div>
                  <div className="text-xs text-neutral-600">{(t.domains || []).length ? `Site: ${t.domains.join(', ')}` : 'Sem endereço de site'}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openRename(t)}>
                    <Pencil className="h-4 w-4 mr-2" /> Rename
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openAssign(t)}>
                    <UserPlus className="h-4 w-4 mr-2" /> Assign user
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <Modal open={!!renameTarget} onClose={() => setRenameTarget(null)} title="Rename Tenant">
          <form onSubmit={saveRename} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <input className="border p-2 rounded mt-1 w-full" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="text-sm font-medium">Endereços do site</label>
              <input className="border p-2 rounded mt-1 w-full" placeholder="marcioslvinc.ro, www.marcioslvinc.ro" value={renameDomains} onChange={(e) => setRenameDomains(e.target.value)} />
              <p className="text-xs text-neutral-500 mt-1">Um endereço só pode pertencer a uma loja. Separe por vírgulas.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setRenameTarget(null)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? 'A guardar...' : (<><Check className="h-4 w-4 mr-2" />Salvar</>)}</Button>
            </div>
          </form>
        </Modal>

        <Modal open={!!assignTarget} onClose={() => setAssignTarget(null)} title="Assign user to tenant">
          <form onSubmit={saveAssign} className="space-y-4">
            <div>
              <label className="text-sm font-medium">User</label>
              <select className="border p-2 rounded mt-1 w-full" value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
                <option value="">Select a user…</option>
                {users.map((u) => (
                  <option key={u._id} value={u._id}>{u.username} ({u.role})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <select className="border p-2 rounded mt-1 w-full" value={assignRole} onChange={(e) => setAssignRole(e.target.value)}>
                <option value="MEMBER">member</option>
                <option value="ADMIN">admin</option>
                <option value="OWNER">owner</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setAssignTarget(null)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
              <Button type="submit" disabled={saving || !assignUserId}>{saving ? 'A guardar...' : (<><Check className="h-4 w-4 mr-2" />Salvar</>)}</Button>
            </div>
          </form>
        </Modal>
      </div>
    </RequireSuperAdmin>
  )
}

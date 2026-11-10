import React from 'react'
import { KeyRound } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import { Button } from '@/components/ui/button'
import PasswordInput from '@/components/ui/PasswordInput'
import { Label } from '@/components/ui/label'
import { useAuth } from '../context/AuthContext'

const MIN_LENGTH = 8

// The username is in the sign-in token (its payload is not secret): shown so the person knows which account they are changing.
function usernameFrom(token) {
  try {
    const p = JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return p.username || ''
  } catch { return '' }
}

/** Every dashboard user changes their own password here (reached from the role menu in the top bar). */
export default function AdminProfile() {
  const { token, role, tenant, login } = useAuth()
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (newPassword.length < MIN_LENGTH) { toast({ title: `A nova palavra-passe deve ter pelo menos ${MIN_LENGTH} caracteres`, variant: 'destructive' }); return }
    if (newPassword !== confirm) { toast({ title: 'As palavras-passe não coincidem', variant: 'destructive' }); return }
    if (newPassword === currentPassword) { toast({ title: 'A nova palavra-passe tem de ser diferente da atual', variant: 'destructive' }); return }
    try {
      setLoading(true)
      const res = await api.changePassword({ currentPassword, newPassword })
      // every session opened before the change is closed by the server; this one carries on with the new token
      if (res?.token) login({ token: res.token, role, tenant })
      toast({ title: 'Palavra-passe atualizada', variant: 'success' })
      setCurrentPassword(''); setNewPassword(''); setConfirm('')
    } catch (err) {
      const msg = err?.body?.error === 'Invalid current password' ? 'A palavra-passe atual não está certa' : (err?.body?.error || err?.message || 'Não foi possível alterar a palavra-passe')
      toast({ title: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const user = usernameFrom(token)
  return (
    <div className="p-4 max-w-md">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-[#a9e0bc] flex items-center justify-center"><KeyRound className="h-5 w-5 text-[#1c2530]" strokeWidth={1.8} /></div>
        <div>
          <h2 className="text-lg font-semibold leading-tight">Alterar palavra-passe</h2>
          {user && <p className="text-sm text-[#8a8478]">Conta: {user}</p>}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 bg-white rounded-2xl border border-black/[0.07] shadow-sm p-6">
        <div className="space-y-1.5">
          <Label htmlFor="cur">Palavra-passe atual</Label>
          <PasswordInput id="cur" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new">Nova palavra-passe <span className="text-[#8a8478] font-normal">(mínimo {MIN_LENGTH} caracteres)</span></Label>
          <PasswordInput id="new" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="conf">Confirmar nova palavra-passe</Label>
          <PasswordInput id="conf" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <div className="flex justify-end pt-1">
          <Button type="submit" disabled={loading || !currentPassword || !newPassword || !confirm}>{loading ? 'A guardar…' : 'Alterar palavra-passe'}</Button>
        </div>
      </form>
    </div>
  )
}

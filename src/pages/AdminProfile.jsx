import React from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import { Button } from '@/components/ui/button'

export default function AdminProfile(){
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  async function handleSubmit(e){
    e.preventDefault()
    if (newPassword.length < 6){ toast({ title: 'A nova password deve ter pelo menos 6 caracteres', variant: 'destructive' }); return }
    if (newPassword !== confirm){ toast({ title: 'As passwords não coincidem', variant: 'destructive' }); return }
    try {
      setLoading(true)
      await api.changePassword({ currentPassword, newPassword })
      toast({ title: 'Password atualizada', variant: 'success' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
    } catch (e) {
      console.error(e)
      const msg = e?.body?.error || e?.message || 'Erro ao alterar password'
      toast({ title: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Perfil</h2>

      <div className="bg-white rounded shadow p-6 max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Password atual</label>
            <input type="password" className="w-full mt-2 p-2 border rounded" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Nova password</label>
            <input type="password" className="w-full mt-2 p-2 border rounded" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Confirmar nova password</label>
            <input type="password" className="w-full mt-2 p-2 border rounded" value={confirm} onChange={(e)=>setConfirm(e.target.value)} />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={loading}>{loading ? 'A processar...' : 'Alterar password'}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
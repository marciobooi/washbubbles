import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ShieldCheck } from 'lucide-react'

export default function StaffTab() {
  const [adminPin, setAdminPin] = useState('')
  const [pinIsSet, setPinIsSet] = useState(false) // the PIN itself is never sent back: only whether one exists
  const [pinAge, setPinAge] = useState(null) // { setAt, expiresAt, expired, daysLeft }: a staff PIN is renewed every Monday
  const [savingPin, setSavingPin] = useState(false)
  const [kioskLockEnabled, setKioskLockEnabled] = useState(false)
  const [savingLockToggle, setSavingLockToggle] = useState(false)

  async function loadStaffSettings() {
    try {
      const pin = await api.getSetting('adminPin').catch(() => null)
      const lockEnabled = await api.getSetting('kioskLockEnabled').catch(() => null)
      setAdminPin('')
      setPinIsSet(Boolean(pin && pin.isSet))
      setPinAge(pin && pin.isSet && pin.expiresAt ? pin : null)
      setKioskLockEnabled(Boolean(lockEnabled && lockEnabled.value))
    } catch (e) { console.warn('loadStaffSettings failed', e) }
  }

  useEffect(() => { loadStaffSettings() }, [])

  async function removeAdminPin() {
    if (!window.confirm('Remover o PIN de staff? As ações de staff no quiosque ficam bloqueadas até definir outro.')) return
    setSavingPin(true)
    try {
      await api.setSetting({ key: 'adminPin', value: null })
      setAdminPin(''); setPinIsSet(false); setPinAge(null)
      toast({ title: 'PIN de staff removido — ações de staff ficam bloqueadas', variant: 'success' })
    } catch (e) {
      toast({ title: 'Erro ao remover o PIN', variant: 'destructive' })
    } finally { setSavingPin(false) }
  }

  async function saveAdminPin(e) {
    e.preventDefault()
    if (!adminPin) {
      return toast({ title: pinIsSet ? 'Escreva o PIN novo (4 a 8 dígitos) para o alterar' : 'Escreva um PIN (4 a 8 dígitos)', variant: 'destructive' })
    }
    if (!/^\d{4,8}$/.test(adminPin)) {
      return toast({ title: 'O PIN deve ter entre 4 e 8 dígitos', variant: 'destructive' })
    }
    setSavingPin(true)
    try {
      await api.setSetting({ key: 'adminPin', value: adminPin })
      setAdminPin(''); setPinIsSet(true)
      toast({ title: 'PIN de staff atualizado', description: 'Vale até à próxima segunda-feira. Passe-o aos funcionários.', variant: 'success' })
      loadStaffSettings()
    } catch (e) {
      console.error(e)
      toast({ title: e?.body?.error || 'Erro ao guardar PIN', variant: 'destructive' })
    } finally {
      setSavingPin(false)
    }
  }

  async function toggleKioskLock(nextEnabled) {
    setSavingLockToggle(true)
    setKioskLockEnabled(nextEnabled) // optimistic — the kiosk polls this, so a beat of lag is fine either way
    try {
      await api.setSetting({ key: 'kioskLockEnabled', value: nextEnabled })
      toast({ title: nextEnabled ? 'Bloqueio de ecrã ativado' : 'Bloqueio de ecrã desativado', variant: 'success' })
    } catch (e) {
      console.error(e)
      setKioskLockEnabled(!nextEnabled)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally {
      setSavingLockToggle(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff &amp; Manutenção</CardTitle>
        <CardDescription>PIN de staff e bloqueio de ecrã do quiosque durante manutenção</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={saveAdminPin} className="space-y-2 max-w-xs">
          <Label htmlFor="adminPin">PIN de staff</Label>
          <Input
            id="adminPin"
            type="text"
            inputMode="numeric"
            placeholder={pinIsSet ? 'PIN definido — escreva um novo para o alterar' : 'Ex: 4821'}
            autoComplete="off"
            value={adminPin}
            onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
          {pinAge && (
            <p className={`text-sm font-medium ${pinAge.expired ? 'text-red-600' : pinAge.daysLeft <= 1 ? 'text-amber-600' : 'text-muted-foreground'}`}>
              {pinAge.expired
                ? 'PIN expirado: o quiosque já não o aceita. Crie um PIN novo.'
                : `PIN válido até ${new Date(pinAge.expiresAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })} (${pinAge.daysLeft === 1 ? 'falta menos de 1 dia' : `faltam ${pinAge.daysLeft} dias`}).`}
            </p>
          )}
          {pinAge?.setAt && (
            <p className="text-xs text-muted-foreground">
              Última alteração: {new Date(pinAge.setAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}{pinAge.setVia === 'kiosk' ? ' (feita no quiosque pelo staff, com o PIN antigo)' : pinAge.setVia === 'admin' ? ' (feita aqui no admin)' : ''}.
              Por segurança o PIN guarda-se cifrado e não pode ser mostrado: se não o souber, defina um novo aqui.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            O PIN expira todas as segundas-feiras: depois disso o quiosque responde &quot;PIN expirado&quot; e a pessoa pode definir um novo no próprio quiosque (precisa do PIN antigo), ou criá-lo aqui.
            Necessário no quiosque para pagamento manual, fecho de caixa e bloqueio de ecrã.
            Sem um PIN definido, essas ações ficam bloqueadas — nunca desativadas por omissão.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" size="sm" disabled={savingPin}>
              {savingPin ? 'A guardar…' : (pinIsSet ? 'Alterar PIN' : 'Guardar PIN')}
            </Button>
            {pinIsSet && <Button type="button" size="sm" variant="outline" disabled={savingPin} onClick={removeAdminPin}>Remover PIN</Button>}
          </div>
        </form>

        <div className="border-t pt-4 flex items-start justify-between gap-4 max-w-xl">
          <div>
            <div className="font-medium text-sm">Bloqueio de ecrã do quiosque</div>
            <p className="text-xs text-muted-foreground mt-1">
              Quando ativo, o staff pode congelar o ecrã do quiosque (com PIN) durante
              manutenção física — reabastecer o hopper, destravar uma máquina, etc. —
              para que um cliente não possa tocar no ecrã entretanto.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={kioskLockEnabled}
            onClick={() => toggleKioskLock(!kioskLockEnabled)}
            disabled={savingLockToggle}
            className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50
              ${kioskLockEnabled ? 'bg-primary-600' : 'bg-neutral-300'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${kioskLockEnabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

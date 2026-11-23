import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ShieldCheck, Trash2, Plus, Eraser } from 'lucide-react'

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} disabled={disabled}
      className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-primary-600' : 'bg-neutral-300'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

export default function StaffTab() {
  const [adminPin, setAdminPin] = useState('')
  const [pinIsSet, setPinIsSet] = useState(false) // the PIN itself is never sent back: only whether one exists
  const [pinAge, setPinAge] = useState(null) // { setAt, expiresAt, expired, daysLeft }: a staff PIN is renewed every Monday
  const [savingPin, setSavingPin] = useState(false)
  const [kioskLockEnabled, setKioskLockEnabled] = useState(false)
  const [savingLockToggle, setSavingLockToggle] = useState(false)
  const [pinVisible, setPinVisible] = useState(false)
  const [pinEnabled, setPinEnabled] = useState(true)
  const [cards, setCards] = useState({ enabled: false, cards: [] })
  const [newLabel, setNewLabel] = useState('')
  const [savingCards, setSavingCards] = useState(false)

  async function saveCards(next, okTitle) {
    setSavingCards(true)
    const before = cards
    setCards(next)
    try {
      await api.setSetting({ key: 'staffCards', value: next })
      toast({ title: okTitle, variant: 'success' })
    } catch (e) {
      console.error(e)
      setCards(before)
      toast({ title: 'Erro ao guardar', variant: 'destructive' })
    } finally { setSavingCards(false) }
  }
  const [writing, setWriting] = useState(false)
  // a command asked of the shop PC through the central server: wait for its answer (the card has 45 s to be put in)
  async function waitForShop(r) {
    if (!r.queued) return r
    toast({ title: 'Pedido enviado à loja', description: 'Ponha o cartão no leitor do quiosque.' })
    const id = r.commandIds?.[0]
    for (let i = 0; i < 40; i++) {
      await new Promise((ok) => setTimeout(ok, 3000))
      const c = await api.adminCommand(id).catch(() => null)
      if (c?.status === 'done') return c.result || {}
      if (c?.status === 'failed') return { error: c.error }
    }
    return { error: 'A loja não respondeu a tempo. Veja se o PC está ligado.' }
  }
  async function eraseCard(c) {
    if (!window.confirm(`Apagar o cartão-mestre ${c.label || c.code}? Ponha ESSE cartão no leitor do quiosque. Fica em branco (pode dá-lo a um cliente) e sai da lista.`)) return
    setWriting(true)
    try {
      const r = await waitForShop(await api.blankStaffCard(c.code))
      if (r.error) throw Object.assign(new Error(r.error), { shown: true })
      await saveCards({ ...cards, cards: cards.cards.filter((x) => x.code !== c.code) }, 'Cartão apagado: está em branco e saiu da lista')
    } catch (err) {
      toast({ title: err?.body?.error || err.message || 'Erro ao apagar o cartão', variant: 'destructive' })
    } finally { setWriting(false) }
  }
  async function addCard(e) {
    e.preventDefault()
    if (cards.cards.length >= 10) return toast({ title: 'No máximo 10 cartões-mestre', variant: 'destructive' })
    if (!window.confirm('Ponha um cartão EM BRANCO no leitor do quiosque. Vai ser gravado como cartão-mestre (um cartão com dados, como o de um cliente, é recusado). Continuar?')) return
    setWriting(true)
    try {
      let r = await api.writeStaffCard()
      if (r.queued) {
        // asked of the shop PC through the central server: wait for its answer (the card has 45 s to be put in)
        toast({ title: 'Pedido enviado à loja', description: 'Ponha o cartão em branco no leitor do quiosque.' })
        const id = r.commandIds?.[0]
        r = { error: 'A loja não respondeu a tempo. Veja se o PC está ligado.' }
        for (let i = 0; i < 40; i++) {
          await new Promise((ok) => setTimeout(ok, 3000))
          const c = await api.adminCommand(id).catch(() => null)
          if (c?.status === 'done') { r = c.result || {}; break }
          if (c?.status === 'failed') { r = { error: c.error }; break }
        }
      }
      if (!r.code) throw Object.assign(new Error(r.error || 'Não foi possível gravar o cartão'), { shown: true })
      await saveCards({ ...cards, enabled: true, cards: [...cards.cards, { code: String(r.code), label: newLabel.trim() }] }, 'Cartão-mestre gravado e adicionado')
      setNewLabel('')
    } catch (err) {
      toast({ title: err?.body?.error || err.message || 'Erro ao gravar o cartão', variant: 'destructive' })
    } finally { setWriting(false) }
  }
  async function togglePinEnabled(next) {
    if (!next && !(cards.enabled && cards.cards.length) && !window.confirm('Não há cartões-mestre ligados: sem PIN, ninguém entra na área de staff do quiosque. Desligar mesmo assim?')) return
    setPinEnabled(next)
    try { await api.setSetting({ key: 'staffPinEnabled', value: next }); toast({ title: next ? 'Entrada com PIN ligada' : 'Entrada com PIN desligada: só com cartão-mestre', variant: 'success' }) }
    catch (e) { console.error(e); setPinEnabled(!next); toast({ title: 'Erro ao guardar', variant: 'destructive' }) }
  }
  async function togglePinVisible(next) {
    setPinVisible(next)
    try { await api.setSetting({ key: 'kioskPinVisible', value: next }); toast({ title: next ? 'O PIN passa a ver-se ao escrever' : 'O PIN fica escondido ao escrever', variant: 'success' }) }
    catch (e) { console.error(e); setPinVisible(!next); toast({ title: 'Erro ao guardar', variant: 'destructive' }) }
  }

  async function loadStaffSettings() {
    try {
      const pin = await api.getSetting('adminPin').catch(() => null)
      const lockEnabled = await api.getSetting('kioskLockEnabled').catch(() => null)
      const pv = await api.getSetting('kioskPinVisible').catch(() => null)
      const sc = await api.getSetting('staffCards').catch(() => null)
      setPinVisible(Boolean(pv && pv.value))
      const pe = await api.getSetting('staffPinEnabled').catch(() => null)
      setPinEnabled(pe?.value !== false)
      setCards({ enabled: Boolean(sc?.value?.enabled), cards: Array.isArray(sc?.value?.cards) ? sc.value.cards : [] })
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
        <div className="flex items-start justify-between gap-4 max-w-xl">
          <div>
            <div className="font-medium text-sm">Entrar com PIN</div>
            <p className="text-xs text-muted-foreground mt-1">Ligado, o staff escreve o PIN no quiosque (a pequena roda dentada no canto do ecrã). Desligado, a roda dentada desaparece e só entra com um cartão-mestre.</p>
          </div>
          <Switch checked={pinEnabled} onChange={togglePinEnabled} label="Entrar com PIN" />
        </div>

        {pinEnabled && <>
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
            <div className="font-medium text-sm">Mostrar o PIN ao escrever no quiosque</div>
            <p className="text-xs text-muted-foreground mt-1">Desligado, os números aparecem como pontos. Ligado, vê-se o que se escreve (útil se o staff se engana muito).</p>
          </div>
          <Switch checked={pinVisible} onChange={togglePinVisible} label="Mostrar o PIN ao escrever" />
        </div>

        </>}

        <div className="border-t pt-4 space-y-3 max-w-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium text-sm">Cartões-mestre (entrar sem PIN)</div>
              <p className="text-xs text-muted-foreground mt-1">
                Um cartão desta lista, posto no leitor do quiosque, abre a área de staff sem PIN (vale 15 minutos) e não é tratado como cartão de cliente.
                Use só cartões que guarda bem: quem tiver o cartão entra. Para tirar o acesso, remova-o da lista.
              </p>
            </div>
            <Switch checked={cards.enabled} disabled={savingCards} label="Cartões-mestre" onChange={(v) => saveCards({ ...cards, enabled: v }, v ? 'Cartões-mestre ligados' : 'Cartões-mestre desligados')} />
          </div>
          {cards.enabled && (
            <>
          {cards.cards.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {cards.cards.map((c) => (
                <li key={c.code} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0"><span className="font-mono">{c.code}</span>{c.label && <span className="ml-2 text-muted-foreground">{c.label}</span>}</div>
                  <Button type="button" size="sm" variant="ghost" disabled={savingCards || writing} onClick={() => eraseCard(c)} title="Apagar o cartão (fica em branco) e tirar da lista" aria-label={`Apagar o cartão ${c.code}`}>
                    <Eraser className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={savingCards} aria-label={`Remover ${c.code}`}
                    onClick={() => { if (window.confirm(`Remover o cartão ${c.code}? Deixa de abrir a área de staff.`)) saveCards({ ...cards, cards: cards.cards.filter((x) => x.code !== c.code) }, 'Cartão-mestre removido') }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addCard} className="grid gap-2 sm:grid-cols-[1fr_auto] items-end">
            <div><Label htmlFor="staffCardLabel">Nome (quem tem o cartão)</Label><Input id="staffCardLabel" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Ex: Ana" maxLength={40} autoComplete="off" disabled={writing} /></div>
            <Button type="submit" size="sm" disabled={savingCards || writing || cards.cards.length >= 10}><Plus className="h-4 w-4" /> {writing ? 'A gravar… ponha o cartão no leitor' : 'Gravar novo cartão-mestre'}</Button>
          </form>
          <p className="text-xs text-muted-foreground">Ponha um cartão em <b>branco</b> no leitor do quiosque e carregue. O cartão fica gravado e entra na lista. Pode ter vários (até 10), um por pessoa.</p>
            </>
          )}
        </div>

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

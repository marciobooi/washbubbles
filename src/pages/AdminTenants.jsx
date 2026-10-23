import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTenant } from '../context/TenantContext'
import RequireSuperAdmin from '../components/RequireSuperAdmin'
import { toast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import api from '@/services/api'
import { Settings, Plus, Store, Mail, Globe, LogIn, Power, Wifi, WifiOff, CheckCircle2, Circle, RefreshCw, Pencil, X, Download } from 'lucide-react'

const eur = (n) => `${Number(n || 0).toFixed(2).replace('.', ',')} €`
const ago = (d) => {
  if (!d) return 'nunca'
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  if (m < 1440) return `há ${Math.round(m / 60)} h`
  return `há ${Math.round(m / 1440)} d`
}
const DOMAIN_LABEL = {
  none: ['Sem endereço', 'bg-neutral-100 text-neutral-600'],
  pending_dns: ['A aguardar DNS', 'bg-amber-100 text-amber-800'],
  pending_cert: ['A pedir certificado', 'bg-sky-100 text-sky-800'],
  active: ['Site ativo', 'bg-emerald-100 text-emerald-800'],
  failed: ['Falhou', 'bg-rose-100 text-rose-800'],
}
const errText = (err, fallback) => err?.body?.error || err?.message || fallback

export default function AdminTenants() {
  const { selectTenant, refreshTenants } = useTenant()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState('')

  const load = useCallback(async (retry = true) => {
    try {
      setData(await api.request('/admin/stores/overview', { method: 'GET', expect: 'json' }))
      setLoadError(false)
    } catch {
      if (retry) setTimeout(() => load(false), 1500)
      else setLoadError(true)
    }
  }, [])
  useEffect(() => { load(); const i = setInterval(() => load(false), 30000); return () => clearInterval(i) }, [load])

  // ---- create ----
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', domains: '', customerEmail: '', adminUsername: '' })
  const [created, setCreated] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function create(e) {
    e.preventDefault()
    setBusy('create')
    try {
      const r = await api.request('/admin/stores', { method: 'POST', json: form, expect: 'json' })
      setCreated(r)
      setForm({ name: '', domains: '', customerEmail: '', adminUsername: '' })
      load(); refreshTenants()
    } catch (err) {
      toast({ title: errText(err, 'Não foi possível criar a loja'), variant: 'destructive' })
    } finally { setBusy('') }
  }

  // ---- per-shop actions ----
  async function act(id, key, fn, okTitle) {
    setBusy(id + key)
    try { await fn(); if (okTitle) toast({ title: okTitle, variant: 'success' }); load(); refreshTenants() }
    catch (err) { toast({ title: errText(err, 'Não foi possível concluir'), variant: 'destructive' }) }
    finally { setBusy('') }
  }
  const manage = (s) => { selectTenant(s._id); navigate('/admin') }
  const resend = (s) => act(s._id, 'mail', () => api.request(`/admin/stores/${s._id}/resend-welcome`, { method: 'POST', json: {}, expect: 'json' }), 'Email enviado ao cliente')
  const setStatus = (s, status) => {
    if (status === 'suspended' && !window.confirm(`Suspender «${s.name}»? O posto deixa de sincronizar, os administradores deixam de entrar e o site fica indisponível. Os dados mantêm-se.`)) return
    return act(s._id, 'status', () => api.request(`/admin/stores/${s._id}/status`, { method: 'PUT', json: { status }, expect: 'json' }), status === 'active' ? 'Loja reativada' : 'Loja suspensa')
  }

  // ---- DNS ----
  const [dns, setDns] = useState(null) // { store, loading, data }
  async function checkDns(s) {
    setDns({ store: s, loading: true, data: null })
    try { setDns({ store: s, loading: false, data: await api.request(`/admin/stores/${s._id}/dns`, { method: 'GET', expect: 'json' }) }); load() }
    catch (err) { setDns(null); toast({ title: errText(err, 'Não foi possível verificar'), variant: 'destructive' }) }
  }

  // ---- addresses ----
  const [addr, setAddr] = useState(null) // { store, value }
  async function saveAddr(e) {
    e.preventDefault()
    await act(addr.store._id, 'addr', () => api.request(`/admin/stores/${addr.store._id}/domains`, { method: 'PUT', json: { domains: addr.value }, expect: 'json' }), 'Endereços guardados')
    setAddr(null)
  }

  // ---- installation file for a post ----
  const [inst, setInst] = useState(null) // { store, pcIp, controllerHost, controllerPort }
  async function generate(e) {
    e.preventDefault()
    setBusy('install')
    try {
      const blob = await api.request(`/admin/stores/${inst.store._id}/installation`, { method: 'POST', json: { hardware: { pcIp: inst.pcIp, controllerHost: inst.controllerHost, controllerPort: Number(inst.controllerPort) } }, expect: 'blob', timeoutMs: 60000 })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `Instalar-${inst.store.slug}.bat`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      toast({ title: 'Ficheiro de instalação gerado. Envie-o ao cliente (contém a chave do posto: não o publique).', variant: 'success' })
      setInst(null); load()
    } catch (err) {
      toast({ title: errText(err, 'Não foi possível gerar o ficheiro'), variant: 'destructive' })
    } finally { setBusy('') }
  }

  // ---- platform settings (support e-mail, outgoing mail account) ----
  const [plat, setPlat] = useState(null) // { supportEmail, mail:{host,port,user,from,fromName,hasPassword}, pass }
  async function openPlatform() {
    try { const p = await api.request('/admin/stores/platform', { method: 'GET', expect: 'json' }); setPlat({ ...p, pass: '' }) }
    catch (err) { toast({ title: errText(err, 'Não foi possível abrir'), variant: 'destructive' }) }
  }
  async function savePlatform(e) {
    e.preventDefault()
    setBusy('plat')
    try {
      await api.request('/admin/stores/platform', { method: 'PUT', json: { supportEmail: plat.supportEmail, mail: { ...plat.mail, pass: plat.pass } }, expect: 'json' })
      toast({ title: 'Definições da plataforma guardadas', variant: 'success' }); setPlat(null)
    } catch (err) { toast({ title: errText(err, 'Não foi possível guardar'), variant: 'destructive' }) }
    finally { setBusy('') }
  }
  const setMail = (k) => (e) => setPlat((p) => ({ ...p, mail: { ...p.mail, [k]: e.target.value } }))

  const stores = data?.stores || []
  return (
    <RequireSuperAdmin>
      <div className="p-4 max-w-5xl">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div>
            <h2 className="text-lg font-semibold">Lojas</h2>
            <p className="text-sm text-neutral-500">Todas as lojas do sistema. «Gerir» abre o painel dessa loja.</p>
          </div>
          <div className="flex gap-2">
            <button className="abtn" onClick={openPlatform}><Settings /> Plataforma</button>
            <button className="abtn abtn-primary" onClick={() => { setCreated(null); setCreateOpen(true) }}><Plus /> Criar loja</button>
          </div>
        </div>

        {!data && <div className="p-4 text-sm text-neutral-500">{loadError ? (<>Não foi possível carregar as lojas. <button className="underline" onClick={() => load()}>Tentar de novo</button></>) : 'A carregar…'}</div>}

        <div className="space-y-3">
          {stores.map((s) => {
            const [dLabel, dCls] = DOMAIN_LABEL[s.domainState?.state || 'none']
            const pending = s.checklist.filter((c) => !c.done)
            return (
              <div key={s._id} className="bg-white rounded-xl shadow-sm border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Store className="h-4 w-4 text-neutral-500" />
                      <span className="font-semibold text-base">{s.name}</span>
                      {s.status === 'suspended' && <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">Suspensa</span>}
                      <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${s.kioskOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-600'}`}>
                        {s.kioskOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                        {s.hasKiosk ? (s.kioskOnline ? 'Posto online' : `Posto offline · visto ${ago(s.kioskLastSeen)}`) : 'Sem posto'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${dCls}`}>{dLabel}</span>
                    </div>
                    <div className="text-xs text-neutral-500 mt-1">{s.slug}{s.domains.length ? ` · ${s.domains.join(', ')}` : ''}{s.customerEmail ? ` · ${s.customerEmail}` : ''}</div>
                    {s.domainState?.message && <div className="text-xs text-amber-700 mt-1">{s.domainState.message}</div>}
                  </div>
                  <div className="flex gap-6 text-sm">
                    <div><div className="text-xs text-neutral-500">Hoje</div><div className="font-semibold">{eur(s.todayRevenue)}</div><div className="text-xs text-neutral-500">{s.todaySales} vendas</div></div>
                    <div><div className="text-xs text-neutral-500">Máquinas</div><div className="font-semibold">{s.machines}</div></div>
                    <div><div className="text-xs text-neutral-500">Utilizadores</div><div className="font-semibold">{s.users}</div></div>
                  </div>
                </div>

                {pending.length > 0 && (
                  <div className="mt-3 text-xs bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    <div className="font-medium text-amber-900 mb-1">Falta preparar esta loja</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {s.checklist.map((c) => (
                        <span key={c.key} className={`inline-flex items-center gap-1 ${c.done ? 'text-neutral-400 line-through' : 'text-amber-900'}`}>{c.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}{c.label}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-3">
                  <button className="abtn abtn-sm abtn-primary" onClick={() => manage(s)}><LogIn /> Gerir</button>
                  <button className="abtn abtn-sm" onClick={() => setAddr({ store: s, value: (s.domains || []).join(', ') })}><Pencil /> Endereços</button>
                  {s.domains.length > 0 && <button className="abtn abtn-sm" onClick={() => checkDns(s)}><Globe /> Verificar DNS</button>}
                  <button className="abtn abtn-sm" onClick={() => setInst({ store: s, pcIp: '192.168.2.190', controllerHost: '192.168.2.201', controllerPort: 16852 })}><Download /> Gerar instalação do posto</button>
                  {s.customerEmail && <button className="abtn abtn-sm" disabled={busy === s._id + 'mail'} onClick={() => resend(s)}><Mail /> {busy === s._id + 'mail' ? 'A enviar…' : 'Reenviar email'}</button>}
                  {s.status === 'suspended'
                    ? <button className="abtn abtn-sm" onClick={() => setStatus(s, 'active')}><Power /> Reativar</button>
                    : <button className="abtn abtn-sm abtn-danger" onClick={() => setStatus(s, 'suspended')}><Power /> Suspender</button>}
                </div>
              </div>
            )
          })}
        </div>

        {/* create */}
        <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={created ? 'Loja criada' : 'Criar loja'}>
          {!created ? (
            <form onSubmit={create} className="space-y-3">
              <p className="text-sm text-neutral-600">A loja começa <b>vazia</b> (nada é copiado de outra). O cliente recebe um email com a ligação para definir a palavra-passe e as instruções para ligar o endereço do site.</p>
              <div><label className="text-sm font-medium">Nome da loja *</label><input className="border p-2 rounded mt-1 w-full" value={form.name} onChange={set('name')} autoFocus required /></div>
              <div><label className="text-sm font-medium">Endereço do site</label><input className="border p-2 rounded mt-1 w-full" placeholder="www.marcioslvinc.ro" value={form.domains} onChange={set('domains')} /><p className="text-xs text-neutral-500 mt-1">Criamos também a versão sem «www». Pode ficar vazio e pôr depois.</p></div>
              <div><label className="text-sm font-medium">Email do cliente *</label><input type="email" className="border p-2 rounded mt-1 w-full" value={form.customerEmail} onChange={set('customerEmail')} required /></div>
              <div><label className="text-sm font-medium">Nome de utilizador do administrador</label><input className="border p-2 rounded mt-1 w-full" placeholder="(opcional — usamos o nome da loja)" value={form.adminUsername} onChange={set('adminUsername')} /></div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="abtn" onClick={() => setCreateOpen(false)}><X /> Cancelar</button>
                <button type="submit" className="abtn abtn-primary" disabled={busy === 'create'}>{busy === 'create' ? 'A criar…' : 'Criar loja'}</button>
              </div>
            </form>
          ) : (
            <div className="space-y-3 text-sm">
              <ul className="space-y-1.5">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Loja «{created.tenant.name}» criada (vazia)</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Administrador «{created.admin.username}» criado</li>
                <li className="flex items-center gap-2">{created.emailSent ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-rose-600" />}{created.emailSent ? 'Email enviado ao cliente' : `Email NÃO enviado${created.emailError ? `: ${created.emailError}` : ''} — use «Reenviar email»`}</li>
                {created.dns?.length > 0 && <li className="flex items-center gap-2"><RefreshCw className="h-4 w-4 text-amber-600" /> A aguardar que o cliente ligue o endereço (DNS)</li>}
              </ul>
              {created.dns?.length > 0 && (
                <div className="rounded-lg border p-3"><div className="font-medium mb-1">Registos DNS que o cliente tem de criar</div>
                  {created.dns.map((d) => <div key={d.name} className="font-mono text-xs">{d.type} · {d.name} → {d.value}</div>)}</div>
              )}
              <div className="flex justify-end"><button className="abtn abtn-primary" onClick={() => setCreateOpen(false)}>Fechar</button></div>
            </div>
          )}
        </Modal>

        {/* platform */}
        <Modal open={!!plat} onClose={() => setPlat(null)} title="Plataforma">
          {plat && (
            <form onSubmit={savePlatform} className="space-y-3">
              <div><label className="text-sm font-medium">Email de suporte</label><input type="email" className="border p-2 rounded mt-1 w-full" value={plat.supportEmail} onChange={(e) => setPlat({ ...plat, supportEmail: e.target.value })} /><p className="text-xs text-neutral-500 mt-1">Recebe cópia dos emails enviados aos clientes e aparece nos instaladores como contacto de apoio.</p></div>
              <div className="font-medium text-sm pt-1">Conta de envio de email (para todas as lojas)</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2"><label className="text-xs">Servidor (SMTP)</label><input className="border p-2 rounded mt-1 w-full" value={plat.mail.host || ''} onChange={setMail('host')} /></div>
                <div><label className="text-xs">Porta</label><input className="border p-2 rounded mt-1 w-full" value={plat.mail.port || ''} onChange={setMail('port')} /></div>
                <div className="col-span-3 grid grid-cols-2 gap-2">
                  <div><label className="text-xs">Utilizador</label><input className="border p-2 rounded mt-1 w-full" value={plat.mail.user || ''} onChange={setMail('user')} autoComplete="off" /></div>
                  <div><label className="text-xs">Palavra-passe</label><input type="password" className="border p-2 rounded mt-1 w-full" placeholder={plat.mail.hasPassword ? '•••••• (guardada; deixe vazio para manter)' : ''} value={plat.pass} onChange={(e) => setPlat({ ...plat, pass: e.target.value })} autoComplete="new-password" /></div>
                  <div><label className="text-xs">Endereço de envio</label><input className="border p-2 rounded mt-1 w-full" value={plat.mail.from || ''} onChange={setMail('from')} /></div>
                  <div><label className="text-xs">Nome de envio (opcional)</label><input className="border p-2 rounded mt-1 w-full" value={plat.mail.fromName || ''} onChange={setMail('fromName')} /></div>
                </div>
              </div>
              <p className="text-xs text-neutral-500">A palavra-passe fica guardada cifrada e nunca é mostrada. Com estes campos vazios usa-se o que está no servidor (ficheiro de ambiente). Nos emails de cada loja, o nome que aparece é o da loja.</p>
              <div className="flex justify-end gap-2"><button type="button" className="abtn" onClick={() => setPlat(null)}><X /> Cancelar</button><button type="submit" className="abtn abtn-primary" disabled={busy === 'plat'}>Guardar</button></div>
            </form>
          )}
        </Modal>

        {/* installation file */}
        <Modal open={!!inst} onClose={() => setInst(null)} title={`Instalação do posto — ${inst?.store?.name || ''}`}>
          {inst && (
            <form onSubmit={generate} className="space-y-3">
              <p className="text-sm text-neutral-600">Gera <b>um único ficheiro</b> para o cliente: ele faz duplo clique e o computador fica pronto sozinho. O ficheiro contém a <b>chave do posto</b>: envie-o só ao cliente. Se a loja já tinha um posto, o antigo continua a funcionar até o novo ligar pela primeira vez.</p>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-xs font-medium">IP do computador</label><input className="border p-2 rounded mt-1 w-full" value={inst.pcIp} onChange={(e) => setInst({ ...inst, pcIp: e.target.value })} /></div>
                <div><label className="text-xs font-medium">IP do controlador</label><input className="border p-2 rounded mt-1 w-full" value={inst.controllerHost} onChange={(e) => setInst({ ...inst, controllerHost: e.target.value })} /></div>
                <div><label className="text-xs font-medium">Porta</label><input className="border p-2 rounded mt-1 w-full" value={inst.controllerPort} onChange={(e) => setInst({ ...inst, controllerPort: e.target.value })} /></div>
              </div>
              <div className="flex justify-end gap-2"><button type="button" className="abtn" onClick={() => setInst(null)}><X /> Cancelar</button><button type="submit" className="abtn abtn-primary" disabled={busy === 'install'}><Download /> {busy === 'install' ? 'A gerar…' : 'Gerar e descarregar'}</button></div>
            </form>
          )}
        </Modal>

        {/* DNS check */}
        <Modal open={!!dns} onClose={() => setDns(null)} title={`DNS — ${dns?.store?.name || ''}`}>
          {dns?.loading && <p className="text-sm">A verificar…</p>}
          {dns?.data && (
            <div className="space-y-2 text-sm">
              {dns.data.result.map((r) => (
                <div key={r.host} className="flex items-start gap-2">{r.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" /> : <Circle className="h-4 w-4 text-rose-600 mt-0.5" />}<div><div className="font-mono text-xs">{r.host}</div><div className="text-xs text-neutral-600">{r.ok ? 'Aponta para o nosso servidor' : r.problem}</div></div></div>
              ))}
              {!dns.data.allOk && <p className="text-xs text-neutral-500">Esperado: A → {dns.data.serverIp} (sem AAAA nem CNAME). Pode demorar a propagar.</p>}
              <div className="flex justify-end gap-2"><button className="abtn" onClick={() => checkDns(dns.store)}><RefreshCw /> Verificar de novo</button><button className="abtn abtn-primary" onClick={() => setDns(null)}>Fechar</button></div>
            </div>
          )}
        </Modal>

        {/* addresses */}
        <Modal open={!!addr} onClose={() => setAddr(null)} title={`Endereços — ${addr?.store?.name || ''}`}>
          {addr && (
            <form onSubmit={saveAddr} className="space-y-3">
              <input className="border p-2 rounded w-full" placeholder="www.marcioslvinc.ro" value={addr.value} onChange={(e) => setAddr({ ...addr, value: e.target.value })} autoFocus />
              <p className="text-xs text-neutral-500">Um endereço só pode pertencer a uma loja. Criamos também a versão com/sem «www». Ao mudar, o estado volta a «A aguardar DNS».</p>
              <div className="flex justify-end gap-2"><button type="button" className="abtn" onClick={() => setAddr(null)}><X /> Cancelar</button><button type="submit" className="abtn abtn-primary">Guardar</button></div>
            </form>
          )}
        </Modal>
      </div>
    </RequireSuperAdmin>
  )
}

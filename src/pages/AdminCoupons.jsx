import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Trash2 } from 'lucide-react'

const EMPTY_FORM = {
  code: '', discountType: 'percent', discountValue: '', appliesTo: 'both', maxRedemptions: '', expiresAt: ''
}

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Marketing broadcast state
  const [optInCount, setOptInCount] = useState(null)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await api.getCoupons()
      setCoupons(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar cupões', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function loadOptInCount() {
    try {
      const { count } = await api.getMarketingOptInCount()
      setOptInCount(count)
    } catch (e) { console.warn('loadOptInCount failed', e) }
  }

  useEffect(() => { load(); loadOptInCount() }, [])

  async function createCoupon(e) {
    e.preventDefault()
    if (!form.code.trim()) return toast({ title: 'Indique um código', variant: 'destructive' })
    if (!form.discountValue || Number(form.discountValue) <= 0) return toast({ title: 'Indique um desconto válido', variant: 'destructive' })
    setSaving(true)
    try {
      await api.createCoupon({
        code: form.code.trim(),
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        appliesTo: form.appliesTo,
        maxRedemptions: form.maxRedemptions === '' ? null : Number(form.maxRedemptions),
        expiresAt: form.expiresAt || null,
      })
      toast({ title: 'Cupão criado', variant: 'success' })
      setForm(EMPTY_FORM)
      load()
    } catch (e) {
      console.error(e)
      toast({ title: e?.body?.error || 'Erro ao criar cupão', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(c) {
    try {
      await api.updateCoupon(c._id, { active: !c.active })
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro', variant: 'destructive' })
    }
  }

  async function remove(id) {
    if (!confirm('Remover este cupão?')) return
    try {
      await api.deleteCoupon(id)
      toast({ title: 'Cupão removido', variant: 'success' })
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao remover', variant: 'destructive' })
    }
  }

  async function sendBroadcast(e) {
    e.preventDefault()
    if (!subject.trim() || !message.trim()) return toast({ title: 'Preencha assunto e mensagem', variant: 'destructive' })
    if (!confirm(`Enviar para ${optInCount ?? '?'} clientes? Esta ação não pode ser desfeita.`)) return
    setSending(true)
    try {
      const res = await api.sendMarketingBroadcast({ subject: subject.trim(), message: message.trim() })
      toast({ title: `Enviado: ${res.sent} · Falhados: ${res.failed}`, variant: 'success' })
      setSubject('')
      setMessage('')
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao enviar campanha', variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-2xl font-bold">Cupões e Marketing</h2>

      <Card>
        <CardHeader>
          <CardTitle>Novo cupão</CardTitle>
          <CardDescription>Código promocional aplicado no carrinho do quiosque</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createCoupon} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="coupon-code">Código</Label>
              <Input id="coupon-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="Ex: VERAO10" />
            </div>
            <div>
              <Label htmlFor="coupon-type">Tipo de desconto</Label>
              <select id="coupon-type" className="border p-2 rounded mt-1 w-full h-10 text-sm" value={form.discountType} onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value }))}>
                <option value="percent">Percentagem (%)</option>
                <option value="fixed">Valor fixo (€)</option>
              </select>
            </div>
            <div>
              <Label htmlFor="coupon-value">Valor</Label>
              <Input id="coupon-value" type="number" step="0.01" value={form.discountValue} onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="coupon-applies">Aplica-se a</Label>
              <select id="coupon-applies" className="border p-2 rounded mt-1 w-full h-10 text-sm" value={form.appliesTo} onChange={(e) => setForm((f) => ({ ...f, appliesTo: e.target.value }))}>
                <option value="both">Lavagem e secagem</option>
                <option value="wash">Só lavagem</option>
                <option value="dry">Só secagem</option>
              </select>
            </div>
            <div>
              <Label htmlFor="coupon-max">Máx. utilizações (vazio = ilimitado)</Label>
              <Input id="coupon-max" type="number" value={form.maxRedemptions} onChange={(e) => setForm((f) => ({ ...f, maxRedemptions: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="coupon-expires">Expira em (vazio = nunca)</Label>
              <Input id="coupon-expires" type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
            </div>
            <div className="md:col-span-3">
              <Button type="submit" disabled={saving}>{saving ? 'A criar…' : 'Criar cupão'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cupões existentes</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">A carregar…</div>
          ) : coupons.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center p-6">Sem cupões.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-4">Código</th>
                  <th className="py-2 pr-4">Desconto</th>
                  <th className="py-2 pr-4">Aplica-se a</th>
                  <th className="py-2 pr-4">Utilizações</th>
                  <th className="py-2 pr-4">Expira</th>
                  <th className="py-2 pr-4">Ativo</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={c._id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono font-semibold">{c.code}</td>
                    <td className="py-2 pr-4">{c.discountType === 'percent' ? `${c.discountValue}%` : `${Number(c.discountValue).toFixed(2)}€`}</td>
                    <td className="py-2 pr-4">{c.appliesTo === 'both' ? 'Ambos' : c.appliesTo === 'wash' ? 'Lavagem' : 'Secagem'}</td>
                    <td className="py-2 pr-4">{c.redemptionCount}{c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}</td>
                    <td className="py-2 pr-4">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('pt-PT') : '—'}</td>
                    <td className="py-2 pr-4">
                      <button
                        role="switch"
                        aria-checked={c.active}
                        onClick={() => toggleActive(c)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${c.active ? 'bg-primary-600' : 'bg-neutral-300'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${c.active ? 'translate-x-5' : 'translate-x-1'}`} />
                      </button>
                    </td>
                    <td className="py-2 pr-4">
                      <button className="text-red-600" onClick={() => remove(c._id)} title="Remover"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Campanha por email</CardTitle>
          <CardDescription>
            Enviado apenas a clientes que aceitaram receber marketing na compra do cartão.
            {optInCount != null && <span className="font-medium"> {optInCount} clientes elegíveis.</span>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={sendBroadcast} className="space-y-3 max-w-xl">
            <div>
              <Label htmlFor="broadcast-subject">Assunto</Label>
              <Input id="broadcast-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="broadcast-message">Mensagem</Label>
              <textarea id="broadcast-message" className="w-full border rounded p-2 text-sm" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
            </div>
            <Button type="submit" disabled={sending || !optInCount}>{sending ? 'A enviar…' : 'Enviar campanha'}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

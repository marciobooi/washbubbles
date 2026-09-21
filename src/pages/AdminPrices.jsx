import React, { useEffect, useState } from 'react'
import api from '@/services/api'
import { toast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Pencil, Trash2, Clock, Banknote, CreditCard, Tag } from 'lucide-react'

const EMPTY_FORM = {
  type: 'wash',
  weight: '',
  duration: '',
  cashPrice: '',
  cardPrice: '',
  promoActive: false,
  promoCashPrice: '',
  promoCardPrice: '',
  promoStartTime: '',
  promoEndTime: '',
  promoDays: [],
}

export default function AdminPrices() {
  const [prices, setPrices] = useState([])
  const [machines, setMachines] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [showPromo, setShowPromo] = useState(false)

  // Loyalty card settings
  const [cardCost, setCardCost] = useState(0)
  const [cardCredit, setCardCredit] = useState(0)
  const [minRecharge, setMinRecharge] = useState(0)

  async function load() {
    setLoading(true)
    try {
      const [pricesData, machinesData] = await Promise.all([
        api.getPrices(),
        api.getMachines()
      ])
      setPrices(pricesData)
      setMachines(machinesData)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar preços', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function loadLoyaltyCardSettings() {
    try {
      const cost = await api.getSetting('loyaltyCard.cost').catch(() => null)
      const credit = await api.getSetting('loyaltyCard.credit').catch(() => null)
      const minRech = await api.getSetting('loyaltyCard.minRecharge').catch(() => null)
      
      setCardCost(cost && cost.value !== undefined ? Number(cost.value) : 0)
      setCardCredit(credit && credit.value !== undefined ? Number(credit.value) : 0)
      setMinRecharge(minRech && minRech.value !== undefined ? Number(minRech.value) : 0)
    } catch (e) { 
      console.warn('loadLoyaltyCardSettings failed', e) 
    }
  }

  useEffect(() => { load(); loadLoyaltyCardSettings() }, [])

  // Get unique weights from machines, filtered by selected type
  const getWeightOptions = (type) => {
    const weights = machines
      .filter(m => m.type === type && m.weight > 0)
      .map(m => m.weight)
    return [...new Set(weights)].sort((a, b) => a - b)
  }

  const washWeights = getWeightOptions('wash')
  const dryWeights = getWeightOptions('dry')
  const currentWeightOptions = form.type === 'wash' ? washWeights : dryWeights

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowPromo(false)
    setModalOpen(true)
  }

  function openEdit(price) {
    setEditing(price)
    setForm({
      type: price.type || 'wash',
      weight: String(price.weight ?? ''),
      duration: price.duration != null ? String(price.duration) : '',
      cashPrice: String(price.cashPrice ?? ''),
      cardPrice: String(price.cardPrice ?? ''),
      promoActive: price.promoActive || false,
      promoCashPrice: price.promoCashPrice != null ? String(price.promoCashPrice) : '',
      promoCardPrice: price.promoCardPrice != null ? String(price.promoCardPrice) : '',
      promoStartTime: price.promoStartTime || '',
      promoEndTime: price.promoEndTime || '',
      promoDays: price.promoDays || [],
    })
    setShowPromo(price.promoActive || false)
    setModalOpen(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.weight || form.cashPrice === '' || form.cardPrice === '') {
      toast({ title: 'Preencha os campos obrigatórios', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        type: form.type,
        weight: Number(form.weight),
        duration: form.duration !== '' ? Number(form.duration) : null,
        cashPrice: Number(form.cashPrice),
        cardPrice: Number(form.cardPrice),
        promoActive: form.promoActive && showPromo,
        promoCashPrice: showPromo && form.promoCashPrice !== '' ? Number(form.promoCashPrice) : null,
        promoCardPrice: showPromo && form.promoCardPrice !== '' ? Number(form.promoCardPrice) : null,
        promoStartTime: showPromo ? form.promoStartTime || null : null,
        promoEndTime: showPromo ? form.promoEndTime || null : null,
        promoDays: showPromo ? form.promoDays : [],
      }
      if (editing) {
        await api.updatePrice(editing._id, payload)
        toast({ title: 'Preço atualizado', variant: 'success' })
      } else {
        await api.createPrice(payload)
        toast({ title: 'Preço criado', variant: 'success' })
      }
      setModalOpen(false)
      load()
    } catch (e) {
      console.error(e)
      const msg = e?.body?.error || e?.message || 'Erro'
      toast({ title: msg, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remover este preço?')) return
    try {
      await api.deletePrice(id)
      toast({ title: 'Preço removido', variant: 'success' })
      load()
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao remover', variant: 'destructive' })
    }
  }

  // Loyalty card save
  async function saveLoyaltyCardSettings(e) {
    e.preventDefault()
    try {
      await api.setSetting({ key: 'loyaltyCard.cost', value: cardCost })
      await api.setSetting({ key: 'loyaltyCard.credit', value: cardCredit })
      await api.setSetting({ key: 'loyaltyCard.minRecharge', value: minRecharge })
      toast({ title: 'Loyalty card settings saved', variant: 'success' })
      loadLoyaltyCardSettings()
    } catch (e) {
      console.error(e)
      toast({ title: 'Failed to save settings', variant: 'destructive' })
    }
  }

  // Group prices by type
  const washPrices = prices.filter(p => p.type === 'wash').sort((a, b) => a.weight - b.weight)
  const dryPrices = prices.filter(p => p.type === 'dry').sort((a, b) => a.weight - b.weight)

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Preços / Programas</h2>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 h-[42px] px-5 rounded-full border border-black/[0.12] text-[#1c2530] font-semibold text-sm cursor-pointer transition-colors duration-150 hover:bg-[#f7f5f1] disabled:opacity-60"
        >
          <Plus className="w-[15px] h-[15px]" aria-hidden /> Novo Preço
        </button>
      </div>

      {loading ? (
        <div className="text-neutral-500">A carregar...</div>
      ) : prices.length === 0 ? (
        <div className="text-neutral-500">Nenhum preço registado.</div>
      ) : (
        <div className="space-y-6">
          {/* Wash Programs */}
          {washPrices.length > 0 && (
            <div>
              <h3 className="text-md font-semibold mb-3 px-2 py-1 bg-blue-100 text-blue-800 rounded">
                Programas para máquinas de lavar
              </h3>
              <div className="bg-white rounded shadow overflow-auto">
                <table className="min-w-full divide-y text-sm">
                  <thead className="bg-muted-foreground/5">
                    <tr>
                      <th className="px-4 py-2 text-left">Programa</th>
                      <th className="px-4 py-2 text-left">Duração</th>
                      <th className="px-4 py-2 text-left">Dinheiro</th>
                      <th className="px-4 py-2 text-left">Cartão</th>
                      <th className="px-4 py-2 text-left">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {washPrices.map(p => (
                      <tr key={p._id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Lavar {p.weight}Kg</span>
                            {p.promoActive && (
                              <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-800 rounded flex items-center gap-1">
                                <Tag className="h-3 w-3" /> PROMO
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4 text-neutral-400" />
                            <span>{p.duration ?? '—'} min.</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Banknote className="h-4 w-4 text-green-600" />
                            <span>{p.cashPrice?.toFixed(2) ?? '0.00'}€</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <CreditCard className="h-4 w-4 text-blue-600" />
                            <span>{p.cardPrice?.toFixed(2) ?? '0.00'}€</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button className="btn p-2" title="Editar" onClick={() => openEdit(p)}>
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button className="btn btn-destructive p-2" title="Eliminar" onClick={() => handleDelete(p._id)}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dry Programs */}
          {dryPrices.length > 0 && (
            <div>
              <h3 className="text-md font-semibold mb-3 px-2 py-1 bg-amber-100 text-amber-800 rounded">
                Programas para máquinas de secar
              </h3>
              <div className="bg-white rounded shadow overflow-auto">
                <table className="min-w-full divide-y text-sm">
                  <thead className="bg-muted-foreground/5">
                    <tr>
                      <th className="px-4 py-2 text-left">Programa</th>
                      <th className="px-4 py-2 text-left">Dinheiro</th>
                      <th className="px-4 py-2 text-left">Cartão</th>
                      <th className="px-4 py-2 text-left">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {dryPrices.map(p => (
                      <tr key={p._id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Secar {p.weight}Kg</span>
                            {p.promoActive && (
                              <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-800 rounded flex items-center gap-1">
                                <Tag className="h-3 w-3" /> PROMO
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Banknote className="h-4 w-4 text-green-600" />
                            <span>{p.cashPrice?.toFixed(2) ?? '0.00'}€</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <CreditCard className="h-4 w-4 text-blue-600" />
                            <span>{p.cardPrice?.toFixed(2) ?? '0.00'}€</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button className="btn p-2" title="Editar" onClick={() => openEdit(p)}>
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button className="btn btn-destructive p-2" title="Eliminar" onClick={() => handleDelete(p._id)}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loyalty Card Settings */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Cartão de Cliente</CardTitle>
          <CardDescription>Configurações do cartão de fidelidade</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveLoyaltyCardSettings} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cardCost">Compra (com carregamento)</Label>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-blue-600" />
                  <Input
                    id="cardCost"
                    type="number"
                    step="0.01"
                    min="0"
                    value={cardCost}
                    onChange={(e) => setCardCost(Number(e.target.value))}
                  />
                  <span>€</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardCredit">Crédito inicial</Label>
                <div className="flex items-center gap-2">
                  <Banknote className="h-5 w-5 text-green-600" />
                  <Input
                    id="cardCredit"
                    type="number"
                    step="0.01"
                    min="0"
                    value={cardCredit}
                    onChange={(e) => setCardCredit(Number(e.target.value))}
                  />
                  <span>€</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="minRecharge">Carregamento mínimo</Label>
                <div className="flex items-center gap-2">
                  <Tag className="h-5 w-5 text-orange-600" />
                  <Input
                    id="minRecharge"
                    type="number"
                    step="0.01"
                    min="0"
                    value={minRecharge}
                    onChange={(e) => setMinRecharge(Number(e.target.value))}
                  />
                  <span>€</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit">Guardar Configurações do Cartão</Button>
              <Button 
                type="button" 
                variant="outline"
                onClick={() => { 
                  loadLoyaltyCardSettings(); 
                  toast({ title: 'Revertido', variant: 'success' }) 
                }}
              >
                Reverter
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Preço' : 'Novo Preço'}>
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Tipo <span className="text-red-500">*</span></label>
              <select className="border p-2 rounded w-full" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, weight: '' })}>
                <option value="wash">Lavagem (wash)</option>
                <option value="dry">Secagem (dry)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Peso (kg) <span className="text-red-500">*</span></label>
              <select className="border p-2 rounded w-full" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} required>
                <option value="">-- Seleccionar --</option>
                {currentWeightOptions.map(w => (
                  <option key={w} value={w}>{w} kg</option>
                ))}
              </select>
              {currentWeightOptions.length === 0 && (
                <div className="text-xs text-amber-600 mt-1">Nenhuma máquina de {form.type === 'wash' ? 'lavagem' : 'secagem'} com peso definido.</div>
              )}
            </div>
            {form.type === 'wash' && (
              <div>
                <label className="block text-sm font-medium mb-1">Duração (min.)</label>
                <input className="border p-2 rounded w-full" type="number" min="1" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">Preço Dinheiro (€) <span className="text-red-500">*</span></label>
              <input className="border p-2 rounded w-full" type="number" step="0.01" min="0" value={form.cashPrice} onChange={(e) => setForm({ ...form, cashPrice: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Preço Cartão (€) <span className="text-red-500">*</span></label>
              <input className="border p-2 rounded w-full" type="number" step="0.01" min="0" value={form.cardPrice} onChange={(e) => setForm({ ...form, cardPrice: e.target.value })} required />
            </div>
          </div>

          {/* Promotional Section */}
          {!showPromo ? (
            <div className="pt-2">
              <Button type="button" variant="outline" onClick={() => setShowPromo(true)}>
                <Plus className="h-4 w-4 mr-2" /> Adicionar Promoção
              </Button>
            </div>
          ) : (
            <div className="border-t pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Preços Promocionais</h3>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShowPromo(false); setForm({ ...form, promoActive: false }) }}>
                  Remover Promoção
                </Button>
              </div>
              
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="promo-active" 
                  checked={form.promoActive} 
                  onChange={(e) => setForm({ ...form, promoActive: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="promo-active" className="text-sm font-medium">Promoção Ativa</label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Preço Promo Dinheiro (€)</label>
                  <input className="border p-2 rounded w-full" type="number" step="0.01" min="0" value={form.promoCashPrice} onChange={(e) => setForm({ ...form, promoCashPrice: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Preço Promo Cartão (€)</label>
                  <input className="border p-2 rounded w-full" type="number" step="0.01" min="0" value={form.promoCardPrice} onChange={(e) => setForm({ ...form, promoCardPrice: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Hora Início</label>
                  <input className="border p-2 rounded w-full" type="time" value={form.promoStartTime} onChange={(e) => setForm({ ...form, promoStartTime: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Hora Fim</label>
                  <input className="border p-2 rounded w-full" type="time" value={form.promoEndTime} onChange={(e) => setForm({ ...form, promoEndTime: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Dias da Semana</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => {
                    const labels = { monday: 'Segunda', tuesday: 'Terça', wednesday: 'Quarta', thursday: 'Quinta', friday: 'Sexta', saturday: 'Sábado', sunday: 'Domingo' }
                    return (
                      <label key={day} className="flex items-center gap-2 text-sm">
                        <input 
                          type="checkbox" 
                          checked={form.promoDays.includes(day)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setForm({ ...form, promoDays: [...form.promoDays, day] })
                            } else {
                              setForm({ ...form, promoDays: form.promoDays.filter(d => d !== day) })
                            }
                          }}
                          className="w-4 h-4"
                        />
                        {labels[day]}
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? 'A guardar...' : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

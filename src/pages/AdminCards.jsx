import React, { useState, useEffect } from 'react'
import { shopDateTime } from '@/lib/shopTime'
import api from '../services/api'
import { toast } from '../components/ui/Toast'
import { CreditCard, Search, RefreshCw, Mail, Phone, User, FileText, X, Calendar, Clock, Plus, Edit2, Save, Gift, Pencil } from 'lucide-react'
import GiftCardForm from '../components/GiftCardForm'

export default function AdminCards() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCard, setSelectedCard] = useState(null)
  const [cardHistory, setCardHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  
  // Form modal state
  const [showForm, setShowForm] = useState(false)
  const [editingCard, setEditingCard] = useState(null)
  const [formData, setFormData] = useState({
    code: '',
    balance: 0,
    name: '',
    email: '',
    phone: '',
    contribuinte: ''
  })
  const [saving, setSaving] = useState(false)
  const [blanking, setBlanking] = useState(false)
  const [giftOpen, setGiftOpen] = useState(false)
  const [giftBusy, setGiftBusy] = useState(false)
  async function issueGift(payload) {
    setGiftBusy(true)
    try {
      const r = await api.adminGiftCard(payload)
      toast({ title: r.queued ? 'Pedido enviado à loja' : 'Cartão libertado', description: 'O cartão sai do distribuidor. Coloque-o no leitor da loja para o ativar.', variant: 'success' })
      setGiftOpen(false)
      setTimeout(loadCards, 15000)
    } catch (e) {
      toast({ title: 'Não foi possível emitir o cartão', description: e?.body?.error || e?.message, variant: 'destructive' })
    } finally { setGiftBusy(false) }
  }
  async function blankCard() {
    if (!window.confirm('Vai APAGAR o nome, o NIF e o saldo do cartão que está no leitor da loja (experiência). Só para cartões de teste. Continuar?')) return
    setBlanking(true)
    try {
      let r = await api.blankCardAtReader()
      if (r.queued) {
        const id = r.commandIds?.[0]
        r = { error: 'A loja não respondeu a tempo' }
        for (let i = 0; i < 40; i++) {
          await new Promise((ok) => setTimeout(ok, 3000))
          const c = await api.adminCommand(id).catch(() => null)
          if (c?.status === 'done') { r = c.result || {}; break }
          if (c?.status === 'failed') { r = { error: c.error }; break }
        }
      }
      if (r.code) { toast({ title: `Cartão ${r.code} apagado`, description: `Tinha: ${r.name || 'sem nome'}, ${Number(r.balance || 0).toFixed(2)}€` }); loadCards() }
      else toast({ title: 'Não foi possível apagar o cartão', description: r.error, variant: 'destructive' })
    } catch (e) {
      toast({ title: e?.body?.error || 'Erro ao apagar o cartão', variant: 'destructive' })
    } finally { setBlanking(false) }
  }

  useEffect(() => {
    loadCards()
  }, [])

  async function loadCards() {
    try {
      setLoading(true)
      const data = await api.request('/admin/cards', { expect: 'json' })
      setCards(data)
    } catch (e) {
      console.error('Failed to load cards:', e)
      toast({ title: 'Erro ao carregar cartões', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function loadCardHistory(card) {
    try {
      setLoadingHistory(true)
      setSelectedCard(card)
      
      // Fetch transactions for this card
      const allTransactions = await api.request('/admin/transactions', { expect: 'json' })
      
      // Filter transactions by cardCode or cardId
      const history = allTransactions.filter(tx => 
        tx.cardCode === card.code || 
        (tx.cardId && tx.cardId._id === card._id)
      ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      
      setCardHistory(history)
    } catch (e) {
      console.error('Failed to load card history:', e)
      toast({ title: 'Erro ao carregar histórico', variant: 'destructive' })
      setCardHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }

  function closeModal() {
    setSelectedCard(null)
    setCardHistory([])
  }

  function openCreateForm() {
    setEditingCard(null)
    setFormData({
      code: '',
      balance: 0,
      name: '',
      email: '',
      phone: '',
      contribuinte: ''
    })
    setShowForm(true)
  }

  function openEditForm(card, e) {
    e.stopPropagation() // Prevent triggering row click
    setEditingCard(card)
    setFormData({
      code: card.code || '',
      balance: card.balance || 0,
      name: card.name || '',
      email: card.email || '',
      phone: card.phone || '',
      contribuinte: card.contribuinte || ''
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingCard(null)
    setFormData({
      code: '',
      balance: 0,
      name: '',
      email: '',
      phone: '',
      contribuinte: ''
    })
  }

  async function handleSave() {
    try {
      setSaving(true)

      if (editingCard) {
        // Update existing card
        await api.request(`/admin/cards/${editingCard._id}`, {
          method: 'PUT',
          json: {
            balance: Number(formData.balance),
            name: formData.name,
            email: formData.email,
            phone: formData.phone,
            contribuinte: formData.contribuinte
          },
          expect: 'json'
        })
        toast({ title: 'Cartão atualizado com sucesso', variant: 'success' })
      } else {
        // Create new card
        if (!formData.code) {
          toast({ title: 'Código do cartão é obrigatório', variant: 'destructive' })
          return
        }
        await api.request('/admin/cards', {
          method: 'POST',
          json: {
            code: formData.code,
            balance: Number(formData.balance),
            name: formData.name,
            email: formData.email,
            phone: formData.phone,
            contribuinte: formData.contribuinte
          },
          expect: 'json'
        })
        toast({ title: 'Cartão criado com sucesso', variant: 'success' })
      }

      closeForm()
      loadCards()
    } catch (e) {
      console.error('Failed to save card:', e)
      const errorMsg = e.body?.error || e.message || 'Erro ao guardar cartão'
      toast({ title: errorMsg, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const filteredCards = cards.filter(card => {
    const search = searchTerm.toLowerCase()
    return (
      card.code?.toLowerCase().includes(search) ||
      card.name?.toLowerCase().includes(search) ||
      card.email?.toLowerCase().includes(search) ||
      card.phone?.toLowerCase().includes(search) ||
      card.contribuinte?.toLowerCase().includes(search)
    )
  })

  const formatDate = (date) => {
    if (!date) return '-'
    return shopDateTime(date, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
          <p className="text-muted-foreground">A carregar cartões...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold whitespace-nowrap">Cartões de Cliente</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={blankCard}
            disabled={blanking}
            className="abtn abtn-danger"
          >
            <X className="h-4 w-4" />
            {blanking ? 'A apagar…' : 'Limpar cartão no leitor'}
          </button>
          <button
            onClick={() => setGiftOpen(true)}
            className="abtn"
          >
            <Gift className="h-4 w-4" />
            Cartão de oferta
          </button>
          <button
            onClick={openCreateForm}
            className="abtn abtn-primary"
          >
            <Plus className="h-4 w-4" />
            Criar Cartão
          </button>
          <button
            onClick={loadCards}
            className="abtn"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded shadow p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Pesquisar por código, nome, email, telefone ou NIF..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Cards Table */}
      <div className="bg-white rounded shadow overflow-auto">
        {loading ? (
          <div className="p-4">A carregar...</div>
        ) : (
          <table className="min-w-full divide-y text-sm">
            <thead className="bg-muted-foreground/5">
              <tr>
                <th className="px-4 py-2 text-left">Código</th>
                <th className="px-4 py-2 text-left">Saldo</th>
                <th className="px-4 py-2 text-left">Nome</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Telefone</th>
                <th className="px-4 py-2 text-left">NIF</th>
                <th className="px-4 py-2 text-left">Criado</th>
                <th className="px-4 py-2 text-left">Atualizado</th>
                <th className="px-4 py-2 text-left">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredCards.length === 0 ? (
                <tr>
                  <td colSpan="9" className="p-12 text-center text-muted-foreground">
                    {searchTerm ? 'Nenhum cartão encontrado' : 'Nenhum cartão registado'}
                  </td>
                </tr>
              ) : (
                filteredCards.map((card) => (
                  <tr 
                    key={card._id} 
                    className="hover:bg-muted-foreground/5 cursor-pointer"
                    onClick={() => loadCardHistory(card)}
                  >
                    <td className="px-4 py-2">
                      <span className="font-medium">{card.code}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="font-bold text-primary">
                        €{(card.balance || 0).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-2">{card.name || '-'}</td>
                    <td className="px-4 py-2">{card.email || '-'}</td>
                    <td className="px-4 py-2">{card.phone || '-'}</td>
                    <td className="px-4 py-2">{card.contribuinte || '-'}</td>
                    <td className="px-4 py-2">{formatDate(card.createdAt)}</td>
                    <td className="px-4 py-2">{formatDate(card.updatedAt)}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={(e) => openEditForm(card, e)}
                        className="abtn abtn-icon"
                        title="Editar"
                        aria-label={`Editar cartão ${card.code}`}
                      >
                        <Pencil />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Stats Footer */}
      <div className="bg-white rounded shadow p-4 mt-4">
        <div className="grid gap-4 md:grid-cols-3 text-center">
          <div>
            <div className="text-2xl font-bold text-primary">{cards.length}</div>
            <p className="text-sm text-muted-foreground">Total de Cartões</p>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              €{cards.reduce((sum, c) => sum + (c.balance || 0), 0).toFixed(2)}
            </div>
            <p className="text-sm text-muted-foreground">Saldo Total</p>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-600">
              {cards.filter(c => c.name || c.email || c.phone || c.contribuinte).length}
            </div>
            <p className="text-sm text-muted-foreground">Com Dados de Cliente</p>
          </div>
        </div>
      </div>

      {giftOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !giftBusy && setGiftOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-3">Cartão de oferta</h3>
            <GiftCardForm withDetails busy={giftBusy} onSubmit={issueGift} onCancel={() => setGiftOpen(false)} />
          </div>
        </div>
      )}

      {/* Card History Modal */}
      {selectedCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeModal}>
          <div 
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <CreditCard className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">{selectedCard.code}</h2>
                  <p className="text-sm text-muted-foreground">Histórico do Cartão</p>
                </div>
              </div>
              <button
                onClick={closeModal}
                className="abtn abtn-icon" aria-label="Fechar"
              >
                <X />
              </button>
            </div>

            {/* Card Details */}
            <div className="p-6 border-b bg-neutral-50">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Saldo Atual</p>
                  <p className="text-2xl font-bold text-primary">€{(selectedCard.balance || 0).toFixed(2)}</p>
                </div>
                {selectedCard.name && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Nome</p>
                    <p className="font-medium">{selectedCard.name}</p>
                  </div>
                )}
                {selectedCard.email && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Email</p>
                    <p className="font-medium text-sm">{selectedCard.email}</p>
                  </div>
                )}
                {selectedCard.phone && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Telefone</p>
                    <p className="font-medium">{selectedCard.phone}</p>
                  </div>
                )}
                {selectedCard.contribuinte && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">NIF</p>
                    <p className="font-medium">{selectedCard.contribuinte}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Transaction History */}
            <div className="flex-1 overflow-y-auto p-6">
              <h3 className="text-lg font-semibold mb-4">
                Transacções ({cardHistory.length})
              </h3>

              {loadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : cardHistory.length === 0 ? (
                <div className="text-center py-12">
                  <CreditCard className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
                  <p className="text-muted-foreground">Nenhuma transação encontrada</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {cardHistory.map((tx) => {
                    const isPositive = tx.type === 'recharge' || tx.type === 'card_purchase' || tx.type === 'gift_card'
                    // a gift card moved no money: show the free credit it came with
                    const shownAmount = tx.type === 'gift_card' ? Number(tx.metadata?.giftCredit ?? tx.items?.[0]?.credit ?? 0) : Number(tx.amount || 0)
                    const typeLabel = {
                      payment: 'Pagamento',
                      recharge: 'Recarga',
                      card_purchase: 'Compra de Cartão',
                      gift_card: 'Cartão de oferta',
                      admin_start: 'Início Admin',
                      other: 'Outro'
                    }[tx.type] || tx.type

                    return (
                      <div
                        key={tx._id}
                        className="border rounded-lg p-4 hover:bg-neutral-50 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                              isPositive ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {isPositive ? '+' : '-'}
                            </div>
                            <div>
                              <p className="font-semibold">{typeLabel}</p>
                              {tx.machineId && (
                                <p className="text-sm text-muted-foreground">
                                  {tx.machineId.name || tx.machineId._id}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`text-xl font-bold ${isPositive ? 'text-green-600' : 'text-neutral-800'}`}>
                              {isPositive ? '+' : '-'}€{Math.abs(shownAmount).toFixed(2)}
                            </p>
                            {tx.method && (
                              <p className="text-xs text-muted-foreground">
                                {tx.method === 'card' ? 'Cartão' : tx.method === 'cash' ? 'Dinheiro' : tx.method}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(tx.createdAt)}
                          </span>
                          {tx.inserted > 0 && (
                            <span>Inserido: €{tx.inserted.toFixed(2)}</span>
                          )}
                          {tx.change > 0 && (
                            <span>Troco: €{tx.change.toFixed(2)}</span>
                          )}
                        </div>

                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeForm}>
          <div 
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Form Header */}
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  {editingCard ? <Edit2 className="h-6 w-6 text-primary" /> : <Plus className="h-6 w-6 text-primary" />}
                </div>
                <div>
                  <h2 className="text-2xl font-bold">
                    {editingCard ? 'Editar Cartão' : 'Criar Novo Cartão'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {editingCard ? `Código: ${editingCard.code}` : 'Preencha os dados do cartão'}
                  </p>
                </div>
              </div>
              <button
                onClick={closeForm}
                className="abtn abtn-icon" aria-label="Fechar"
              >
                <X />
              </button>
            </div>

            {/* Form Body */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {/* Code field - only for new cards */}
                {!editingCard && (
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Código do Cartão <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      placeholder="Ex: CARD123456"
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      required
                    />
                  </div>
                )}

                {/* Balance */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Saldo (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.balance}
                    onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Name */}
                <div>
                  <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Nome
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Nome completo (opcional)"
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="email@exemplo.com (opcional)"
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    Telefone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+351 912 345 678 (opcional)"
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* NIF */}
                <div>
                  <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    NIF / Contribuinte
                  </label>
                  <input
                    type="text"
                    value={formData.contribuinte}
                    onChange={(e) => setFormData({ ...formData, contribuinte: e.target.value })}
                    placeholder="123456789 (opcional)"
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            {/* Form Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t bg-neutral-50">
              <button
                onClick={closeForm}
                className="abtn"
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                className="abtn abtn-primary"
                disabled={saving}
              >
                {saving ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

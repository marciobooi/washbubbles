import React, { useEffect, useState, useCallback } from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'

// Denomination constants
const COIN_DENOMS = [0.05, 0.10, 0.20, 0.50, 1.00, 2.00]
const BILL_DENOMS = [5, 10, 20, 50, 100, 200]
const ALL_CASH_DENOMS = [...COIN_DENOMS, ...BILL_DENOMS]

// Helpers
function fmt(n) { return Number(n || 0).toFixed(2) }
function denomSum(arr) { return arr.reduce((s, d) => s + Number(d.value) * Number(d.count || 0), 0) }
function buildDenomState(values) { return values.map(v => ({ value: v, count: 0 })) }
function fmtDenomLabel(v) {
  if (v < 1) return `${Math.round(v * 100)}c`
  if (v % 1 === 0) return `${v}\u20ac`
  return `${Number(v).toFixed(2)}\u20ac`
}

// Sub-component: denomination grid
function DenomGrid({ denoms, onChange, className = '' }) {
  return (
    <div className={`grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 ${className}`}>
      {denoms.map((d, i) => (
        <div key={d.value} className="text-center">
          <div className="text-xs font-medium mb-1 text-neutral-600">{fmtDenomLabel(d.value)}</div>
          <input
            type="number"
            min="0"
            step="1"
            className="border rounded px-1 py-1 w-full text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={d.count || ''}
            onChange={e => onChange(i, e.target.value)}
            placeholder="0"
          />
          {d.count > 0 && (
            <div className="text-xs text-neutral-400 mt-0.5">{fmt(d.value * d.count)} &euro;</div>
          )}
        </div>
      ))}
    </div>
  )
}

// Sub-component: section card
function Section({ title, subtitle, children }) {
  return (
    <div className="bg-white rounded shadow p-4 space-y-3">
      <div>
        <h3 className="font-medium text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-neutral-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

// Main page
export default function AdminDayClose() {
  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  // Denomination states
  const [countedDenoms, setCountedDenoms]     = useState(buildDenomState(ALL_CASH_DENOMS))
  const [mechanismDenoms, setMechanismDenoms] = useState(buildDenomState(COIN_DENOMS))
  const [hopperDenoms, setHopperDenoms]       = useState(buildDenomState(COIN_DENOMS))

  // Split fields
  const [amountToBank, setAmountToBank] = useState('')
  const [floatLeft, setFloatLeft]       = useState('')
  const [notes, setNotes]               = useState('')
  const [saving, setSaving]             = useState(false)

  // History
  const [history, setHistory]               = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [expandedId, setExpandedId]         = useState(null)

  // Derived values
  const countedCash      = denomSum(countedDenoms)
  const mechanismTotal   = denomSum(mechanismDenoms)
  const hopperTotal      = denomSum(hopperDenoms)
  const expectedCash     = summary ? Number(summary.openingFloat || 0) + Number(summary.totalCash || 0) : 0
  const discrepancy      = countedCash - expectedCash
  const discrepancyKnown = summary !== null

  // Load
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const data = await api.getDayCloseSummary()
      setSummary(data)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar resumo', variant: 'destructive' })
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const data = await api.getDayCloses()
      setHistory(data)
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar historico', variant: 'destructive' })
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { loadSummary(); loadHistory() }, [loadSummary, loadHistory])

  // Auto-fill floatLeft when amountToBank is typed
  function handleAmountToBank(val) {
    setAmountToBank(val)
    const remaining = countedCash - Number(val)
    if (!isNaN(remaining) && remaining >= 0) setFloatLeft(remaining.toFixed(2))
  }

  // Generic denom updater
  function makeUpdater(setter) {
    return (i, rawVal) => {
      const count = Math.max(0, parseInt(rawVal, 10) || 0)
      setter(prev => prev.map((d, idx) => idx === i ? { ...d, count } : d))
    }
  }

  // Submit
  async function handleSubmit(e) {
    e.preventDefault()
    const atb = parseFloat(amountToBank)
    const fl  = parseFloat(floatLeft)
    if (isNaN(atb) || isNaN(fl)) {
      return toast({ title: 'Preencha o valor para o banco e o fundo de caixa', variant: 'destructive' })
    }
    if (atb < 0 || fl < 0) {
      return toast({ title: 'Os valores nao podem ser negativos', variant: 'destructive' })
    }
    if (Math.abs(atb + fl - countedCash) > 0.005) {
      return toast({
        title: `Banco (${fmt(atb)}\u20ac) + Fundo (${fmt(fl)}\u20ac) nao coincide com o total contado (${fmt(countedCash)}\u20ac)`,
        variant: 'destructive'
      })
    }

    setSaving(true)
    try {
      await api.createDayClose({
        amountToBank: atb,
        floatLeft: fl,
        countedCash,
        countedDenominations: countedDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        coinMechanismInventory: mechanismDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        hopperCoins: hopperDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        notes
      })
      toast({ title: 'Fecho de sessao guardado com sucesso!' })
      setAmountToBank(''); setFloatLeft(''); setNotes('')
      setCountedDenoms(buildDenomState(ALL_CASH_DENOMS))
      setMechanismDenoms(buildDenomState(COIN_DENOMS))
      setHopperDenoms(buildDenomState(COIN_DENOMS))
      loadSummary(); loadHistory()
    } catch (e) {
      console.error(e)
      toast({ title: e?.body?.error || 'Erro ao guardar', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // Render
  return (
    <div className="p-4 space-y-5 max-w-4xl mx-auto">
      <h2 className="text-lg font-semibold">Fecho / Abertura de Caixa</h2>

      {/* 1. Session summary */}
      <Section
        title="Sessao atual"
        subtitle={summary && `Desde ${new Date(summary.periodFrom).toLocaleString()}`}
      >
        {summaryLoading ? (
          <div className="text-sm text-neutral-400">A carregar...</div>
        ) : summary ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
            <StatCard label="Fundo inicial"     value={`${fmt(summary.openingFloat)} \u20ac`} color="text-neutral-700" />
            <StatCard label="Vendas (dinheiro)" value={`${fmt(summary.totalCash)} \u20ac`}    color="text-green-700" />
            <StatCard label="Vendas (cartao)"   value={`${fmt(summary.totalCard)} \u20ac`}    color="text-blue-700" />
            <StatCard label="Esperado em caixa" value={`${fmt(summary.expectedCash)} \u20ac`} color="text-orange-700" bold />
          </div>
        ) : <div className="text-sm text-neutral-400">Sem dados</div>}
        {summary && (
          <div className="text-xs text-neutral-400">{summary.salesCount} transaccao(oes) neste periodo</div>
        )}
      </Section>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* 2. Cash reconciliation */}
        <Section
          title="Contagem de caixa - Reconciliacao"
          subtitle="Conte todas as moedas e notas presentes na caixa registadora/maquina"
        >
          <DenomGrid denoms={countedDenoms} onChange={makeUpdater(setCountedDenoms)} />
          <div className="flex flex-wrap gap-4 pt-2 text-sm">
            <div>Total contado: <span className="font-bold">{fmt(countedCash)} &euro;</span></div>
            {discrepancyKnown && (
              <div>
                Esperado: <span className="font-medium">{fmt(expectedCash)} &euro;</span>
                {' \u00b7 '}
                Diferenca:{' '}
                <span className={`font-bold ${discrepancy < -0.005 ? 'text-red-600' : discrepancy > 0.005 ? 'text-amber-600' : 'text-green-600'}`}>
                  {discrepancy >= 0 ? '+' : ''}{fmt(discrepancy)} &euro;
                </span>
              </div>
            )}
          </div>
        </Section>

        {/* 3. Float replenishment (split) */}
        <Section
          title="Distribuicao do dinheiro contado"
          subtitle="Indique quanto vai para o banco e quanto fica como fundo para a proxima sessao"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-1">Para o banco (&euro;)</label>
              <input
                type="number" min="0" step="0.01"
                className="border rounded px-3 py-2 w-full text-sm"
                value={amountToBank}
                onChange={e => handleAmountToBank(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Fundo da proxima sessao (&euro;)</label>
              <input
                type="number" min="0" step="0.01"
                className="border rounded px-3 py-2 w-full text-sm"
                value={floatLeft}
                onChange={e => setFloatLeft(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
          </div>
          {amountToBank !== '' && floatLeft !== '' && (
            <div className={`text-xs ${Math.abs(parseFloat(amountToBank || 0) + parseFloat(floatLeft || 0) - countedCash) > 0.005 ? 'text-red-500' : 'text-green-600'}`}>
              Banco + Fundo = {fmt(parseFloat(amountToBank || 0) + parseFloat(floatLeft || 0))} &euro;
              {Math.abs(parseFloat(amountToBank || 0) + parseFloat(floatLeft || 0) - countedCash) > 0.005 && ' (deve ser igual ao total contado)'}
            </div>
          )}
        </Section>

        {/* 4. Coin mechanism inventory */}
        <Section
          title="Inventario do mecanismo de moedas (aceitador)"
          subtitle="Moedas presentes no mecanismo aceitador de moedas no momento do fecho"
        >
          <DenomGrid denoms={mechanismDenoms} onChange={makeUpdater(setMechanismDenoms)} />
          {mechanismTotal > 0 && (
            <div className="text-sm">Total no mecanismo: <span className="font-bold">{fmt(mechanismTotal)} &euro;</span></div>
          )}
        </Section>

        {/* 5. Hopper restocking */}
        <Section
          title="Reabastecimento do hopper (dispensador)"
          subtitle="Moedas carregadas no dispensador superior para troco na proxima sessao"
        >
          <DenomGrid denoms={hopperDenoms} onChange={makeUpdater(setHopperDenoms)} />
          {hopperTotal > 0 && (
            <div className="text-sm">Total no hopper: <span className="font-bold">{fmt(hopperTotal)} &euro;</span></div>
          )}
        </Section>

        {/* 6. Notes */}
        <Section title="Notas (opcional)">
          <textarea
            className="border rounded px-3 py-2 w-full text-sm h-20 resize-none"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Observacoes do fecho..."
            maxLength={500}
          />
        </Section>

        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2 rounded disabled:opacity-50"
        >
          {saving ? 'A guardar...' : 'Confirmar Fecho de Sessao'}
        </button>
      </form>

      {/* 7. History */}
      <Section title="Historico de fechos de sessao">
        {historyLoading ? (
          <div className="text-sm text-neutral-400">A carregar...</div>
        ) : history.length === 0 ? (
          <div className="text-sm text-neutral-400">Sem registos anteriores</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-auto">
              <thead>
                <tr className="text-left text-xs text-neutral-500 border-b">
                  <th className="p-2">Data/hora</th>
                  <th className="p-2">Esperado</th>
                  <th className="p-2">Contado</th>
                  <th className="p-2">Diferenca</th>
                  <th className="p-2">Banco</th>
                  <th className="p-2">Fundo</th>
                  <th className="p-2">Hopper</th>
                  <th className="p-2">Operador</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {history.map(dc => (
                  <React.Fragment key={dc._id}>
                    <tr className="border-t hover:bg-neutral-50">
                      <td className="p-2 whitespace-nowrap">{new Date(dc.createdAt).toLocaleString()}</td>
                      <td className="p-2">{fmt(dc.expectedCash ?? (Number(dc.openingFloat || 0) + Number(dc.totalCash || 0)))} &euro;</td>
                      <td className="p-2">{fmt(dc.countedCash)} &euro;</td>
                      <td className={`p-2 font-medium ${(dc.discrepancy || 0) < -0.005 ? 'text-red-600' : (dc.discrepancy || 0) > 0.005 ? 'text-amber-600' : 'text-green-600'}`}>
                        {(dc.discrepancy || 0) >= 0 ? '+' : ''}{fmt(dc.discrepancy)} &euro;
                      </td>
                      <td className="p-2 text-green-700 font-medium">{fmt(dc.amountToBank)} &euro;</td>
                      <td className="p-2">{fmt(dc.floatLeft)} &euro;</td>
                      <td className="p-2">{fmt(dc.hopperTotal)} &euro;</td>
                      <td className="p-2 text-neutral-500">{dc.closedByUsername || '-'}</td>
                      <td className="p-2">
                        <button
                          className="text-xs underline text-blue-600"
                          onClick={() => setExpandedId(prev => prev === dc._id ? null : dc._id)}
                        >
                          {expandedId === dc._id ? 'Fechar' : 'Detalhes'}
                        </button>
                      </td>
                    </tr>
                    {expandedId === dc._id && (
                      <tr>
                        <td colSpan={9} className="bg-neutral-50 p-3">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 text-xs">
                            <DetailBlock title="Periodo">
                              <div>Inicio: {dc.periodFrom ? new Date(dc.periodFrom).toLocaleString() : '-'}</div>
                              <div>Fim: {new Date(dc.periodTo || dc.createdAt).toLocaleString()}</div>
                              <div className="mt-1">
                                Vendas: {fmt(dc.totalSales)} &euro; ({fmt(dc.totalCash)} dinheiro + {fmt(dc.totalCard)} cartao)
                              </div>
                              <div>Fundo inicial: {fmt(dc.openingFloat)} &euro;</div>
                            </DetailBlock>
                            <DetailBlock title="Reconciliacao">
                              <div>Esperado: {fmt(dc.expectedCash ?? (Number(dc.openingFloat || 0) + Number(dc.totalCash || 0)))} &euro;</div>
                              <div>Contado: {fmt(dc.countedCash)} &euro;</div>
                              <div className={`font-medium ${(dc.discrepancy || 0) < -0.005 ? 'text-red-600' : (dc.discrepancy || 0) > 0.005 ? 'text-amber-600' : 'text-green-600'}`}>
                                Diferenca: {(dc.discrepancy || 0) >= 0 ? '+' : ''}{fmt(dc.discrepancy)} &euro;
                              </div>
                              {dc.countedDenominations?.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {dc.countedDenominations.map((d, i) => (
                                    <div key={i}>{fmtDenomLabel(d.value)} x {d.count} = {fmt(d.total)} &euro;</div>
                                  ))}
                                </div>
                              )}
                            </DetailBlock>
                            {dc.coinMechanismInventory?.length > 0 && (
                              <DetailBlock title="Mecanismo moedas">
                                {dc.coinMechanismInventory.map((d, i) => (
                                  <div key={i}>{fmtDenomLabel(d.value)} x {d.count} = {fmt(d.total)} &euro;</div>
                                ))}
                                <div className="font-medium mt-0.5">Total: {fmt(dc.coinMechanismTotal)} &euro;</div>
                              </DetailBlock>
                            )}
                            {dc.hopperCoins?.length > 0 && (
                              <DetailBlock title="Hopper (reabastecido)">
                                {dc.hopperCoins.map((d, i) => (
                                  <div key={i}>{fmtDenomLabel(d.value)} x {d.count} = {fmt(d.total)} &euro;</div>
                                ))}
                                <div className="font-medium mt-0.5">Total: {fmt(dc.hopperTotal)} &euro;</div>
                              </DetailBlock>
                            )}
                          </div>
                          {dc.notes && <div className="mt-2 text-xs text-neutral-600 italic">Notas: {dc.notes}</div>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

// Mini helpers
function StatCard({ label, value, color = 'text-neutral-700', bold }) {
  return (
    <div className="bg-neutral-50 rounded p-3 text-center">
      <div className="text-xs text-neutral-400 mb-1">{label}</div>
      <div className={`text-lg ${bold ? 'font-bold' : 'font-semibold'} ${color}`}>{value}</div>
    </div>
  )
}

function DetailBlock({ title, children }) {
  return (
    <div>
      <div className="font-medium mb-1 text-neutral-700">{title}</div>
      <div className="space-y-0.5 text-neutral-600">{children}</div>
    </div>
  )
}

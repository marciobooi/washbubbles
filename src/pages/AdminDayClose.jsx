import React, { useEffect, useState, useCallback, useRef } from 'react'
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
// Build denomination state from a saved array (e.g. from API), filling zeros for missing
function buildDenomFromSaved(values, saved) {
  return values.map(v => {
    const found = (saved || []).find(d => Math.abs(Number(d.value) - v) < 0.001)
    return { value: v, count: found ? Number(found.count || 0) : 0 }
  })
}
// Gap per denomination: max(0, target - actual)
function computeGap(targetDenoms, actualDenoms) {
  return COIN_DENOMS.map(v => {
    const t = targetDenoms.find(d => Math.abs(d.value - v) < 0.001)?.count || 0
    const a = actualDenoms.find(d => Math.abs(d.value - v) < 0.001)?.count || 0
    return { value: v, target: t, actual: a, toAdd: Math.max(0, t - a) }
  })
}

// Sub-component: denomination grid (with optional read-only mode)
function DenomGrid({ denoms, onChange, readOnly = false, highlightPositive = false, className = '' }) {
  return (
    <div className={`grid grid-cols-3 gap-2 sm:grid-cols-6 ${className}`}>
      {denoms.map((d, i) => (
        <div key={d.value} className="text-center">
          <div className="text-xs font-medium mb-1 text-neutral-600">{fmtDenomLabel(d.value)}</div>
          {readOnly ? (
            <div className={`border rounded px-1 py-1 w-full text-sm text-center bg-neutral-50 ${highlightPositive && d.count > 0 ? 'font-semibold text-blue-700' : 'text-neutral-500'}`}>
              {d.count || 0}
            </div>
          ) : (
            <input
              type="number"
              min="0"
              step="1"
              className="border rounded px-1 py-1 w-full text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={d.count || ''}
              onChange={e => onChange(i, e.target.value)}
              placeholder="0"
            />
          )}
          {d.count > 0 && (
            <div className="text-xs text-neutral-400 mt-0.5">{fmt(d.value * d.count)}&euro;</div>
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
  const [summary, setSummary]               = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  // Cash count denomination states
  const [countedDenoms, setCountedDenoms]   = useState(buildDenomState(ALL_CASH_DENOMS))

  // Mechanism: what's in the acceptor right now (user counts at close)
  const [mechanismDenoms, setMechanismDenoms] = useState(buildDenomState(COIN_DENOMS))

  // Hopper: actual remaining coins in the dispenser (before restock)
  const [hopperActualDenoms, setHopperActualDenoms] = useState(buildDenomState(COIN_DENOMS))

  // Hopper: target / desired state for next session (loaded from settings)
  const [hopperTargetDenoms, setHopperTargetDenoms] = useState(buildDenomState(COIN_DENOMS))
  const targetLoadedRef = useRef(false)

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
  const countedCash    = denomSum(countedDenoms)
  const mechanismTotal = denomSum(mechanismDenoms)
  const hopperActualTotal  = denomSum(hopperActualDenoms)
  const hopperTargetTotal  = denomSum(hopperTargetDenoms)
  const expectedCash   = summary ? Number(summary.openingFloat || 0) + Number(summary.totalCash || 0) : 0
  const discrepancy    = countedCash - expectedCash

  // Gap: what coins to add to the hopper to reach target
  const hopperGap = computeGap(hopperTargetDenoms, hopperActualDenoms)
  const hopperGapTotal = hopperGap.reduce((s, d) => s + d.toAdd * d.value, 0)

  // Load summary
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const data = await api.getDayCloseSummary()
      setSummary(data)
      // Pre-fill mechanism with opening state as reference starting point
      if (data.openingMechanismCoins?.length) {
        setMechanismDenoms(buildDenomFromSaved(COIN_DENOMS, data.openingMechanismCoins))
      }
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

  // Load hopper target from settings (uses getSettings to avoid 404 noise on first use)
  const loadHopperTarget = useCallback(async () => {
    if (targetLoadedRef.current) return
    try {
      const allSettings = await api.getSettings()
      const s = Array.isArray(allSettings) ? allSettings.find(x => x.key === 'hopperTarget') : null
      if (s?.value?.length) {
        setHopperTargetDenoms(buildDenomFromSaved(COIN_DENOMS, s.value))
        targetLoadedRef.current = true
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadSummary()
    loadHistory()
    loadHopperTarget()
  }, [loadSummary, loadHistory, loadHopperTarget])

  // Auto-fill floatLeft when amountToBank is typed
  function handleAmountToBank(val) {
    setAmountToBank(val)
    const remaining = countedCash - Number(val)
    if (!isNaN(remaining) && remaining >= 0) setFloatLeft(remaining.toFixed(2))
  }

  // Generic denom updater factory
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
      // Save hopper target to settings
      const targetPayload = COIN_DENOMS.map(v => {
        const d = hopperTargetDenoms.find(x => Math.abs(x.value - v) < 0.001)
        return { value: v, count: d?.count || 0 }
      }).filter(d => d.count > 0)
      await api.setSetting({ key: 'hopperTarget', value: targetPayload })

      await api.createDayClose({
        amountToBank: atb,
        floatLeft: fl,
        countedCash,
        countedDenominations: countedDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        coinMechanismInventory: mechanismDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        hopperActualBefore: hopperActualDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        hopperCoins: hopperTargetDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        notes
      })
      toast({ title: 'Fecho de sessao guardado com sucesso!' })
      setAmountToBank(''); setFloatLeft(''); setNotes('')
      setCountedDenoms(buildDenomState(ALL_CASH_DENOMS))
      setMechanismDenoms(buildDenomState(COIN_DENOMS))
      setHopperActualDenoms(buildDenomState(COIN_DENOMS))
      loadSummary(); loadHistory()
    } catch (err) {
      console.error(err)
      toast({ title: err?.body?.error || 'Erro ao guardar', variant: 'destructive' })
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
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
              <StatCard label="Fundo inicial"     value={`${fmt(summary.openingFloat)} \u20ac`} color="text-neutral-700" />
              <StatCard label="Vendas (dinheiro)" value={`${fmt(summary.totalCash)} \u20ac`}    color="text-green-700" />
              <StatCard label="Vendas (cartao)"   value={`${fmt(summary.totalCard)} \u20ac`}    color="text-blue-700" />
              <StatCard label="Esperado em caixa" value={`${fmt(summary.expectedCash)} \u20ac`} color="text-orange-700" bold />
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-neutral-500">
              <span>{summary.salesCount} transaccao(oes)</span>
              {summary.totalChangeDispensed > 0 && (
                <span>Troco dispensado este periodo: <strong>{fmt(summary.totalChangeDispensed)}&euro;</strong></span>
              )}
            </div>
            {/* Opening coin state from last close */}
            {(summary.openingHopperCoins?.length > 0 || summary.openingMechanismCoins?.length > 0) && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1">
                {summary.openingHopperCoins?.length > 0 && (
                  <div className="bg-blue-50 rounded p-3">
                    <div className="text-xs font-medium text-blue-700 mb-2">Hopper no inicio da sessao</div>
                    <DenomGrid denoms={buildDenomFromSaved(COIN_DENOMS, summary.openingHopperCoins)} readOnly highlightPositive />
                    <div className="text-xs text-blue-600 mt-1 font-medium">Total: {fmt(summary.openingHopperTotal)}&euro;</div>
                  </div>
                )}
                {summary.openingMechanismCoins?.length > 0 && (
                  <div className="bg-amber-50 rounded p-3">
                    <div className="text-xs font-medium text-amber-700 mb-2">Mecanismo no inicio da sessao</div>
                    <DenomGrid denoms={buildDenomFromSaved(COIN_DENOMS, summary.openingMechanismCoins)} readOnly highlightPositive />
                    <div className="text-xs text-amber-600 mt-1 font-medium">Total: {fmt(summary.openingMechanismTotal)}&euro;</div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : <div className="text-sm text-neutral-400">Sem dados</div>}
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
            {summary && (
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

        {/* 3. Float distribution */}
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
          subtitle="Moedas presentes no mecanismo aceitador no momento do fecho"
        >
          {summary?.openingMechanismCoins?.length > 0 && (
            <div className="text-xs text-neutral-500 mb-2">
              Inicio da sessao: {summary.openingMechanismCoins.map(d => `${fmtDenomLabel(d.value)}\u00d7${d.count}`).join(', ')}
              {' \u2014 '}{fmt(summary.openingMechanismTotal)}&euro;
            </div>
          )}
          <DenomGrid denoms={mechanismDenoms} onChange={makeUpdater(setMechanismDenoms)} />
          {mechanismTotal > 0 && (
            <div className="text-sm">Total no mecanismo: <span className="font-bold">{fmt(mechanismTotal)} &euro;</span></div>
          )}
        </Section>

        {/* 5. Hopper: actual remaining + target + gap */}
        <Section
          title="Hopper (dispensador de troco)"
          subtitle="Registe o estado atual, defina o objetivo e veja o que precisa de repor"
        >
          {/* 5a. Actual remaining */}
          <div>
            <div className="text-sm font-medium mb-1">Moedas restantes agora (antes de repor)</div>
            {summary?.openingHopperCoins?.length > 0 && summary.totalChangeDispensed > 0 && (
              <div className="text-xs text-neutral-500 mb-2">
                Inicio da sessao: {fmt(summary.openingHopperTotal)}&euro;
                {' \u2014 '}
                troco dispensado: {fmt(summary.totalChangeDispensed)}&euro;
                {' \u2014 '}
                estimativa restante: ~{fmt(Math.max(0, summary.openingHopperTotal - summary.totalChangeDispensed))}&euro;
              </div>
            )}
            <DenomGrid denoms={hopperActualDenoms} onChange={makeUpdater(setHopperActualDenoms)} />
            {hopperActualTotal > 0 && (
              <div className="text-xs text-neutral-500 mt-1">Total atual: {fmt(hopperActualTotal)}&euro;</div>
            )}
          </div>

          {/* 5b. Target */}
          <div className="border-t pt-3 mt-3">
            <div className="text-sm font-medium mb-1">Objetivo para a proxima sessao</div>
            <div className="text-xs text-neutral-400 mb-2">Define as quantidades desejadas por moeda. Guardado automaticamente ao fechar.</div>
            <DenomGrid denoms={hopperTargetDenoms} onChange={makeUpdater(setHopperTargetDenoms)} />
            {hopperTargetTotal > 0 && (
              <div className="text-xs text-neutral-500 mt-1">Target total: {fmt(hopperTargetTotal)}&euro;</div>
            )}
          </div>

          {/* 5c. Gap (auto-calculated) */}
          {hopperGap.some(d => d.toAdd > 0) && (
            <div className="border-t pt-3 mt-3">
              <div className="text-sm font-medium mb-2 text-blue-700">A repor no hopper</div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {hopperGap.map(d => (
                  <div key={d.value} className={`text-center rounded p-2 ${d.toAdd > 0 ? 'bg-blue-50 border border-blue-200' : 'opacity-30'}`}>
                    <div className="text-xs font-medium text-neutral-600">{fmtDenomLabel(d.value)}</div>
                    <div className={`text-lg font-bold ${d.toAdd > 0 ? 'text-blue-700' : 'text-neutral-400'}`}>
                      {d.toAdd > 0 ? `+${d.toAdd}` : '\u2013'}
                    </div>
                    {d.toAdd > 0 && (
                      <div className="text-xs text-blue-500">{fmt(d.toAdd * d.value)}&euro;</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="text-sm font-semibold text-blue-700 mt-2">
                Total a repor: {fmt(hopperGapTotal)}&euro;
              </div>
            </div>
          )}
          {hopperTargetTotal > 0 && !hopperGap.some(d => d.toAdd > 0) && (
            <div className="border-t pt-2 mt-2 text-sm text-green-600 font-medium">
              &#10003; Hopper ja esta completo ou acima do objetivo
            </div>
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
                              {dc.totalChangeDispensed > 0 && (
                                <div className="mt-1 text-neutral-500">Troco dispensado: {fmt(dc.totalChangeDispensed)}&euro;</div>
                              )}
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
                                {dc.openingMechanismCoins?.length > 0 && (
                                  <div className="text-neutral-400 mb-1">Inicio: {dc.openingMechanismCoins.map(d => `${fmtDenomLabel(d.value)}\u00d7${d.count}`).join(', ')}</div>
                                )}
                                {dc.coinMechanismInventory.map((d, i) => (
                                  <div key={i}>{fmtDenomLabel(d.value)} x {d.count} = {fmt(d.total)} &euro;</div>
                                ))}
                                <div className="font-medium mt-0.5">Total: {fmt(dc.coinMechanismTotal)} &euro;</div>
                              </DetailBlock>
                            )}
                            {(dc.hopperCoins?.length > 0 || dc.hopperActualBefore?.length > 0) && (
                              <DetailBlock title="Hopper">
                                {dc.hopperActualBefore?.length > 0 && (
                                  <div className="mb-1">
                                    <div className="text-neutral-400">Antes de repor:</div>
                                    {dc.hopperActualBefore.map((d, i) => (
                                      <div key={i}>{fmtDenomLabel(d.value)} x {d.count} = {fmt(d.total)}&euro;</div>
                                    ))}
                                    <div className="text-neutral-500">Total antes: {fmt(dc.hopperActualBeforeTotal)}&euro;</div>
                                  </div>
                                )}
                                {dc.hopperCoins?.length > 0 && (
                                  <div>
                                    <div className="text-neutral-400 mt-1">Objetivo (target):</div>
                                    {dc.hopperCoins.map((d, i) => (
                                      <div key={i}>{fmtDenomLabel(d.value)} x {d.count} = {fmt(d.total)}&euro;</div>
                                    ))}
                                    <div className="font-medium mt-0.5">Total target: {fmt(dc.hopperTotal)}&euro;</div>
                                  </div>
                                )}
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

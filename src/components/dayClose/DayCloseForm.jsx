import React, { useState, useRef, useEffect } from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import DayCloseReceiptModal from './DayCloseReceiptModal'
import {
  COIN_DENOMS, ALL_CASH_DENOMS,
  fmt, denomSum, buildDenomState, fmtDenomLabel, buildDenomFromSaved, computeGap,
  CoinChipGrid, HopperBar, Step, StatCard, MoneyInput, DiscrepancyPill,
} from './shared'

/**
 * The cash-reconciliation wizard itself — with none of the surrounding page
 * chrome. Only 3 steps are shown by default (count, bank/float split, notes);
 * mechanism + hopper counting is real but optional bookkeeping most closes
 * don't need, so it's tucked behind a collapsed "Avançado" disclosure instead
 * of forcing everyone through two more full coin-by-coin grids every time.
 *
 * Used by both `AdminDayClose.jsx` (which also renders history below it) and
 * `KioskDayCloseModal.jsx` (which renders it inside a staff-PIN-gated modal on
 * the kiosk itself). `onSubmit` is the only thing that differs between them —
 * which endpoint gets called, and whether a PIN rides along with it.
 */
export default function DayCloseForm({ summary, summaryLoading, onSubmit, onClosed, onEmail, onDone }) {
  const [countedDenoms, setCountedDenoms]   = useState(buildDenomState(ALL_CASH_DENOMS))
  const [mechanismDenoms, setMechanismDenoms]     = useState(buildDenomState(COIN_DENOMS))
  const [hopperActualDenoms, setHopperActualDenoms] = useState(buildDenomState(COIN_DENOMS))
  const [hopperTargetDenoms, setHopperTargetDenoms] = useState(buildDenomState(COIN_DENOMS))
  const targetLoadedRef = useRef(false)
  const [amountToBank, setAmountToBank] = useState('')
  const [floatLeft, setFloatLeft]       = useState('')
  const [notes, setNotes]               = useState('')
  const [saving, setSaving]             = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [closedRecord, setClosedRecord] = useState(null)

  const countedCash       = denomSum(countedDenoms)
  const mechanismTotal    = denomSum(mechanismDenoms)
  const hopperActualTotal = denomSum(hopperActualDenoms)
  const hopperTargetTotal = denomSum(hopperTargetDenoms)
  const expectedCash      = summary ? Number(summary.openingFloat || 0) + Number(summary.totalCash || 0) : 0
  const discrepancy       = countedCash - expectedCash
  const hopperGap         = computeGap(hopperTargetDenoms, hopperActualDenoms)
  const hopperGapTotal    = hopperGap.reduce((s, d) => s + d.toAdd * d.value, 0)
  const splitSum          = parseFloat(amountToBank || 0) + parseFloat(floatLeft || 0)
  const splitOk           = amountToBank !== '' && floatLeft !== '' && Math.abs(splitSum - countedCash) <= 0.005

  useEffect(() => {
    if (summary?.openingMechanismCoins?.length) {
      setMechanismDenoms(buildDenomFromSaved(COIN_DENOMS, summary.openingMechanismCoins))
    }
  }, [summary])

  // Hardware has already reported every coin/bill accepted since the last
  // close (services/cashDrawer.js — reset to zero on each real close), so
  // Step 1 starts from that instead of an all-zero grid. Only applied once:
  // re-fetching `summary` later (e.g. after adding a float) must not stomp on
  // counting the operator has already started entering by hand.
  const countedLoadedRef = useRef(false)
  useEffect(() => {
    if (countedLoadedRef.current) return
    if (summary?.acceptedDenominations?.length) {
      setCountedDenoms(buildDenomFromSaved(ALL_CASH_DENOMS, summary.acceptedDenominations))
      countedLoadedRef.current = true
    }
  }, [summary])

  // Common case: bank today's cash sales, keep the float unchanged — prefilled
  // as an editable default, not forced. Same once-only guard as above.
  const splitLoadedRef = useRef(false)
  useEffect(() => {
    if (splitLoadedRef.current) return
    if (summary && (summary.totalCash > 0 || summary.openingFloat > 0)) {
      setAmountToBank(Number(summary.totalCash || 0).toFixed(2))
      setFloatLeft(Number(summary.openingFloat || 0).toFixed(2))
      splitLoadedRef.current = true
    }
  }, [summary])

  // Each hopper peripheral tracks its own live coin count (`hopperConfig.currentCount`,
  // decremented in real time as change is paid out — see services/middleware.js).
  // A hopper only ever holds one denomination, so summing currentCount per
  // coinValue across all enabled hoppers gives the actual coin count without
  // anyone physically counting it. Still fully editable afterwards — this is a
  // prefill, not a replacement for catching real-world drift (jams, manual top-ups).
  const actualLoadedRef = useRef(false)
  useEffect(() => {
    if (actualLoadedRef.current) return
    actualLoadedRef.current = true
    api.getPeripherals().then((list) => {
      const hoppers = (list || []).filter(p => p.type === 'hopper' && p.enabled && p.hopperConfig?.coinValue)
      if (!hoppers.length) return
      const byValue = {}
      for (const h of hoppers) {
        const v = Number(h.hopperConfig.coinValue)
        byValue[v] = (byValue[v] || 0) + Number(h.hopperConfig.currentCount || 0)
      }
      setHopperActualDenoms(prev => prev.map(d => byValue[d.value] != null ? { ...d, count: byValue[d.value] } : d))
    }).catch(() => { /* live hopper stock is just a convenience prefill — manual count still works if this fails */ })
  }, [])

  useEffect(() => {
    if (targetLoadedRef.current) return
    api.getSettings().then((all) => {
      const s = Array.isArray(all) ? all.find(x => x.key === 'hopperTarget') : null
      if (s?.value?.length) {
        setHopperTargetDenoms(buildDenomFromSaved(COIN_DENOMS, s.value))
        targetLoadedRef.current = true
      }
    }).catch(() => { /* target defaults to zero — not fatal, just means nothing to compare against yet */ })
  }, [])

  function handleAmountToBank(val) {
    setAmountToBank(val)
    const remaining = countedCash - Number(val)
    if (!isNaN(remaining) && remaining >= 0) setFloatLeft(remaining.toFixed(2))
  }

  function makeUpdater(setter) {
    return (i, rawVal) => {
      const count = Math.max(0, parseInt(rawVal, 10) || 0)
      setter(prev => prev.map((d, idx) => idx === i ? { ...d, count } : d))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const atb = parseFloat(amountToBank)
    const fl  = parseFloat(floatLeft)
    if (isNaN(atb) || isNaN(fl)) return toast({ title: 'Preencha banco e fundo de caixa', variant: 'destructive' })
    if (atb < 0 || fl < 0) return toast({ title: 'Os valores nao podem ser negativos', variant: 'destructive' })
    if (Math.abs(atb + fl - countedCash) > 0.005) return toast({
      title: `Banco + Fundo (${fmt(atb + fl)}€) ≠ Total contado (${fmt(countedCash)}€)`,
      variant: 'destructive'
    })
    setSaving(true)
    try {
      const targetPayload = COIN_DENOMS.map(v => {
        const d = hopperTargetDenoms.find(x => Math.abs(x.value - v) < 0.001)
        return { value: v, count: d?.count || 0 }
      }).filter(d => d.count > 0)
      await api.setSetting({ key: 'hopperTarget', value: targetPayload }).catch(() => { /* best-effort — a kiosk token may not have admin rights to write raw settings; the close itself is what matters */ })
      const dc = await onSubmit({
        amountToBank: atb, floatLeft: fl, countedCash,
        countedDenominations: countedDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        coinMechanismInventory: mechanismDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        hopperActualBefore: hopperActualDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        hopperCoins: hopperTargetDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        notes
      })
      toast({ title: 'Sessao fechada com sucesso!' })
      setAmountToBank(''); setFloatLeft(''); setNotes('')
      setCountedDenoms(buildDenomState(ALL_CASH_DENOMS))
      setMechanismDenoms(buildDenomState(COIN_DENOMS))
      setHopperActualDenoms(buildDenomState(COIN_DENOMS))
      countedLoadedRef.current = false
      splitLoadedRef.current = false
      setClosedRecord(dc)
      if (onClosed) onClosed(dc)
    } catch (err) {
      console.error(err)
      toast({ title: err?.body?.error || 'Erro ao guardar', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-5">
      <DayCloseReceiptModal
        dc={closedRecord}
        onEmail={onEmail}
        onClose={() => { setClosedRecord(null); if (onDone) onDone() }}
      />

      {/* Session summary */}
      {summaryLoading ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 flex items-center gap-3 text-neutral-400 text-sm">
          <div className="w-4 h-4 rounded-full border-2 border-neutral-300 border-t-primary-500 animate-spin" />
          A carregar sessao...
        </div>
      ) : summary ? (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Fundo inicial"     value={`${fmt(summary.openingFloat)}€`} color="neutral" />
            <StatCard label="Vendas dinheiro"   value={`${fmt(summary.totalCash)}€`}    color="green" />
            <StatCard label="Vendas cartao"     value={`${fmt(summary.totalCard)}€`}    color="blue" />
            <StatCard label="Esperado em caixa" value={`${fmt(summary.expectedCash)}€`} color="orange" bold
              sub={`${summary.salesCount} transaccoes`} />
          </div>
          {summary.totalChangeDispensed > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-2 text-xs text-neutral-600">
              <span className="text-primary-500">&#8635;</span>
              Troco dispensado neste periodo: <strong className="text-neutral-800">{fmt(summary.totalChangeDispensed)}&euro;</strong>
            </div>
          )}
          {(summary.openingHopperCoins?.length > 0 || summary.openingMechanismCoins?.length > 0) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {summary.openingHopperCoins?.length > 0 && (
                <div className="rounded-xl bg-primary-50 border border-primary-100 p-3">
                  <div className="text-xs font-semibold text-primary-700 mb-2">Hopper no inicio</div>
                  <CoinChipGrid denoms={buildDenomFromSaved(COIN_DENOMS, summary.openingHopperCoins)} readOnly />
                  <div className="text-xs text-primary-600 font-semibold mt-2">Total: {fmt(summary.openingHopperTotal)}&euro;</div>
                </div>
              )}
              {summary.openingMechanismCoins?.length > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                  <div className="text-xs font-semibold text-amber-700 mb-2">Mecanismo no inicio</div>
                  <CoinChipGrid denoms={buildDenomFromSaved(COIN_DENOMS, summary.openingMechanismCoins)} readOnly />
                  <div className="text-xs text-amber-600 font-semibold mt-2">Total: {fmt(summary.openingMechanismTotal)}&euro;</div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Step number="1" title="Contagem de caixa" subtitle="Confirme o que já sabemos que entrou — só precisa de corrigir o que faltar ou sobrar" accent="teal">
          {summary?.acceptedTotal > 0 && (
            <div className="text-xs text-neutral-400 -mt-1">
              Pré-preenchido com o aceite desde o último fecho ({fmt(summary.acceptedTotal)}&euro;).
              {summary.openingFloat > 0 && <> Se o fundo inicial de {fmt(summary.openingFloat)}&euro; ainda lá estiver, adicione-o também.</>}
              {' '}Corrija o que não bater certo.
            </div>
          )}
          <CoinChipGrid denoms={countedDenoms} onChange={makeUpdater(setCountedDenoms)} />
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-3 text-sm">
            <div className="flex-1 min-w-0">
              <span className="text-neutral-500">Total contado</span>
              <span className="ml-2 text-xl font-extrabold text-neutral-800">{fmt(countedCash)}&euro;</span>
            </div>
            {summary && countedCash > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-neutral-400">Esperado: {fmt(expectedCash)}&euro;</span>
                <DiscrepancyPill value={discrepancy} />
              </div>
            )}
          </div>
        </Step>

        <button
          type="button"
          onClick={() => setShowAdvanced(s => !s)}
          className="w-full flex items-center justify-between gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 hover:bg-neutral-100 px-4 py-2.5 text-left transition"
        >
          <span className="text-xs font-semibold text-neutral-600">
            Avançado — mecanismo aceitador e hopper
            <span className="font-normal text-neutral-400 ml-1.5">(opcional, para reposição de troco)</span>
          </span>
          <span className={`text-neutral-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}>&#9660;</span>
        </button>

        {showAdvanced && (
          <>
            <Step title="Mecanismo aceitador" subtitle="Moedas presentes no aceitador no momento do fecho" accent="amber">
              {summary?.openingMechanismCoins?.length > 0 && (
                <div className="text-xs text-neutral-400 -mt-1">
                  Inicio: {summary.openingMechanismCoins.map(d => `${fmtDenomLabel(d.value)}×${d.count}`).join('  ')}{' '}
                  &mdash; {fmt(summary.openingMechanismTotal)}&euro;
                </div>
              )}
              <CoinChipGrid denoms={mechanismDenoms} onChange={makeUpdater(setMechanismDenoms)} />
              {mechanismTotal > 0 && (
                <div className="text-xs font-semibold text-amber-700">Total no mecanismo: {fmt(mechanismTotal)}&euro;</div>
              )}
            </Step>

            <Step title="Hopper (dispensador de troco)" subtitle="Registe o estado atual, defina o objetivo e veja o que repor" accent="blue">
          <div>
            <div className="text-xs font-semibold text-neutral-600 mb-1 uppercase tracking-wide">Moedas restantes agora</div>
            <div className="text-xs text-neutral-400 mb-2">Pré-preenchido com o stock atual dos hoppers — corrija se não bater certo.</div>
            {summary?.openingHopperCoins?.length > 0 && summary.totalChangeDispensed > 0 && (
              <div className="text-xs text-neutral-400 mb-2">
                Inicio: {fmt(summary.openingHopperTotal)}&euro; &mdash; troco dispensado: {fmt(summary.totalChangeDispensed)}&euro;
                &mdash; estimativa: ~{fmt(Math.max(0, summary.openingHopperTotal - summary.totalChangeDispensed))}&euro;
              </div>
            )}
            <CoinChipGrid denoms={hopperActualDenoms} onChange={makeUpdater(setHopperActualDenoms)} />
            {hopperActualTotal > 0 && <div className="text-xs text-neutral-500 mt-1">Total atual: {fmt(hopperActualTotal)}&euro;</div>}
          </div>

          <div className="border-t border-neutral-100 pt-3">
            <div className="text-xs font-semibold text-neutral-600 mb-1 uppercase tracking-wide">Objetivo por moeda</div>
            <div className="text-xs text-neutral-400 mb-2">Guardado automaticamente ao fechar.</div>
            <CoinChipGrid denoms={hopperTargetDenoms} onChange={makeUpdater(setHopperTargetDenoms)} />
            {hopperTargetTotal > 0 && <div className="text-xs text-neutral-500 mt-1">Target total: {fmt(hopperTargetTotal)}&euro;</div>}
          </div>

          {hopperTargetTotal > 0 && (
            <div className="border-t border-neutral-100 pt-3">
              <div className="text-xs font-semibold text-neutral-600 mb-3 uppercase tracking-wide">
                {hopperGap.some(d => d.toAdd > 0) ? `A repor: ${fmt(hopperGapTotal)}€` : '✓ Hopper completo'}
              </div>
              <div className="space-y-2">
                {hopperGap.map(d => (
                  <HopperBar key={d.value} value={d.value} actual={d.actual} target={d.target} />
                ))}
              </div>
              {hopperGap.some(d => d.toAdd > 0) && (
                <div className="grid grid-cols-3 gap-1.5 mt-3 sm:grid-cols-6">
                  {hopperGap.filter(d => d.toAdd > 0).map(d => (
                    <div key={d.value} className="rounded-lg bg-blue-50 border border-blue-200 py-2 px-1 text-center">
                      <div className="text-[11px] text-neutral-500">{fmtDenomLabel(d.value)}</div>
                      <div className="text-lg font-extrabold text-blue-700">+{d.toAdd}</div>
                      <div className="text-[10px] text-blue-500">{fmt(d.toAdd * d.value)}&euro;</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
            </Step>
          </>
        )}

        <Step number="2" title="Distribuicao do dinheiro" subtitle="Quanto vai para o banco e quanto fica como fundo" accent="emerald">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MoneyInput
              label="Para o banco"
              value={amountToBank}
              onChange={handleAmountToBank}
              required
              hint="Os restantes sao atribuidos automaticamente ao fundo"
            />
            <MoneyInput
              label="Fundo da proxima sessao"
              value={floatLeft}
              onChange={setFloatLeft}
              required
            />
          </div>
          {amountToBank !== '' && floatLeft !== '' && (
            <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium
              ${splitOk ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
              {splitOk
                ? <>{'✓'} Banco + Fundo = {fmt(splitSum)}&euro; — correto</>
                : <>{'⚠'} Banco + Fundo = {fmt(splitSum)}&euro; — deve ser {fmt(countedCash)}&euro;</>
              }
            </div>
          )}
        </Step>

        <Step number="3" title="Notas e confirmacao" accent="violet">
          <textarea
            className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-400 text-neutral-700 placeholder-neutral-300"
            rows={3}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Observacoes opcionais sobre este fecho..."
            maxLength={500}
          />
          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white font-semibold py-3 text-sm transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {saving ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> A guardar...</>
            ) : (
              'Confirmar Fecho de Sessao'
            )}
          </button>
        </Step>
      </form>
    </div>
  )
}

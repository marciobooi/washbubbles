import React, { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'

const COIN_DENOMS = [0.05, 0.10, 0.20, 0.50, 1.00, 2.00]
const BILL_DENOMS = [5, 10, 20, 50, 100, 200]
const ALL_CASH_DENOMS = [...COIN_DENOMS, ...BILL_DENOMS]

function fmt(n) { return Number(n || 0).toFixed(2) }
function denomSum(arr) { return arr.reduce((s, d) => s + Number(d.value) * Number(d.count || 0), 0) }
function buildDenomState(values) { return values.map(v => ({ value: v, count: 0 })) }
function fmtDenomLabel(v) {
  if (v < 1) return `${Math.round(v * 100)}c`
  if (v % 1 === 0) return `${v}\u20ac`
  return `${Number(v).toFixed(2)}\u20ac`
}
function buildDenomFromSaved(values, saved) {
  return values.map(v => {
    const found = (saved || []).find(d => Math.abs(Number(d.value) - v) < 0.001)
    return { value: v, count: found ? Number(found.count || 0) : 0 }
  })
}
function computeGap(targetDenoms, actualDenoms) {
  return COIN_DENOMS.map(v => {
    const t = targetDenoms.find(d => Math.abs(d.value - v) < 0.001)?.count || 0
    const a = actualDenoms.find(d => Math.abs(d.value - v) < 0.001)?.count || 0
    return { value: v, target: t, actual: a, toAdd: Math.max(0, t - a) }
  })
}

// ── Coin chip grid — each denomination is a card with a stepper input ────────
function CoinChipGrid({ denoms, onChange, readOnly = false, className = '' }) {
  const isCoin = v => v < 3
  return (
    <div className={`grid grid-cols-3 gap-2 sm:grid-cols-6 ${className}`}>
      {denoms.map((d, i) => {
        const coin = isCoin(d.value)
        const active = d.count > 0
        return (
          <div
            key={d.value}
            className={`relative flex flex-col items-center rounded-xl border-2 py-2 px-1 transition-all
              ${readOnly
                ? active ? 'border-primary-300 bg-primary-50' : 'border-neutral-100 bg-neutral-50 opacity-50'
                : active ? 'border-primary-400 bg-primary-50 shadow-sm' : 'border-neutral-200 bg-white hover:border-primary-300'
              }`}
          >
            {/* Coin/bill icon */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mb-1
              ${coin
                ? active ? 'bg-primary-500 text-white' : 'bg-neutral-200 text-neutral-500'
                : active ? 'bg-emerald-500 text-white' : 'bg-neutral-200 text-neutral-500'
              }`}>
              {fmtDenomLabel(d.value)}
            </div>
            {readOnly ? (
              <div className={`text-base font-bold ${active ? 'text-primary-700' : 'text-neutral-400'}`}>
                {d.count || 0}
              </div>
            ) : (
              <input
                type="number" min="0" step="1"
                className="w-full text-center text-sm font-semibold border-0 bg-transparent p-0 focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                value={d.count === 0 ? '' : d.count}
                onChange={e => onChange(i, e.target.value)}
                placeholder="0"
              />
            )}
            {active && (
              <div className="text-[10px] text-primary-600 font-medium mt-0.5">
                {fmt(d.value * d.count)}&euro;
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Hopper bar — visual fill per denomination ─────────────────────────────────
function HopperBar({ actual, target, value }) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
  const color = pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="w-10 text-xs font-semibold text-neutral-600 text-right">{fmtDenomLabel(value)}</div>
      <div className="flex-1 h-3 bg-neutral-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-20 text-xs text-neutral-500 text-right">
        {actual}/{target} <span className={pct < 100 ? 'text-red-500 font-semibold' : 'text-emerald-600'}>({pct}%)</span>
      </div>
    </div>
  )
}

// ── Step section wrapper ──────────────────────────────────────────────────────
function Step({ number, title, subtitle, children, accent = 'teal' }) {
  const accents = {
    teal:   'border-primary-500 bg-primary-50 text-primary-700',
    amber:  'border-amber-500 bg-amber-50 text-amber-700',
    emerald:'border-emerald-500 bg-emerald-50 text-emerald-700',
    blue:   'border-blue-500 bg-blue-50 text-blue-700',
    violet: 'border-violet-500 bg-violet-50 text-violet-700',
  }
  const badge = accents[accent] || accents.teal
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 px-5 pt-5 pb-3">
        {number && (
          <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${badge}`}>
            {number}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-semibold text-sm text-neutral-800 leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-neutral-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="px-5 pb-5 space-y-4">{children}</div>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = 'neutral', bold }) {
  const colors = {
    neutral: 'bg-neutral-50 border-neutral-200 text-neutral-700',
    teal:    'bg-primary-50 border-primary-200 text-primary-700',
    green:   'bg-emerald-50 border-emerald-200 text-emerald-700',
    blue:    'bg-blue-50 border-blue-200 text-blue-700',
    orange:  'bg-orange-50 border-orange-200 text-orange-700',
    red:     'bg-red-50 border-red-200 text-red-600',
    amber:   'bg-amber-50 border-amber-200 text-amber-700',
  }
  return (
    <div className={`rounded-xl border px-3 py-3 text-center ${colors[color] || colors.neutral}`}>
      <div className="text-[11px] font-medium opacity-70 mb-1 leading-tight">{label}</div>
      <div className={`text-xl leading-none ${bold ? 'font-extrabold' : 'font-semibold'}`}>{value}</div>
      {sub && <div className="text-[10px] opacity-60 mt-1">{sub}</div>}
    </div>
  )
}

// ── Money input ───────────────────────────────────────────────────────────────
function MoneyInput({ label, value, onChange, readOnly, hint, required }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-neutral-600 mb-1.5">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm font-medium">&euro;</span>
        <input
          type="number" min="0" step="0.01" required={required}
          readOnly={readOnly}
          className={`w-full pl-7 pr-3 py-2.5 rounded-xl border text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-400 transition
            ${readOnly ? 'bg-neutral-50 text-neutral-500 border-neutral-200' : 'bg-white border-neutral-300 text-neutral-800'}`}
          value={value}
          onChange={onChange ? e => onChange(e.target.value) : undefined}
          placeholder="0.00"
        />
      </div>
      {hint && <p className="text-[11px] text-neutral-400 mt-1">{hint}</p>}
    </div>
  )
}

// ── Discrepancy pill ──────────────────────────────────────────────────────────
function DiscrepancyPill({ value }) {
  const zero = Math.abs(value) <= 0.005
  const neg  = value < -0.005
  if (zero) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-0.5">&#10003; Balancado</span>
  return (
    <span className={`inline-flex items-center rounded-full text-xs font-bold px-2.5 py-0.5 ${neg ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
      {value > 0 ? '+' : ''}{fmt(value)}&euro;
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminDayClose() {
  const [summary, setSummary]               = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [countedDenoms, setCountedDenoms]   = useState(buildDenomState(ALL_CASH_DENOMS))
  const [mechanismDenoms, setMechanismDenoms]     = useState(buildDenomState(COIN_DENOMS))
  const [hopperActualDenoms, setHopperActualDenoms] = useState(buildDenomState(COIN_DENOMS))
  const [hopperTargetDenoms, setHopperTargetDenoms] = useState(buildDenomState(COIN_DENOMS))
  const targetLoadedRef = useRef(false)
  const [amountToBank, setAmountToBank] = useState('')
  const [floatLeft, setFloatLeft]       = useState('')
  const [notes, setNotes]               = useState('')
  const [saving, setSaving]             = useState(false)
  const [history, setHistory]               = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [expandedId, setExpandedId]         = useState(null)

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

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const data = await api.getDayCloseSummary()
      setSummary(data)
      if (data.openingMechanismCoins?.length)
        setMechanismDenoms(buildDenomFromSaved(COIN_DENOMS, data.openingMechanismCoins))
    } catch (e) {
      console.error(e)
      toast({ title: 'Erro ao carregar resumo', variant: 'destructive' })
    } finally { setSummaryLoading(false) }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try { setHistory(await api.getDayCloses()) }
    catch (e) { console.error(e) }
    finally { setHistoryLoading(false) }
  }, [])

  const loadHopperTarget = useCallback(async () => {
    if (targetLoadedRef.current) return
    try {
      const all = await api.getSettings()
      const s = Array.isArray(all) ? all.find(x => x.key === 'hopperTarget') : null
      if (s?.value?.length) {
        setHopperTargetDenoms(buildDenomFromSaved(COIN_DENOMS, s.value))
        targetLoadedRef.current = true
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadSummary(); loadHistory(); loadHopperTarget() }, [loadSummary, loadHistory, loadHopperTarget])

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
      title: `Banco + Fundo (${fmt(atb + fl)}\u20ac) \u2260 Total contado (${fmt(countedCash)}\u20ac)`,
      variant: 'destructive'
    })
    setSaving(true)
    try {
      const targetPayload = COIN_DENOMS.map(v => {
        const d = hopperTargetDenoms.find(x => Math.abs(x.value - v) < 0.001)
        return { value: v, count: d?.count || 0 }
      }).filter(d => d.count > 0)
      await api.setSetting({ key: 'hopperTarget', value: targetPayload })
      await api.createDayClose({
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
      loadSummary(); loadHistory()
    } catch (err) {
      console.error(err)
      toast({ title: err?.body?.error || 'Erro ao guardar', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-heading font-bold text-neutral-800">Fecho de Caixa</h1>
          {summary && !summaryLoading && (
            <p className="text-xs text-neutral-400 mt-0.5">
              Sessao desde {new Date(summary.periodFrom).toLocaleString('pt-PT')}
            </p>
          )}
        </div>
        {summary && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Sessao ativa
          </span>
        )}
      </div>

      {/* ── Session summary ─────────────────────────────────────────────── */}
      {summaryLoading ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 flex items-center gap-3 text-neutral-400 text-sm">
          <div className="w-4 h-4 rounded-full border-2 border-neutral-300 border-t-primary-500 animate-spin" />
          A carregar sessao...
        </div>
      ) : summary ? (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Fundo inicial"     value={`${fmt(summary.openingFloat)}\u20ac`} color="neutral" />
            <StatCard label="Vendas dinheiro"   value={`${fmt(summary.totalCash)}\u20ac`}    color="green" />
            <StatCard label="Vendas cartao"     value={`${fmt(summary.totalCard)}\u20ac`}    color="blue" />
            <StatCard label="Esperado em caixa" value={`${fmt(summary.expectedCash)}\u20ac`} color="orange" bold
              sub={`${summary.salesCount} transaccoes`} />
          </div>
          {summary.totalChangeDispensed > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-2 text-xs text-neutral-600">
              <span className="text-primary-500">&#8635;</span>
              Troco dispensado neste periodo: <strong className="text-neutral-800">{fmt(summary.totalChangeDispensed)}&euro;</strong>
            </div>
          )}
          {/* Opening coin state */}
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

      {/* ── Form ────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Step 1 — Cash count */}
        <Step number="1" title="Contagem de caixa" subtitle="Conte todas as moedas e notas na maquina/caixa registadora" accent="teal">
          <CoinChipGrid denoms={countedDenoms} onChange={makeUpdater(setCountedDenoms)} />
          {/* Live totals bar */}
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

        {/* Step 2 — Mechanism */}
        <Step number="2" title="Mecanismo aceitador" subtitle="Moedas presentes no aceitador no momento do fecho" accent="amber">
          {summary?.openingMechanismCoins?.length > 0 && (
            <div className="text-xs text-neutral-400 -mt-1">
              Inicio: {summary.openingMechanismCoins.map(d => `${fmtDenomLabel(d.value)}\u00d7${d.count}`).join('  ')}{' '}
              &mdash; {fmt(summary.openingMechanismTotal)}&euro;
            </div>
          )}
          <CoinChipGrid denoms={mechanismDenoms} onChange={makeUpdater(setMechanismDenoms)} />
          {mechanismTotal > 0 && (
            <div className="text-xs font-semibold text-amber-700">Total no mecanismo: {fmt(mechanismTotal)}&euro;</div>
          )}
        </Step>

        {/* Step 3 — Hopper */}
        <Step number="3" title="Hopper (dispensador de troco)" subtitle="Registe o estado atual, defina o objetivo e veja o que repor" accent="blue">

          {/* 3a — Actual */}
          <div>
            <div className="text-xs font-semibold text-neutral-600 mb-2 uppercase tracking-wide">Moedas restantes agora</div>
            {summary?.openingHopperCoins?.length > 0 && summary.totalChangeDispensed > 0 && (
              <div className="text-xs text-neutral-400 mb-2">
                Inicio: {fmt(summary.openingHopperTotal)}&euro; &mdash; troco dispensado: {fmt(summary.totalChangeDispensed)}&euro;
                &mdash; estimativa: ~{fmt(Math.max(0, summary.openingHopperTotal - summary.totalChangeDispensed))}&euro;
              </div>
            )}
            <CoinChipGrid denoms={hopperActualDenoms} onChange={makeUpdater(setHopperActualDenoms)} />
            {hopperActualTotal > 0 && <div className="text-xs text-neutral-500 mt-1">Total atual: {fmt(hopperActualTotal)}&euro;</div>}
          </div>

          {/* 3b — Target */}
          <div className="border-t border-neutral-100 pt-3">
            <div className="text-xs font-semibold text-neutral-600 mb-1 uppercase tracking-wide">Objetivo por moeda</div>
            <div className="text-xs text-neutral-400 mb-2">Guardado automaticamente ao fechar.</div>
            <CoinChipGrid denoms={hopperTargetDenoms} onChange={makeUpdater(setHopperTargetDenoms)} />
            {hopperTargetTotal > 0 && <div className="text-xs text-neutral-500 mt-1">Target total: {fmt(hopperTargetTotal)}&euro;</div>}
          </div>

          {/* 3c — Gap progress bars */}
          {hopperTargetTotal > 0 && (
            <div className="border-t border-neutral-100 pt-3">
              <div className="text-xs font-semibold text-neutral-600 mb-3 uppercase tracking-wide">
                {hopperGap.some(d => d.toAdd > 0) ? `A repor: ${fmt(hopperGapTotal)}\u20ac` : '\u2713 Hopper completo'}
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

        {/* Step 4 — Split bank / float */}
        <Step number="4" title="Distribuicao do dinheiro" subtitle="Quanto vai para o banco e quanto fica como fundo" accent="emerald">
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
                ? <>{'\u2713'} Banco + Fundo = {fmt(splitSum)}&euro; — correto</>
                : <>{'\u26A0'} Banco + Fundo = {fmt(splitSum)}&euro; — deve ser {fmt(countedCash)}&euro;</>
              }
            </div>
          )}
        </Step>

        {/* Step 5 — Notes + submit */}
        <Step number="5" title="Notas e confirmacao" accent="violet">
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

      {/* ── History ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-neutral-100">
          <h3 className="font-semibold text-sm text-neutral-800">Historico de fechos</h3>
        </div>
        {historyLoading ? (
          <div className="p-6 text-sm text-neutral-400">A carregar...</div>
        ) : history.length === 0 ? (
          <div className="p-6 text-sm text-neutral-400">Sem registos anteriores</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {history.map(dc => {
              const disc = dc.discrepancy || 0
              const isOpen = expandedId === dc._id
              return (
                <div key={dc._id}>
                  {/* Row */}
                  <button
                    type="button"
                    className="w-full text-left px-5 py-4 hover:bg-neutral-50 transition flex flex-wrap items-center gap-x-5 gap-y-1"
                    onClick={() => setExpandedId(prev => prev === dc._id ? null : dc._id)}
                  >
                    <div className="text-xs text-neutral-400 w-32 shrink-0">
                      {new Date(dc.createdAt).toLocaleString('pt-PT', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs text-neutral-500">Esperado <strong className="text-neutral-700">{fmt(dc.expectedCash ?? (Number(dc.openingFloat||0)+Number(dc.totalCash||0)))}&euro;</strong></span>
                      <span className="text-xs text-neutral-500">Contado <strong className="text-neutral-700">{fmt(dc.countedCash)}&euro;</strong></span>
                      <DiscrepancyPill value={disc} />
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      <span className="rounded-full bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-0.5">
                        Banco {fmt(dc.amountToBank)}&euro;
                      </span>
                      <span className="text-neutral-400">{dc.closedByUsername || 'admin'}</span>
                      <span className={`text-primary-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>&#9660;</span>
                    </div>
                  </button>
                  {/* Expanded detail */}
                  {isOpen && (
                    <div className="bg-neutral-50 border-t border-neutral-100 px-5 py-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 text-xs">
                        <DetailBlock title="Periodo">
                          <InfoRow label="Inicio" value={dc.periodFrom ? new Date(dc.periodFrom).toLocaleString('pt-PT') : '-'} />
                          <InfoRow label="Fim" value={new Date(dc.periodTo || dc.createdAt).toLocaleString('pt-PT')} />
                          <InfoRow label="Vendas" value={`${fmt(dc.totalSales)}\u20ac (${fmt(dc.totalCash)} din + ${fmt(dc.totalCard)} cart)`} />
                          <InfoRow label="Fundo inicial" value={`${fmt(dc.openingFloat)}\u20ac`} />
                          {dc.totalChangeDispensed > 0 && <InfoRow label="Troco dispensado" value={`${fmt(dc.totalChangeDispensed)}\u20ac`} />}
                        </DetailBlock>
                        <DetailBlock title="Reconciliacao">
                          <InfoRow label="Esperado" value={`${fmt(dc.expectedCash ?? (Number(dc.openingFloat||0)+Number(dc.totalCash||0)))}\u20ac`} />
                          <InfoRow label="Contado" value={`${fmt(dc.countedCash)}\u20ac`} />
                          <div className="flex justify-between pt-0.5">
                            <span className="text-neutral-500">Diferenca</span><DiscrepancyPill value={disc} />
                          </div>
                          {dc.countedDenominations?.length > 0 && (
                            <div className="mt-2 grid grid-cols-3 gap-1">
                              {dc.countedDenominations.map((d, i) => (
                                <div key={i} className="bg-white rounded border px-1 py-0.5 text-center">
                                  <div className="text-neutral-400">{fmtDenomLabel(d.value)}</div>
                                  <div className="font-bold">x{d.count}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </DetailBlock>
                        <DetailBlock title="Hopper">
                          {dc.hopperActualBefore?.length > 0 && (
                            <>
                              <div className="text-neutral-400 mb-1">Antes de repor:</div>
                              {dc.hopperActualBefore.map((d, i) => (
                                <InfoRow key={i} label={fmtDenomLabel(d.value)} value={`x${d.count} = ${fmt(d.total)}\u20ac`} />
                              ))}
                              <InfoRow label="Subtotal" value={`${fmt(dc.hopperActualBeforeTotal)}\u20ac`} />
                            </>
                          )}
                          {dc.hopperCoins?.length > 0 && (
                            <>
                              <div className="text-neutral-400 mt-2 mb-1">Target reposicao:</div>
                              {dc.hopperCoins.map((d, i) => (
                                <InfoRow key={i} label={fmtDenomLabel(d.value)} value={`x${d.count} = ${fmt(d.total)}\u20ac`} />
                              ))}
                              <InfoRow label="Total target" value={`${fmt(dc.hopperTotal)}\u20ac`} />
                            </>
                          )}
                        </DetailBlock>
                      </div>
                      {dc.notes && (
                        <div className="mt-3 rounded-xl bg-white border border-neutral-200 px-4 py-2 text-xs text-neutral-600 italic">
                          &ldquo;{dc.notes}&rdquo;
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-neutral-400 shrink-0">{label}</span>
      <span className="text-neutral-700 font-medium text-right truncate">{value}</span>
    </div>
  )
}

function DetailBlock({ title, children }) {
  return (
    <div className="space-y-1">
      <div className="font-semibold text-neutral-700 mb-1.5">{title}</div>
      {children}
    </div>
  )
}


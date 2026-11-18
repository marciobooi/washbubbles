import React, { useState, useRef, useEffect } from 'react'
import { toast } from '@/components/ui/Toast'
import api from '@/services/api'
import DayCloseReceiptModal from './DayCloseReceiptModal'
import { shopDateTime } from '@/lib/shopTime'
import {
  COIN_DENOMS, ALL_CASH_DENOMS,
  fmt, denomSum, buildDenomState, fmtDenomLabel, buildDenomFromSaved, computeGap,
  CoinChipGrid, HopperBar, Step, StatCard, MoneyInput, DiscrepancyPill, planBank,
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
// `view` picks what is on screen while the SAME state stays mounted (the hopper counts are submitted with the close):
// 'fecho' = summary, cash count, what to take out, split, notes; 'hopper' = mechanism + hopper stock/target/refill.
/** The summary of the open period: what to take to the bank, how the expected count is made up, and what is NOT counted. */
function SummaryPanel({ summary }) {
  const sold = Number(summary.cashSales ?? summary.totalCash ?? 0)
  const recharges = Number(summary.totalRecharges || 0)
  const withdrawn = Number(summary.floatWithdrawn || 0)
  const added = Number(summary.floatAdded || 0)
  const opening = Number(summary.openingFloat || 0)
  // Everything the CUSTOMERS put in as cash (sales, card top-ups, new cards), minus what was already taken out. The hopper reinforcements
  // and the admin's own float top-ups are the shop's money, not the customers': they do not count, they are shown for information.
  const fromCustomers = Number(summary.totalCash ?? sold + recharges)
  const toBank = Math.max(0, Math.round((fromCustomers - withdrawn) * 100) / 100)
  const { noteRows, notesToBank, notesStay, notesTotal, coinsPart } = planBank(summary.acceptedDenominations, toBank)
  const hasNoteRecord = noteRows.length > 0
  const Row = ({ label, hint, value, sign, strong, muted }) => (
    <div className={`flex items-baseline justify-between gap-4 py-2 border-b border-neutral-100 last:border-0 ${strong ? 'font-bold text-neutral-900' : muted ? 'text-neutral-500' : 'text-neutral-700'}`}>
      <div className="min-w-0">
        <div className={strong ? 'text-base' : 'text-sm'}>{label}</div>
        {hint && <div className="text-xs text-neutral-400 font-normal">{hint}</div>}
      </div>
      <div className={`shrink-0 tabular-nums ${strong ? 'text-xl' : 'text-base font-semibold'}`}>{sign}{fmt(value)}€</div>
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-500">
        <span>Tudo isto é <strong className="text-neutral-700">desde o último fecho</strong>{summary.periodFrom ? <>: {shopDateTime(summary.periodFrom)}</> : ''} · {summary.salesCount} transações</span>
        <span>Depois de um fecho, recomeça do fundo que ficou.</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* what to bank */}
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 flex flex-col">
          <div className="text-sm font-semibold text-emerald-700">Dinheiro a levar ao banco</div>
          <div className="text-5xl font-black text-emerald-800 leading-tight mt-1">{fmt(toBank)}€</div>
          <p className="text-sm text-emerald-800/80 mt-2">
            Todo o dinheiro que os clientes puseram desde o último fecho: vendas ({fmt(sold)}€) e recargas de cartões ({fmt(recharges)}€){withdrawn > 0 ? `, menos ${fmt(withdrawn)}€ que já levantou` : ''}. Não conta o dinheiro do hopper e do admin, o consumo de cartões nem o MB WAY.
          </p>
          {hasNoteRecord && toBank > 0 && (
            <div className="mt-4 rounded-xl bg-white/70 border border-emerald-200 p-3 text-sm text-emerald-900">
              <div className="font-semibold mb-1">Em que notas e moedas</div>
              <div>Notas: {notesToBank.length ? notesToBank.map((d, i) => <span key={d.value}>{i ? ' + ' : ''}<strong>{d.take} × {fmt(d.value).replace('.00', '')}€</strong></span>) : <strong>nenhuma</strong>}{notesTotal > 0 && <> = <strong>{fmt(notesTotal)}€</strong></>}</div>
              <div>Moedas: <strong>{fmt(coinsPart)}€</strong>{coinsPart > 0 ? ' (a tirar do hopper, como um troco)' : ''}</div>
              {notesStay.length > 0 && (
                <div className="text-xs text-emerald-800/80 mt-1">
                  Ficam na caixa, como parte do fundo: {notesStay.map((d, i) => <span key={d.value}>{i ? ' + ' : ''}{d.left} × {fmt(d.value).replace('.00', '')}€</span>)}.
                </div>
              )}
              <div className="text-xs text-emerald-800/70 mt-1">Notas e moedas aceites desde o último fecho. A soma é sempre os {fmt(toBank)}€.</div>
            </div>
          )}
          <div className="mt-auto pt-4 text-xs text-emerald-800/70">
            Fica na máquina o fundo de caixa: <strong>{fmt(opening + added)}€</strong> ({fmt(opening)}€ do último fecho + {fmt(added)}€ de fundo adicionado), que não é dos clientes.
          </div>
        </div>
        {/* expected count */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="text-sm font-semibold text-neutral-500 mb-1">Esperado na máquina (para a contagem)</div>
          {/* the float is always the last close's float PLUS the reinforcements put in since */}
          <Row label="Fundo de caixa" hint={added > 0 ? `${fmt(opening)}€ do último fecho + ${fmt(added)}€ de fundo adicionado` : 'o que ficou na caixa no último fecho'} value={opening + added} />
          <Row label="Vendas em dinheiro" hint="máquinas e venda de cartões" value={sold} sign="+" />
          <Row label="Recargas de cartões" hint="dinheiro dos clientes" value={recharges} sign="+" />
          {withdrawn > 0 && <Row label="Levantamentos" hint="já retirado da máquina" value={withdrawn} sign="-" />}
          <Row label="Esperado em caixa" value={Number(summary.expectedCash)} strong />
        </div>
        {/* not counted */}
        <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5">
          <div className="text-sm font-semibold text-blue-700 mb-1">Não entra na conta</div>
          <Row label="Fundo adicionado" hint="já incluído no fundo de caixa: dinheiro da loja, não dos clientes" value={added} />
          <Row label="Consumo de cartões" hint="gasto do saldo dos cartões: já foi contado quando o cartão foi recarregado" value={Number(summary.totalCard || 0)} muted />
          <Row label="MB WAY" hint="pago direto ao banco: não passa pela máquina" value={Number(summary.totalMbway || 0)} muted />
          {Number(summary.totalChangeDispensed) > 0 && <Row label="Troco dado" hint="já descontado nas vendas em dinheiro" value={Number(summary.totalChangeDispensed)} muted />}
        </div>
      </div>
    </div>
  )
}

export default function DayCloseForm({ summary, summaryLoading, onSubmit, onPayoutCoins, onClosed, onEmail, onDone, view = 'fecho', hidden = false }) {
  const [countedDenoms, setCountedDenoms]   = useState(buildDenomState(ALL_CASH_DENOMS))
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
  const hopperActualTotal = denomSum(hopperActualDenoms)
  const hopperTargetTotal = denomSum(hopperTargetDenoms)
  const expectedCash      = summary ? Number(summary.openingFloat || 0) + Number(summary.totalCash || 0) + Number(summary.floatAdded || 0) - Number(summary.floatWithdrawn || 0) : 0
  const discrepancy       = countedCash - expectedCash
  const hopperGap         = computeGap(hopperTargetDenoms, hopperActualDenoms)
  const hopperGapTotal    = hopperGap.reduce((s, d) => s + d.toAdd * d.value, 0)
  const splitSum          = parseFloat(amountToBank || 0) + parseFloat(floatLeft || 0)

  // What to take out of the till: the machine already knows what came in (coin acceptor + note reader, step 1 is
  // prefilled from it) and what the hopper holds, so this is just the list. Coins first refill the hopper up to its
  // target; what is left of each coin value, and every note, is what leaves the till.
  const floatTarget = floatLeft !== '' && !isNaN(parseFloat(floatLeft)) ? parseFloat(floatLeft) : null
  const withdrawPlan = (() => {
    const base = countedDenoms.map((d) => {
      const isCoin = d.value < 3
      const refill = isCoin ? Math.min(d.count, hopperGap.find((g) => Math.abs(g.value - d.value) < 0.001)?.toAdd || 0) : 0
      return { value: d.value, isCoin, count: d.count, toHopper: refill, keepNotes: 0, take: 0 }
    })
    // The float may need a note (e.g. leave 5 EUR for tomorrow because the coins do not add up): after the hopper
    // refill, keep the smallest notes that are still needed to reach the float, never more than it.
    let need = floatTarget == null ? 0 : floatTarget - base.reduce((s, d) => s + d.toHopper * d.value, 0)
    for (const d of base.filter((x) => !x.isCoin).sort((x, y) => x.value - y.value)) {
      while (need >= d.value - 0.005 && d.keepNotes < d.count) { d.keepNotes += 1; need -= d.value }
    }
    base.forEach((d) => { d.take = Math.max(0, d.count - d.toHopper - d.keepNotes) })
    return base
  })()
  const keptNotes = withdrawPlan.filter((d) => d.keepNotes > 0)
  const takeTotal   = withdrawPlan.reduce((s, d) => s + d.take * d.value, 0)
  const hopperTotalIn = withdrawPlan.reduce((s, d) => s + d.toHopper * d.value, 0)
  const splitOk           = amountToBank !== '' && floatLeft !== '' && Math.abs(splitSum - countedCash) <= 0.005

  // The coins somebody last counted in the hopper (a close's hopper count, or the coins put in with a float top-up / reinforcement) come
  // back here, with the date and the change given since: they were saved before but never shown again. Only once, so nothing already typed
  // is overwritten; the admin corrects it.
  const hopperLoadedRef = useRef(false)
  useEffect(() => {
    if (hopperLoadedRef.current) return
    if (summary?.lastHopperCount?.coins?.length) {
      setHopperActualDenoms(buildDenomFromSaved(COIN_DENOMS, summary.lastHopperCount.coins))
      hopperLoadedRef.current = true
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
    // The count starts EMPTY: what the machines accepted is not what is in the box (the change already given out is not in it any more),
    // so a pre-filled count showed a false surplus (2026-11-18: 1654,70 € counted, 1204,80 € expected). The operator counts the box.
  }, [summary])

  // Common case: bank today's cash sales, keep the float unchanged — prefilled
  // as an editable default, not forced. Same once-only guard as above.
  // There is no "next session float" field any more (the Hopper tab is where the change stock is managed): the
  // bank amount defaults to everything counted minus the coins that refill the hopper to its target, and whatever
  // is not banked simply stays (the server still stores it as the float of the next session).
  const bankEditedRef = useRef(false)
  const splitLoadedRef = useRef(false)

  // The hopper stock is NOT prefilled: the system knows every coin that comes in, but not which coins go out as change
  // (only the euro amount is known), so the stock per coin can only be counted by hand in the Hopper tab.

  function handleAmountToBank(val) {
    bankEditedRef.current = true
    setAmountToBank(val)
  }

  const refillTotal = countedDenoms.filter((d) => d.value < 3).reduce((s, d) => s + Math.min(d.count, hopperGap.find((g) => Math.abs(g.value - d.value) < 0.001)?.toAdd || 0) * d.value, 0)
  // AUTOMATIC: what goes to the bank is everything the customers put in as cash since the last close (sales and card top-ups), minus what
  // was already taken out; it does not depend on counting anything first. What stays is the rest of what is in the machine (the hopper's
  // float): what was counted, or what the machine is expected to hold while nothing has been counted yet. Both can still be edited.
  const autoBank = summary ? Math.max(0, Math.round((Number(summary.totalCash || 0) - Number(summary.floatWithdrawn || 0)) * 100) / 100) : 0
  const expectedNow = summary ? Number(summary.expectedCash || 0) : 0
  useEffect(() => {
    if (bankEditedRef.current) return
    setAmountToBank(autoBank > 0 ? autoBank.toFixed(2) : '')
  }, [autoBank])
  // the float is always the rest, so bank + float is exactly what was counted
  useEffect(() => {
    const atb = parseFloat(amountToBank)
    const base = countedCash > 0 ? countedCash : expectedNow
    setFloatLeft(isNaN(atb) ? '' : Math.max(0, base - atb).toFixed(2))
  }, [amountToBank, countedCash, expectedNow])

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
    if (isNaN(atb) || isNaN(fl)) return toast({ title: 'Indique o valor para o banco', variant: 'destructive' })
    if (atb < 0 || fl < 0) return toast({ title: 'Os valores nao podem ser negativos', variant: 'destructive' })
    if (!(countedCash > 0)) return toast({ title: 'Conte o dinheiro que está na caixa (notas e moedas) antes de fechar', variant: 'destructive' })
    if (Math.abs(atb + fl - countedCash) > 0.005) return toast({
      title: `Banco + Fundo (${fmt(atb + fl)}€) ≠ Total contado (${fmt(countedCash)}€)`,
      variant: 'destructive'
    })
    setSaving(true)
    try {
      // The coins of the deposit come out of the hopper by themselves when the close is confirmed, like change: the whole notes that fit go
      // to the bank by hand. What the hopper really paid is what is recorded; the rest stays in the machine.
      const plan = planBank(summary?.acceptedDenominations, atb)
      let finalBank = atb
      let coinsPaid = plan.coinsPart
      if (onPayoutCoins && plan.coinsPart > 0) {
        const ok = window.confirm(`Vão cair ${fmt(plan.coinsPart)}€ em moedas do hopper, no tabuleiro do troco à frente do quiosque. Notas para o banco: ${fmt(plan.notesTotal)}€. Está aí para as apanhar?`)
        if (!ok) return
        let paid
        try { paid = await onPayoutCoins(plan.coinsPart) } catch (err) {
          return toast({ title: err?.body?.error || 'O hopper não pagou as moedas. Nada foi registado.', variant: 'destructive' })
        }
        coinsPaid = Number(paid?.dispensed) || 0
        if (paid?.unconfirmed && !coinsPaid) coinsPaid = window.confirm('O hopper não confirmou o pagamento. Saíram as moedas no tabuleiro?') ? plan.coinsPart : 0
        coinsPaid = Math.min(plan.coinsPart, coinsPaid)
        finalBank = Math.round((atb - (plan.coinsPart - coinsPaid)) * 100) / 100
        if (coinsPaid < plan.coinsPart) toast({ title: `O hopper só pagou ${fmt(coinsPaid)}€ de ${fmt(plan.coinsPart)}€`, description: 'O resto ficou na caixa.', variant: 'warning' })
      }
      const dc = await onSubmit({
        amountToBank: finalBank, floatLeft: Math.round((countedCash - finalBank) * 100) / 100, countedCash,
        bankBreakdown: { notes: plan.notesToBank.map((d) => ({ value: d.value, count: d.take })), coins: coinsPaid, coinsAsked: plan.coinsPart },
        countedDenominations: countedDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        hopperActualBefore: hopperActualDenoms.filter(d => d.count > 0).map(d => ({ value: d.value, count: d.count })),
        notes
      })
      toast({ title: 'Sessao fechada com sucesso!' })
      setAmountToBank(''); setFloatLeft(''); setNotes('')
      setCountedDenoms(buildDenomState(ALL_CASH_DENOMS))
      hopperLoadedRef.current = false
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
    <div className={`space-y-5 ${hidden ? 'hidden' : ''}`}>
      <DayCloseReceiptModal
        dc={closedRecord}
        onEmail={onEmail}
        onClose={() => { setClosedRecord(null); if (onDone) onDone() }}
      />

      {/* Session summary */}
      <div className={view === 'fecho' ? 'space-y-5' : 'hidden'}>
      {summaryLoading ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 flex items-center gap-3 text-neutral-400 text-sm">
          <div className="w-4 h-4 rounded-full border-2 border-neutral-300 border-t-primary-500 animate-spin" />
          A carregar sessao...
        </div>
      ) : summary ? (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 space-y-4">
          <SummaryPanel summary={summary} />
          {summary.openingHopperCoins?.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {summary.openingHopperCoins?.length > 0 && (
                <div className="rounded-xl bg-primary-50 border border-primary-100 p-3">
                  <div className="text-xs font-semibold text-primary-700 mb-2">Hopper no inicio</div>
                  <CoinChipGrid denoms={buildDenomFromSaved(COIN_DENOMS, summary.openingHopperCoins)} readOnly />
                  <div className="text-xs text-primary-600 font-semibold mt-2">Total: {fmt(summary.openingHopperTotal)}&euro;</div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className={view === 'fecho' ? 'space-y-4' : 'hidden'}>
        <Step number="1" title="Contagem de caixa" subtitle="Conte o dinheiro que está na caixa (notas e moedas)" accent="teal">
          {summary && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900">
              Vendas em dinheiro <strong>{fmt(Number(summary.totalCash || 0) - Number(summary.floatWithdrawn || 0))}&euro;</strong>
              {' '}+ fundo de maneio <strong>{fmt(expectedCash - (Number(summary.totalCash || 0) - Number(summary.floatWithdrawn || 0)))}&euro;</strong>
              {' '}= deve haver <strong>{fmt(expectedCash)}&euro;</strong> na caixa. Conte o que lá está.
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

        {countedCash > 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
            <div className="text-sm font-bold text-emerald-900">Retirar da caixa</div>
            <div className="flex flex-wrap gap-2">
              {withdrawPlan.filter((d) => d.take > 0).sort((a, b) => b.value - a.value).map((d) => (
                <span key={d.value} className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-emerald-200 px-3 py-2 text-base font-extrabold text-emerald-800">
                  {d.take} <span className="text-emerald-500 font-bold">×</span> {fmtDenomLabel(d.value)}
                </span>
              ))}
              {takeTotal === 0 && <span className="text-sm text-neutral-500">Nada a retirar.</span>}
            </div>
            <div className="text-xs text-emerald-800">
              Total a retirar: <strong>{fmt(takeTotal)}&euro;</strong>
              {hopperTotalIn > 0 && <> · fica no hopper para repor o troco: <strong>{fmt(hopperTotalIn)}&euro;</strong> ({withdrawPlan.filter((d) => d.toHopper > 0).map((d) => `${d.toHopper}×${fmtDenomLabel(d.value)}`).join(', ')})</>}
              {keptNotes.length > 0 && <> · nota(s) que ficam no fundo: {keptNotes.map((d) => `${d.keepNotes}×${fmtDenomLabel(d.value)}`).join(', ')}</>}
              . As notas saem todas, exceto as que escolher deixar para acertar o fundo. A lista parte do que as máquinas registaram; corrija a contagem acima se algo não bater.
            </div>
          </div>
        )}

        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced(s => !s)}
          hidden
          className="w-full flex items-center justify-between gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 hover:bg-neutral-100 px-4 py-2.5 text-left transition"
        >
          <span className="text-xs font-semibold text-neutral-600">
            Avançado — mecanismo aceitador e hopper
            <span className="font-normal text-neutral-400 ml-1.5">(opcional, para reposição de troco)</span>
          </span>
          <span className={`text-neutral-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}>&#9660;</span>
        </button>

        {view === 'hopper' && (
          <>
            <Step title="Hopper (dispensador de troco)" subtitle="As moedas que entram caem logo no hopper: é aqui que se contam. Registe o estado atual, defina o objetivo e veja o que repor" accent="blue">
          <div>
            <div className="text-xs font-semibold text-neutral-600 mb-1 uppercase tracking-wide">Moedas restantes agora</div>
            <div className="text-xs text-neutral-400 mb-2">Conte as moedas que estão no hopper agora. O sistema sabe o que entra, mas não que moedas saem no troco (só o valor em euros).</div>
            {summary?.lastHopperCount && (
              <div className="text-xs text-primary-700 bg-primary-50 border border-primary-100 rounded-lg px-3 py-2 mb-2">
                Pré-preenchido com a última contagem: {shopDateTime(summary.lastHopperCount.at)} ({summary.lastHopperCount.source === 'close' ? 'fecho' : summary.lastHopperCount.source === 'restore' ? 'moedas repostas no hopper' : 'moedas postas no hopper'}, {fmt(summary.lastHopperCount.total)}&euro;).
                {summary.lastHopperCount.changeGivenSince > 0 ? <> Desde então o troco dado foi {fmt(summary.lastHopperCount.changeGivenSince)}&euro;. </> : ' '}
                Corrija para o que está lá agora.
              </div>
            )}
            {summary?.openingHopperCoins?.length > 0 && summary.totalChangeDispensed > 0 && (
              <div className="text-xs text-neutral-400 mb-2">
                No início: {fmt(summary.openingHopperTotal)}&euro; &mdash; troco dado desde então: {fmt(summary.totalChangeDispensed)}&euro; (em euros; as moedas exatas não são registadas)
              </div>
            )}
            <CoinChipGrid denoms={hopperActualDenoms} onChange={makeUpdater(setHopperActualDenoms)} />
            {hopperActualTotal > 0 && <div className="text-xs text-neutral-500 mt-1">Total atual: {fmt(hopperActualTotal)}&euro;</div>}
          </div>

            </Step>
          </>
        )}

        <div className={view === 'fecho' ? 'space-y-4' : 'hidden'}>
        <Step number="2" title="Para o banco" subtitle="O que retira da caixa agora; o resto fica na caixa e o hopper gere-se no menu Hopper" accent="emerald">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MoneyInput
              label="Para o banco"
              value={amountToBank}
              onChange={handleAmountToBank}
              required
              hint="Automático: todo o dinheiro que os clientes puseram desde o último fecho (vendas e recargas), menos o que já levantou. Pode alterar."
            />
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm self-end">
              <div className="text-neutral-500">Fica na caixa</div>
              <div className="text-xl font-extrabold text-neutral-800">{floatLeft !== '' ? fmt(floatLeft) : '0.00'}&euro;</div>
            </div>
          </div>
          {amountToBank !== '' && parseFloat(amountToBank) > countedCash + 0.005 && (
            <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium bg-red-50 border border-red-200 text-red-600">
              {'⚠'} Não pode levar para o banco mais do que contou ({fmt(countedCash)}&euro;)
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
        </div>
      </form>
    </div>
  )
}

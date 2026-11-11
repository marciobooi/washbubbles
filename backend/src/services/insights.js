/**
 * Numbers for the owner's dashboard: money held for customers on cards, this week and this month against the one before, the average
 * ticket, how busy every machine is, wash against dry, the customers, and the hours of the day. All in the shop's own time (Lisbon).
 *
 * Money rule (same as the day close): "revenue" = cash + MB WAY. What is spent from a card was counted when the card was loaded, so a
 * card payment is a USE of the machines (cycles, ticket) but never revenue.
 */
import mongoose from 'mongoose'
import Sale from '../models/sale.js'
import Machine from '../models/machine.js'
import Card from '../models/card.js'
import Price from '../models/price.js'
import Setting from '../models/setting.js'

const TZ = 'Europe/Lisbon'
const DAY = 24 * 3600e3
export const HOURS_KEY = 'shop.hours'
export const DEFAULT_HOURS = { open: 7, close: 23 }
const r2 = (n) => Math.round(n * 100) / 100
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)

/** The shop's wall clock for an instant: 'YYYY-MM-DD', hour, minute, and the ISO weekday (1 = Monday). */
export function lisbon(d) {
  const [day, time] = new Date(d).toLocaleString('sv-SE', { timeZone: TZ }).split(' ')
  const [h, m] = time.split(':').map(Number)
  const dow = new Date(day + 'T12:00:00Z').getUTCDay() || 7
  return { day, hour: h, minute: m, dow }
}
const shiftDay = (day, n) => new Date(new Date(day + 'T12:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10)
const monthOf = (day) => day.slice(0, 7)
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

/** Compare "so far this week/month" with the same stretch of the previous one. `byDay` is day -> revenue. */
export function periodComparison(byDay, today, firstDay = null) {
  const sum = (from, to) => { let t = 0; for (let d = from; d <= to; d = shiftDay(d, 1)) t += byDay.get(d) || 0; return r2(t) }
  const dow = lisbon(today + 'T12:00:00Z').dow
  const weekStart = shiftDay(today, -(dow - 1))
  const prevWeekStart = shiftDay(weekStart, -7)
  const monthStart = today.slice(0, 8) + '01'
  const prevMonthStart = monthOf(shiftDay(monthStart, -1)) + '-01'
  const dayN = Number(today.slice(8))
  const prevMonthLast = shiftDay(monthStart, -1)
  const prevMonthTo = Number(prevMonthLast.slice(8)) >= dayN ? prevMonthLast.slice(0, 8) + String(dayN).padStart(2, '0') : prevMonthLast
  // The shop only started on `firstDay`: a previous period that began before it was never complete, so comparing with it would show
  // a huge, meaningless rise (month 1 against 11 days of the month before the first sale). Then there is no percentage.
  const mk = (cur, prev, prevFull, prevStart) => ({ current: cur, previous: prev, previousFull: prevFull, partial: Boolean(firstDay && firstDay > prevStart), deltaPct: prev > 0 && !(firstDay && firstDay > prevStart) ? Math.round((cur / prev - 1) * 100) : null })
  return {
    week: mk(sum(weekStart, today), sum(prevWeekStart, shiftDay(prevWeekStart, dow - 1)), sum(prevWeekStart, shiftDay(prevWeekStart, 6)), prevWeekStart),
    month: mk(sum(monthStart, today), sum(prevMonthStart, prevMonthTo), sum(prevMonthStart, prevMonthLast), prevMonthStart),
    weekStart, monthStart,
  }
}

export async function computeInsights(tenantId, { days = 30, now = new Date() } = {}) {
  const tid = new mongoose.Types.ObjectId(String(tenantId))
  const today = lisbon(now).day
  const windowStart = new Date(now.getTime() - days * DAY)
  const histStart = new Date(now.getTime() - 70 * DAY) // covers "this month" and the whole previous month

  const [machines, prices, hoursRow, cards, recent] = await Promise.all([
    Machine.find({ tenantId: tid }).select('name type weight tImp status outOfService').lean(),
    Price.find({ tenantId: tid, type: 'wash' }).select('weight duration').lean(),
    Setting.findOne({ tenantId: tid, key: HOURS_KEY }).lean(),
    Card.find({ tenantId: tid }).select('code balance status createdAt').lean(),
    Sale.find({ tenantId: tid, createdAt: { $gte: histStart }, status: { $ne: 'refunded' } })
      .select('amount method type machineId batchId cardCode items createdAt').lean(),
  ])
  const hours = { open: Number(hoursRow?.value?.open ?? DEFAULT_HOURS.open), close: Number(hoursRow?.value?.close ?? DEFAULT_HOURS.close) }
  const openHours = Math.max(1, hours.close - hours.open)
  const washMin = new Map(prices.map((p) => [Number(p.weight), Number(p.duration) || 0]))
  const defaultWash = Number(process.env.WASH_DEFAULT_MINUTES) || 60
  const mById = new Map(machines.map((m) => [String(m._id), m]))
  const minutesOf = (s, m) => {
    const q = Math.max(1, Number(Array.isArray(s.items) ? s.items[0]?.quantity : 1) || 1)
    return m.type === 'dry' ? q * (Number(m.tImp) || 15) : (washMin.get(Number(m.weight)) || defaultWash)
  }

  // ── revenue, this week / month against the one before ──
  const byDay = new Map()
  for (const s of recent) {
    if (s.method !== 'cash' && s.method !== 'mbway') continue
    const d = lisbon(s.createdAt).day
    byDay.set(d, (byDay.get(d) || 0) + (Number(s.amount) || 0))
  }
  const first = await Sale.findOne({ tenantId: tid, method: { $in: ['cash', 'mbway'] } }).sort({ createdAt: 1 }).select('createdAt').lean()
  const revenue = periodComparison(byDay, today, first ? lisbon(first.createdAt).day : null)

  // ── what the window holds: machine payments = cycles ──
  const inWin = recent.filter((s) => s.createdAt >= windowStart)
  const pays = inWin.filter((s) => s.type === 'payment' && s.machineId && mById.has(String(s.machineId)))
  const firstDay = pays.length ? pays.map((s) => lisbon(s.createdAt).day).sort()[0] : today
  const windowDays = Math.max(1, Math.round((new Date(today + 'T12:00:00Z') - new Date(firstDay + 'T12:00:00Z')) / DAY) + 1)

  // ticket: per cycle and per visit (a visit = one payment batch)
  const visits = new Map()
  for (const s of pays) visits.set(s.batchId || String(s._id), (visits.get(s.batchId || String(s._id)) || 0) + (Number(s.amount) || 0))
  const total = pays.reduce((t, s) => t + (Number(s.amount) || 0), 0)
  const ticket = { perCycle: pays.length ? r2(total / pays.length) : 0, perVisit: visits.size ? r2(total / visits.size) : 0, visits: visits.size, cycles: pays.length }

  // ── machines, wash/dry, hours ──
  const per = new Map(machines.map((m) => [String(m._id), { id: String(m._id), name: m.name, type: m.type, cycles: 0, adminStarts: 0, revenue: 0, minutes: 0, lastUsedAt: null }]))
  // the staff's own starts (no money) also keep a machine busy: they count in its occupancy, apart from its paid cycles
  const starts = inWin.filter((s) => s.type === 'admin_start' && s.machineId && mById.has(String(s.machineId)))
  const hourCycles = Array(24).fill(0)
  const hourMinutes = Array(24).fill(0)
  const firstLast = new Map() // day -> [first hour, last hour]
  for (const s of [...pays, ...starts]) {
    const m = mById.get(String(s.machineId))
    const row = per.get(String(s.machineId))
    const mins = minutesOf(s, m)
    const paid = s.type === 'payment'
    if (paid) { row.cycles++; row.revenue += Number(s.amount) || 0 } else row.adminStarts++
    row.minutes += mins
    const L = lisbon(s.createdAt)
    if (paid) hourCycles[L.hour]++
    let left = mins
    let at = L.hour * 60 + L.minute
    while (left > 0) { const inHour = Math.min(left, 60 - (at % 60)); hourMinutes[Math.floor(at / 60) % 24] += inHour; left -= inHour; at += inHour }
    if (paid) {
      const fl = firstLast.get(L.day) || [24, -1]
      firstLast.set(L.day, [Math.min(fl[0], L.hour), Math.max(fl[1], L.hour)])
    }
  }
  // last use ever (not only the window): a machine nobody uses stands out
  const lastUse = await Sale.aggregate([
    { $match: { tenantId: tid, type: 'payment', status: { $ne: 'refunded' }, machineId: { $ne: null } } },
    { $group: { _id: '$machineId', last: { $max: '$createdAt' } } },
  ])
  for (const x of lastUse) { const row = per.get(String(x._id)); if (row) row.lastUsedAt = x.last }
  const availMin = openHours * 60 * windowDays
  const machineRows = [...per.values()].map((r) => ({
    id: r.id, name: r.name, type: r.type, cycles: r.cycles, adminStarts: r.adminStarts, revenue: r2(r.revenue),
    occupancyPct: availMin > 0 ? Math.min(100, Math.round((r.minutes / availMin) * 100)) : 0,
    lastUsedAt: r.lastUsedAt, daysSinceUse: r.lastUsedAt ? Math.floor((now - new Date(r.lastUsedAt)) / DAY) : null,
  })).sort((a, b) => b.revenue - a.revenue || String(a.name).localeCompare(String(b.name), 'pt', { numeric: true }))

  const kind = (t) => {
    const rows = machineRows.filter((m) => m.type === t)
    const mins = [...per.values()].filter((r) => r.type === t).reduce((s, r) => s + r.minutes, 0)
    return { machines: rows.length, cycles: rows.reduce((s, m) => s + m.cycles, 0), revenue: r2(rows.reduce((s, m) => s + m.revenue, 0)), occupancyPct: rows.length && availMin ? Math.min(100, Math.round((mins / (availMin * rows.length)) * 100)) : 0 }
  }
  const washDry = { wash: kind('wash'), dry: kind('dry') }
  washDry.cyclesSharePct = { wash: pct(washDry.wash.cycles, washDry.wash.cycles + washDry.dry.cycles), dry: pct(washDry.dry.cycles, washDry.wash.cycles + washDry.dry.cycles) }

  const nMachines = Math.max(1, machines.length)
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, cycles: hourCycles[h], occupancyPct: Math.min(100, Math.round((hourMinutes[h] / (60 * nMachines * windowDays)) * 100)) }))
  const fls = [...firstLast.values()]
  const hoursInfo = { configured: hours, typicalFirst: median(fls.map((x) => x[0])), typicalLast: median(fls.map((x) => x[1])), days: windowDays, hourly }

  // ── cards and customers ──
  const holding = cards.filter((c) => (Number(c.balance) || 0) > 0 && c.status !== 'blocked')
  const lastByCard = new Map()
  const allCardSales = await Sale.aggregate([
    { $match: { tenantId: tid, cardCode: { $nin: [null, ''] } } },
    { $group: { _id: '$cardCode', last: { $max: '$createdAt' } } },
  ])
  for (const x of allCardSales) lastByCard.set(x._id, x.last)
  const idleLimit = new Date(now.getTime() - 60 * DAY)
  const idle = holding.filter((c) => (lastByCard.get(c.code) || c.createdAt) < idleLimit)
  const cardsLiability = {
    total: r2(holding.reduce((s, c) => s + c.balance, 0)), cards: holding.length,
    idle: { cards: idle.length, amount: r2(idle.reduce((s, c) => s + c.balance, 0)), afterDays: 60 },
  }

  const useByCard = (from, to) => {
    const m = new Map()
    for (const s of recent) {
      if (!s.cardCode || s.createdAt < from || s.createdAt >= to) continue
      if (s.type !== 'payment' && s.type !== 'recharge' && s.type !== 'card_purchase') continue
      const e = m.get(s.cardCode) || { days: new Set(), spent: 0 }
      e.days.add(lisbon(s.createdAt).day)
      if (s.type === 'payment' && s.method === 'card') e.spent += Number(s.amount) || 0
      m.set(s.cardCode, e)
    }
    return m
  }
  const cur = useByCard(windowStart, new Date(now.getTime() + 1))
  const prev = useByCard(new Date(windowStart.getTime() - days * DAY), windowStart)
  const seg = { regular: { cards: 0, spent: 0 }, occasional: { cards: 0, spent: 0 }, single: { cards: 0, spent: 0 } }
  for (const e of cur.values()) { const k = e.days.size >= 4 ? 'regular' : e.days.size >= 2 ? 'occasional' : 'single'; seg[k].cards++; seg[k].spent += e.spent }
  const spentAll = Object.values(seg).reduce((s, x) => s + x.spent, 0)
  const back = [...prev.keys()].filter((c) => cur.has(c)).length
  const monthsBack = (n) => { const out = []; let d = today.slice(0, 7) + '-01'; for (let i = 0; i < n; i++) { out.unshift(monthOf(d)); d = shiftDay(d, -1).slice(0, 8) + '01' } return out }
  const sixMonths = monthsBack(6)
  const newByMonth = Object.fromEntries(sixMonths.map((m) => [m, 0]))
  const sold = await Sale.find({ tenantId: tid, type: 'card_purchase', createdAt: { $gte: new Date(now.getTime() - 200 * DAY) } }).select('createdAt').lean()
  for (const s of sold) { const m = monthOf(lisbon(s.createdAt).day); if (m in newByMonth) newByMonth[m]++ }
  const mixRows = { cash: { cycles: 0, amount: 0 }, card: { cycles: 0, amount: 0 }, mbway: { cycles: 0, amount: 0 } }
  for (const s of pays) { const k = s.method === 'cash' ? 'cash' : s.method === 'mbway' ? 'mbway' : 'card'; mixRows[k].cycles++; mixRows[k].amount += Number(s.amount) || 0 }
  const clients = {
    days,
    activeCards: cur.size,
    newCardsByMonth: sixMonths.map((m) => ({ month: m, cards: newByMonth[m] })),
    segments: Object.fromEntries(Object.entries(seg).map(([k, v]) => [k, { cards: v.cards, spent: r2(v.spent), sharePct: pct(v.spent, spentAll) }])),
    retention: { previousActive: prev.size, cameBack: back, pct: pct(back, prev.size) },
    paymentMix: Object.fromEntries(Object.entries(mixRows).map(([k, v]) => [k, { cycles: v.cycles, amount: r2(v.amount), cyclesPct: pct(v.cycles, pays.length) }])),
  }

  return { generatedAt: now, days, today, revenue, ticket, cardsLiability, machines: machineRows, washDry, hours: hoursInfo, clients }
}

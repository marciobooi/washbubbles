/**
 * The admin always shows the SHOP's time (Lisbon), whatever time zone the computer looking at it is in. Sales are stored as exact
 * instants (UTC); showing them with the browser's own zone put a 23:00 sale at 00:00 on a computer one hour ahead (2026-11-03).
 */
export const SHOP_TZ = 'Europe/Lisbon'

const f = (opts) => new Intl.DateTimeFormat('pt-PT', { timeZone: SHOP_TZ, ...opts })
const D = (v) => (v instanceof Date ? v : new Date(v))

export const shopDate = (v) => f({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(D(v))
export const shopTime = (v) => f({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(D(v))
export const shopDateTime = (v, opts) => (opts ? f({ ...opts, hourCycle: 'h23' }).format(D(v)) : `${shopDate(v)}, ${shopTime(v)}`)

const parts = (v) => { const o = {}; f({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(D(v)).forEach((p) => { o[p.type] = p.value }); return o }
/** YYYY-MM-DD of the shop's calendar day */
export const shopDayKey = (v = new Date()) => { const p = parts(v); return `${p.year}-${p.month}-${p.day}` }
/** HH:MM in the shop */
export const shopHHMM = (v) => { const p = parts(v); return `${p.hour}:${p.minute}` }

const offsetMs = (ts) => { const p = parts(new Date(ts)); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000 }
/** The exact instant of a shop wall-clock time: shopInstant('2026-11-03', '00:00:00') is midnight in Lisbon, wherever the browser is. */
export function shopInstant(dateStr, timeStr = '00:00:00', ms = 0) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const [H, M, S] = String(timeStr).split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, H || 0, M || 0, S || 0, ms)
  let t = guess - offsetMs(guess)
  t = guess - offsetMs(t)
  return new Date(t)
}

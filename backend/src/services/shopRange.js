/**
 * A date range of the shop's own calendar (Lisbon), for the dashboard filters: ?from=YYYY-MM-DD&to=YYYY-MM-DD (both days included),
 * either may be missing (open on that side), ?all=1 = the whole history. Returns instants: `from` = 00:00 of the first day, `to` =
 * 00:00 of the day AFTER the last one (so a query is createdAt >= from && createdAt < to).
 */
const TZ = 'Europe/Lisbon'
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** The instant of 00:00 in the shop on a civil date 'YYYY-MM-DD' (Lisbon is 0 or 1 hour ahead of UTC). */
export function shopDayStart(day) {
  const [y, m, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(guess)).filter((x) => x.type !== 'literal').map((x) => [x.type, +x.value]))
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess
  return new Date(guess - offset)
}

export const nextDay = (day) => new Date(new Date(day + 'T12:00:00Z').getTime() + 86400e3).toISOString().slice(0, 10)

/** { active, fromDay, toDay, from: Date|null, to: Date|null } from a query; `active` is false when the query names no range at all. */
export function shopRange(query = {}) {
  const fromDay = DAY_RE.test(String(query.from || '')) ? String(query.from) : null
  const toDay = DAY_RE.test(String(query.to || '')) ? String(query.to) : null
  const all = query.all === '1' || query.all === 'true' || query.all === true
  return {
    active: Boolean(fromDay || toDay || all),
    fromDay, toDay,
    from: fromDay ? shopDayStart(fromDay) : null,
    to: toDay ? shopDayStart(nextDay(toDay)) : null,
  }
}

/** A Mongo createdAt condition for a range (null when it has no limits). */
export function createdAtMatch(range) {
  const c = {}
  if (range.from) c.$gte = range.from
  if (range.to) c.$lt = range.to
  return Object.keys(c).length ? { createdAt: c } : {}
}

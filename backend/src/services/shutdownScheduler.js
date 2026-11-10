/**
 * Scheduled shutdown of the SHOP PC (Definições → Periféricos → "Desligar o computador"), e.g. every day at 23:30.
 * Graceful: a full-screen countdown on the kiosk for the last 3 minutes; if a customer still has credit in the machine it waits (up to 10 minutes);
 * the sales waiting to be sent to the central server are flushed; then scripts/graceful-shutdown.ps1 closes the kiosk screen,
 * stops the backend, the bridge and the database, and shuts Windows down (10 s delay, `shutdown /a` can still cancel it). It only fires inside a 15-minute window after the set time, so a PC that is switched on
 * later is never shut down by yesterday's schedule. Never runs on the central server (no coin machine there).
 * Setting `schedule.shutdown` = { enabled, days: [7 x { enabled, time: 'HH:MM' }] (index 0 = Sunday), skipDate } (the PC's own clock).
 * `enabled: false` (or no setting) is "always on", for shops that are open 24 hours; each day can also be left out.
 * The older shape { enabled, time } (the same time every day) still works.
 */
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import Setting from '../models/setting.js'
import AuditLog from '../models/auditLog.js'
import { broadcastHardwareEvent } from '../wsServer.js'

export const KEY = 'schedule.shutdown'
const WARN_MIN = 3
const WAIT_MAX_MIN = 10
const WINDOW_MIN = 15
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const state = { warnedFor: null, doneFor: null }
export function _reset() { state.warnedFor = null; state.doneFor = null }

/** One look at the clock. `deps` lets the tests replace the clock, the hardware state and the shutdown command. */
export async function tick(coin, deps = {}) {
  const now = deps.now ? deps.now() : new Date()
  const row = await Setting.findOne({ tenantId: coin.tenantId, key: KEY }).lean()
  const cfg = row && row.value
  if (!cfg || !cfg.enabled) return 'off' // always on
  const day = Array.isArray(cfg.days) && cfg.days.length === 7 ? cfg.days[now.getDay()] : { enabled: true, time: cfg.time }
  if (!day || !day.enabled || !/^\d{2}:\d{2}$/.test(String(day.time || ''))) return 'off'
  cfg.time = day.time // the time that applies today
  const today = ymd(now)
  if (cfg.skipDate === today) return 'skipped'
  const [h, m] = cfg.time.split(':').map(Number)
  const at = new Date(now); at.setHours(h, m, 0, 0)
  const minsToGo = (at.getTime() - now.getTime()) / 60000
  if (state.doneFor === today) return 'done'

  // inside the last 3 minutes the exact moment is sent every look (30 s), so a screen that reloads catches up
  if (minsToGo <= WARN_MIN && minsToGo > 0) {
    broadcastHardwareEvent(coin.tenantId, 'shutdown:warning', { at: cfg.time, shutdownAt: at.getTime(), minutes: Math.max(1, Math.ceil(minsToGo)) })
    state.warnedFor = today
    return 'warned'
  }
  if (minsToGo > 0 || minsToGo < -WINDOW_MIN) return 'waiting'

  // time is up (within the window)
  const credit = Number(coin.client?.getState?.().balance) || 0
  const late = -minsToGo
  if (credit > 0 && late < WAIT_MAX_MIN) return 'waiting-for-customer'
  state.doneFor = today
  // Credit still in the machine when it switches off is not left to be found (or lost) in the morning: it stays in the machine, is
  // written down as owed to the customer and the staff is e-mailed (the same rule as a payout nobody can confirm).
  if (credit > 0 && coin.holdCredit) await coin.holdCredit({ amount: credit, reason: 'shutdown', why: `o computador desligou-se à hora marcada (${cfg.time}) com ${credit.toFixed(2)} € de crédito por gastar` }).catch((e) => console.warn('[Shutdown] could not hold the credit:', e.message))
  try { await (deps.flush ? deps.flush() : Promise.race([coin.uplink?.flush?.(), new Promise((r) => setTimeout(r, 30000))])) } catch { /* the sales stay queued and go out after the next start */ }
  await AuditLog.create({ tenantId: coin.tenantId, actorUsername: 'system', action: 'system.shutdown', targetType: 'CashSession', targetId: '', details: { scheduledFor: cfg.time, creditLeft: credit } }).catch(() => {})
  console.log(`[Shutdown] scheduled shutdown at ${cfg.time}: closing the kiosk, stopping the programs and the database, then switching off`)
  if (deps.exec) await deps.exec()
  else if (process.platform === 'win32') {
    // A separate process: it stops this backend too, and has to keep going afterwards.
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'graceful-shutdown.ps1')
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } else console.log('[Shutdown] not Windows: nothing executed')
  return 'shutdown'
}

let timer = null
export function startShutdownScheduler(coin) {
  if (timer) return
  timer = setInterval(() => tick(coin).catch((e) => console.warn('[Shutdown]', e.message)), 30_000)
  timer.unref?.()
}

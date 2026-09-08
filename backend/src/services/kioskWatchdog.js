/**
 * Kiosk-offline watchdog — email the operator once a kiosk's `lastSeen`
 * (updated on every authenticated request, so it reflects the offline-first
 * sync engine's periodic pulls/pushes, not just a live websocket) goes stale.
 *
 * Alerts once per outage, not every check: `offlineAlertSent` is set the
 * moment an alert goes out and cleared the moment the kiosk looks healthy
 * again, so a kiosk down for hours doesn't flood the inbox.
 */
import User from '../models/user.js'
import { sendAlertForTenant } from './alerts.js'

const STALE_MS = 15 * 60 * 1000
const CHECK_INTERVAL_MS = 5 * 60 * 1000

let timer = null

async function checkOnce() {
  const kiosks = await User.find({ role: 'KIOSK' }).lean()
  for (const k of kiosks) {
    const staleMs = k.lastSeen ? Date.now() - new Date(k.lastSeen).getTime() : Infinity
    const isStale = staleMs > STALE_MS
    if (isStale && !k.offlineAlertSent) {
      await sendAlertForTenant(
        k.tenantId,
        'Quiosque offline',
        `O quiosque "${k.username}" não comunica com o servidor há mais de ${Math.round(STALE_MS / 60000)} minutos.`
      )
      await User.findByIdAndUpdate(k._id, { offlineAlertSent: true })
    } else if (!isStale && k.offlineAlertSent) {
      await User.findByIdAndUpdate(k._id, { offlineAlertSent: false })
    }
  }
}

export function start() {
  if (timer) return
  timer = setInterval(() => {
    checkOnce().catch((err) => console.error('[KioskWatchdog] check failed:', err.message))
  }, CHECK_INTERVAL_MS)
  if (timer.unref) timer.unref()
  console.log('[KioskWatchdog] started')
}

export function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

// Exported for tests — runs one check synchronously without waiting on the timer.
export { checkOnce }

export default { start, stop, checkOnce }

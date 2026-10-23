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
import { runAsLeader } from './leader.js'

// The shop asks the central server for work every few seconds, so two quiet minutes already means no internet
// (this is what makes the admin's Start/Stop fail). One e-mail per outage, one when it is back.
const STALE_MS = 2 * 60 * 1000
const CHECK_INTERVAL_MS = 30 * 1000

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
        `O quiosque "${k.username}" não comunica com o servidor há mais de ${Math.round(STALE_MS / 60000)} minutos (sem internet na loja?). Enquanto isso, o quiosque continua a funcionar com dinheiro e as vendas ficam guardadas para enviar quando a ligação voltar. O Iniciar/Parar do admin não chega à loja.`
      )
      await User.findByIdAndUpdate(k._id, { offlineAlertSent: true })
    } else if (!isStale && k.offlineAlertSent) {
      await User.findByIdAndUpdate(k._id, { offlineAlertSent: false })
      await sendAlertForTenant(k.tenantId, 'Quiosque online outra vez', `O quiosque "${k.username}" voltou a comunicar com o servidor.`)
    }
  }
}

export function start() {
  if (timer) return
  timer = setInterval(() => {
    runAsLeader('kiosk-watchdog', CHECK_INTERVAL_MS * 3, checkOnce).catch((err) => console.error('[KioskWatchdog] check failed:', err.message))
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

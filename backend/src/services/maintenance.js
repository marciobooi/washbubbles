/**
 * Turns a hardware fault into a persistent, resolvable ticket instead of
 * just an email that scrolls away. Sits alongside alerts.js — reportFault
 * still fires the existing operator email (sendAlertForTenant), it just
 * also leaves a queryable record with a dedupe guard so a flapping fault
 * doesn't spam a new ticket on every status packet.
 */
import MaintenanceTicket from '../models/maintenanceTicket.js'
import { sendAlertForTenant } from './alerts.js'

export async function reportFault(tenantId, machineId, description, faultCode = '') {
  try {
    if (!tenantId || !machineId) return
    const existing = await MaintenanceTicket.findOne({ tenantId, machineId, status: 'open' })
    if (!existing) {
      await MaintenanceTicket.create({ tenantId, machineId, source: 'auto_fault', description, faultCode })
    }
    await sendAlertForTenant(tenantId, `Avaria — ${description}`, description)
  } catch (err) {
    // A fault report failing to persist must never break the hardware event
    // handler that triggered it — same defensive shape as alerts.js.
    console.error('[Maintenance] Failed to report fault:', err.message)
  }
}

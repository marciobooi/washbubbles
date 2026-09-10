/**
 * Admin action audit trail. Same defensive shape as alerts.js's sendAlert:
 * fire-and-forget, never throws into the caller — a logging failure must
 * never turn a successful admin action into a failed request.
 */
import AuditLog from '../models/auditLog.js'

export async function logAction(req, action, targetType, targetId, details = null) {
  try {
    if (!req || !req.tenantId) return
    await AuditLog.create({
      tenantId: req.tenantId,
      actorId: req.userModel?._id || null,
      actorUsername: req.userModel?.username || '',
      action,
      targetType,
      targetId: targetId != null ? String(targetId) : '',
      details
    })
  } catch (err) {
    console.error('[AuditLog] Failed to write:', err.message)
  }
}

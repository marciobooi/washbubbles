/**
 * What this process does. The same code runs as one process doing everything (the default, and what every shop PC does) or,
 * on the central server, as separate processes by APP_ROLES (comma separated):
 *   web     the public site, the admin and the kiosk screens' API
 *   sync    what the shops' PCs talk to: /api/sync and /api/installer (so it can be scaled and deployed apart from the website)
 *   worker  the background jobs (kiosk-offline alerts, domain provisioning, MB WAY sweeps); they are leader-locked, so
 *           running several workers by mistake does not send anything twice
 */
const parse = () => new Set(String(process.env.APP_ROLES || 'web,sync,worker').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))
export const hasRole = (r) => parse().has(r)

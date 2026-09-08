/**
 * Offline-first API — talks to the kiosk's own local engine over IPC instead
 * of the network, when running inside the Electron shell.
 *
 * Deliberately narrow: the local engine (pos-engine.cjs) only replicates the
 * single-machine sale path, not the server's multi-item/recharge-bundling
 * gateway flow (see AUDIT-FINDINGS.md Round 8). Callers must fall back to the
 * remote API (services/api.js) for anything this module doesn't cover, and
 * should only spend local credit when the local session already holds enough
 * of it — a site with no physical coin acceptor wired to the embedded
 * hardware agent never has local credit at all, and must keep using the
 * network path exactly as before.
 */

const electron = typeof window !== 'undefined' ? window.electronAPI : null

export const isElectron = Boolean(electron)

/** The kiosk's current cash/card/bonus credit, held locally, independent of connectivity. */
export async function getSession() {
  if (!electron) return null
  return electron.getSession()
}

/** Settle a single-machine sale entirely against the local session — no network call. */
export async function processSale(machineId, amount, method, cardCode, batchId, items) {
  if (!electron) throw new Error('Local engine not available outside the kiosk app')
  return electron.processSale(machineId, amount, method, cardCode, batchId, items)
}

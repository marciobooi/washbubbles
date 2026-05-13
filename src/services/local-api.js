/**
 * WashBubbles Local API
 * When running in Electron, all operations go through IPC to local SQLite.
 * Falls back to remote HTTP API when not in Electron (dev/browser mode).
 */

/** Check if we're running inside Electron with offline-first support */
export const isElectron = () => !!(window.electronAPI?.isElectron && window.electronAPI?.pos)

// ─── POS Operations ───

export async function getMachines() {
  if (isElectron()) return window.electronAPI.pos.getMachines()
  const { getPublicMachines } = await import('./api.js')
  return getPublicMachines()
}

export async function getMachine(id) {
  if (isElectron()) return window.electronAPI.pos.getMachine(id)
  const { getMachine: remoteFn } = await import('./api.js')
  return remoteFn(id)
}

export async function getPrice(type, weight) {
  if (isElectron()) return window.electronAPI.pos.getPrice(type, weight)
  const { getPriceByTypeWeightPublic } = await import('./api.js')
  return getPriceByTypeWeightPublic(type, weight)
}

export async function getAllPrices() {
  if (isElectron()) return window.electronAPI.pos.getAllPrices()
  const { getPrices } = await import('./api.js')
  return getPrices()
}

export async function processSale(data) {
  if (isElectron()) return window.electronAPI.pos.processSale(data)
  // Fallback: use remote gateway
  const { gatewayCashPay } = await import('./api.js')
  return gatewayCashPay(data)
}

export async function adminStartMachine(machineId) {
  if (isElectron()) return window.electronAPI.pos.adminStart(machineId)
  const { activateMachine } = await import('./api.js')
  return activateMachine({ machineId })
}

export async function dispenseChange(amount) {
  if (isElectron()) return window.electronAPI.pos.dispenseChange(amount)
  return { success: false, error: 'Not available in browser mode' }
}

export async function printReceipt(content) {
  if (isElectron()) return window.electronAPI.pos.printReceipt(content)
  return false
}

// ─── Session ───

export async function getSession() {
  if (isElectron()) return window.electronAPI.pos.getSession()
  return { cashBalance: 0, cardCode: null, cardBalance: 0, hasCard: false, bonus: 0, credits: 0 }
}

export async function resetSession() {
  if (isElectron()) return window.electronAPI.pos.resetSession()
  return { success: true }
}

// ─── Card Operations ───

export async function getCard(code) {
  if (isElectron()) return window.electronAPI.card.get(code)
  const { gatewayGetCard } = await import('./api.js')
  return gatewayGetCard(code)
}

export async function getCardHistory(code) {
  if (isElectron()) return window.electronAPI.card.getHistory(code)
  const { api } = await import('./api.js')
  return api.request(`/pos/cards/${encodeURIComponent(code)}/history`, { method: 'GET', expect: 'json', skipAuth: true })
}

export async function topUpCard(code, amount) {
  if (isElectron()) return window.electronAPI.card.topUp(code, amount)
  const { gatewayTopupCard } = await import('./api.js')
  return gatewayTopupCard(code, { amount })
}

export async function removeCard() {
  if (isElectron()) return window.electronAPI.card.remove()
  return { success: true }
}

// ─── Transactions ───

export async function getTransactions(limit = 100) {
  if (isElectron()) return window.electronAPI.pos.getTransactions(limit)
  const { getTransactions: remoteFn } = await import('./api.js')
  return remoteFn()
}

// ─── Settings ───

export async function getSetting(key) {
  if (isElectron()) return window.electronAPI.pos.getSetting(key)
  const { getPublicSetting } = await import('./api.js')
  return getPublicSetting(key)
}

export async function getAllSettings() {
  if (isElectron()) return window.electronAPI.pos.getAllSettings()
  const { getSettings } = await import('./api.js')
  return getSettings()
}

// ─── Sync ───

export async function getSyncStatus() {
  if (isElectron()) return window.electronAPI.sync.getStatus()
  return { online: true, syncing: false, pendingCount: 0 }
}

export async function forceSync() {
  if (isElectron()) return window.electronAPI.sync.forceSync()
  return { success: true }
}

export async function triggerBootstrap() {
  if (isElectron()) return window.electronAPI.sync.bootstrap()
  return { success: false, error: 'Not in Electron mode' }
}

// ─── Hardware ───

export async function getHardwareStatus() {
  if (isElectron()) return window.electronAPI.hw.getStatus()
  return { running: false, peripherals: {} }
}

export async function reconnectHardware() {
  if (isElectron()) return window.electronAPI.hw.reconnect()
  return { success: false }
}

// ─── Event Subscription ───

/**
 * Subscribe to real-time events from the main process.
 * Returns an unsubscribe function.
 *
 * Example:
 *   const unsub = onEvent('pos:credit-accepted', (data) => { ... })
 *   // later: unsub()
 */
export function onEvent(channel, callback) {
  if (isElectron()) {
    return window.electronAPI.on(channel, callback)
  }
  // In browser mode, no-op
  return () => {}
}

/**
 * Subscribe to multiple events at once. Returns a single cleanup function.
 */
export function onEvents(channelMap) {
  const unsubs = Object.entries(channelMap).map(([channel, cb]) => onEvent(channel, cb))
  return () => unsubs.forEach(fn => fn())
}

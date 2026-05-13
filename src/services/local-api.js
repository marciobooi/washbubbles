/**
 * WashBubbles Local API Wrapper
 * When running in Electron, all operations go through IPC to local SQLite.
 * Falls back to remote HTTP API when not in Electron (dev/browser mode).
 * 
 * This file aligns the Frontend (React) with the Electron Preload API.
 */

export const isElectron = () => !!(window.electronAPI)

// ─── POS Operations ───

export async function getMachines() {
  if (isElectron()) return window.electronAPI.getMachines()
  const { getPublicMachines } = await import('./api.js')
  return getPublicMachines()
}

export async function getMachine(id) {
  if (isElectron()) return window.electronAPI.getMachine(id)
  const { getMachine: remoteFn } = await import('./api.js')
  return remoteFn(id)
}

export async function getPrice(type, weight) {
  if (isElectron()) return window.electronAPI.getPrice(type, weight)
  const { getPriceByTypeWeightPublic } = await import('./api.js')
  return getPriceByTypeWeightPublic(type, weight)
}

export async function getAllPrices() {
  if (isElectron()) return window.electronAPI.getSettings() // Prices are often in settings or handled via getPrice
  const { getPrices } = await import('./api.js')
  return getPrices()
}

export async function processSale(machineId, amount, method, cardCode, batchId, items) {
  if (isElectron()) return window.electronAPI.processSale(machineId, amount, method, cardCode, batchId, items)
  const { gatewayCashPay } = await import('./api.js')
  return gatewayCashPay({ machineId, amount, method, cardCode, batchId, items })
}

export async function adminStartMachine(machineId) {
  if (isElectron()) return window.electronAPI.adminStartMachine(machineId)
  const { activateMachine } = await import('./api.js')
  return activateMachine({ machineId })
}

export async function performDayClose(notes) {
  if (isElectron()) return window.electronAPI.performDayClose(notes)
  return { success: false, error: 'Not available in browser mode' }
}

// ─── Card Operations ───

export async function getCard(code) {
  if (isElectron()) return window.electronAPI.getCard(code)
  const { gatewayGetCard } = await import('./api.js')
  return gatewayGetCard(code)
}

export async function getCardHistory(code) {
  if (isElectron()) return window.electronAPI.getCardHistory(code)
  const { api } = await import('./api.js')
  return api.request(`/pos/cards/${encodeURIComponent(code)}/history`, { method: 'GET', expect: 'json', skipAuth: true })
}

export async function topUpCard(code, amount) {
  if (isElectron()) return window.electronAPI.topUpCard(code, amount)
  const { gatewayTopupCard } = await import('./api.js')
  return gatewayTopupCard(code, { amount })
}

export async function removeCard() {
  if (isElectron()) return window.electronAPI.removeCard()
  return { success: true }
}

// ─── Session ───

export async function getSession() {
  if (isElectron()) return window.electronAPI.getSession()
  return { cashBalance: 0, cardCode: null, cardBalance: 0, hasCard: false, bonus: 0, credits: 0 }
}

export async function resetSession() {
  if (isElectron()) return window.electronAPI.resetSession()
  return { success: true }
}

// ─── Status & Health ───

export async function getSyncStatus() {
  if (isElectron()) return window.electronAPI.getSyncStatus()
  return { online: true, syncing: false, pendingCount: 0 }
}

export async function getHardwareStatus() {
  if (isElectron()) return window.electronAPI.getHardwareStatus()
  return { running: false, peripherals: {} }
}

export async function forceSync() {
  if (isElectron()) return window.electronAPI.forceSync()
  return { success: true }
}

// ─── Event Subscriptions ───

/**
 * Event subscription helpers for React components.
 * Usage: useEffect(() => { return subscribeToEvents({ onCardLoaded: (c) => ... }) }, [])
 */
export function subscribeToEvents(handlers) {
  if (!isElectron()) return () => {}

  // Map of handler names to preload API subscription functions
  const subscriptionMap = {
    onSessionUpdate: window.electronAPI.onSessionUpdate,
    onCardLoaded: window.electronAPI.onCardLoaded,
    onCardUnknown: window.electronAPI.onCardUnknown,
    onCardRemoved: window.electronAPI.onCardRemoved,
    onCreditAccepted: window.electronAPI.onCreditAccepted,
    onSaleCompleted: window.electronAPI.onSaleCompleted,
    onSyncStatusChanged: window.electronAPI.onSyncStatusChanged,
    onHardwareRfidDetected: window.electronAPI.onHardwareRfidDetected,
    onHardwareCreditReceived: window.electronAPI.onHardwareCreditReceived,
    onHardwareError: window.electronAPI.onHardwareError,
    onHardwareReconnected: window.electronAPI.onHardwareReconnected,
  }

  const cleanups = []
  
  for (const [key, handler] of Object.entries(handlers)) {
    if (subscriptionMap[key]) {
      const unsub = subscriptionMap[key](handler)
      // Note: In our current preload.cjs, ipcRenderer.on doesn't return an unsub function.
      // We'd need to modify preload.cjs to return a cleanup function.
    }
  }

  // Temporary cleanup — since Electron 28+ requires removing listeners properly
  return () => {
    // ipcRenderer.removeAllListeners(...) but that's not exposed for security.
    // The current preload.cjs is simplified.
  }
}

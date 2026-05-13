/**
 * WashBubbles IPC Handlers
 * Bridges Electron main process (DB, hardware, POS engine, sync) to renderer via IPC
 */
const { ipcMain } = require('electron')

let posEngine = null
let syncEngine = null
let hardwareAgent = null

function registerIpcHandlers(engine, sync, hw) {
  posEngine = engine
  syncEngine = sync
  hardwareAgent = hw

  // ─── POS Operations ───

  ipcMain.handle('pos:getMachines', () => {
    return posEngine.getMachines()
  })

  ipcMain.handle('pos:getMachine', (_, id) => {
    return posEngine.getMachine(id)
  })

  ipcMain.handle('pos:getPrice', (_, type, weight) => {
    return posEngine.getPrice(type, weight)
  })

  ipcMain.handle('pos:getAllPrices', () => {
    return posEngine.getAllPrices()
  })

  ipcMain.handle('pos:processSale', (_, { machineId, amount, method, cardCode, batchId, items }) => {
    try {
      return posEngine.processSale(machineId, amount, method, cardCode, batchId, items)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('pos:adminStart', (_, machineId) => {
    try {
      return posEngine.adminStartMachine(machineId)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('pos:dispenseChange', (_, amount) => {
    return posEngine.dispenseChange(amount)
  })

  ipcMain.handle('pos:printReceipt', (_, content) => {
    return posEngine.printReceipt(content)
  })

  // ─── Session ───

  ipcMain.handle('pos:getSession', () => {
    return posEngine.getSession()
  })

  ipcMain.handle('pos:resetSession', () => {
    posEngine.resetSession()
    return { success: true }
  })

  // ─── Card Operations ───

  ipcMain.handle('pos:getCard', (_, code) => {
    return posEngine.getCard(code)
  })

  ipcMain.handle('pos:getCardHistory', (_, code) => {
    return posEngine.getCardHistory(code)
  })

  ipcMain.handle('pos:topUpCard', (_, code, amount) => {
    try {
      return posEngine.topUpCard(code, amount)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('pos:removeCard', () => {
    posEngine.removeCard()
    return { success: true }
  })

  // ─── Transactions ───

  ipcMain.handle('pos:getTransactions', (_, limit) => {
    return posEngine.getTransactions(limit)
  })

  // ─── Settings ───

  ipcMain.handle('pos:getSetting', (_, key) => {
    return posEngine.getSetting(key)
  })

  ipcMain.handle('pos:getAllSettings', () => {
    return posEngine.getAllSettings()
  })

  // ─── Sync ───

  ipcMain.handle('sync:getStatus', () => {
    return syncEngine ? syncEngine.getStatus() : { online: false, syncing: false, pendingCount: 0 }
  })

  ipcMain.handle('sync:forceSync', async () => {
    if (!syncEngine) return { success: false, error: 'Sync engine not initialized' }
    return await syncEngine.forceSync()
  })

  ipcMain.handle('sync:bootstrap', async () => {
    if (!syncEngine) return { success: false, error: 'Sync engine not initialized' }
    return await syncEngine.bootstrap()
  })

  // ─── Hardware ───

  ipcMain.handle('hw:getStatus', () => {
    return hardwareAgent ? hardwareAgent.getStatus() : { running: false, peripherals: {} }
  })

  ipcMain.handle('hw:reconnect', async () => {
    if (!hardwareAgent) return { success: false }
    await hardwareAgent.stop()
    await hardwareAgent.start()
    return { success: true }
  })

  console.log('[IPC] All handlers registered')
}

/** Forward POS/hardware events to renderer windows */
function setupEventForwarding(engine, sync, hw, getMainWindow) {

  const forward = (channel, data) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }

  // POS events → renderer
  if (engine) {
    engine.on('session:updated', (data) => forward('pos:session-updated', data))
    engine.on('credit:accepted', (data) => forward('pos:credit-accepted', data))
    engine.on('credit:rejected', (data) => forward('pos:credit-rejected', data))
    engine.on('credit:fraud', (data) => forward('pos:credit-fraud', data))
    engine.on('card:loaded', (data) => forward('pos:card-loaded', data))
    engine.on('card:unknown', (data) => forward('pos:card-unknown', data))
    engine.on('card:removed', () => forward('pos:card-removed', {}))
    engine.on('sale:completed', (data) => forward('pos:sale-completed', data))
    engine.on('machine:activated', (data) => forward('pos:machine-activated', data))
    engine.on('machine:activation_failed', (data) => forward('pos:machine-activation-failed', data))
    engine.on('hopper:dispensed', (data) => forward('pos:hopper-dispensed', data))
    engine.on('hopper:empty', (data) => forward('pos:hopper-empty', data))
    engine.on('hopper:fault', (data) => forward('pos:hopper-fault', data))
    engine.on('interface:status', (data) => forward('pos:interface-status', data))
  }

  // Sync events → renderer
  if (sync) {
    sync.on('online', () => forward('sync:online', {}))
    sync.on('offline', () => forward('sync:offline', {}))
    sync.on('sync:pushed', (data) => forward('sync:pushed', data))
    sync.on('sync:pulled', (data) => forward('sync:pulled', data))
    sync.on('bootstrap:start', () => forward('sync:bootstrap-start', {}))
    sync.on('bootstrap:progress', (data) => forward('sync:bootstrap-progress', data))
    sync.on('bootstrap:complete', () => forward('sync:bootstrap-complete', {}))
    sync.on('bootstrap:failed', (data) => forward('sync:bootstrap-failed', data))
  }
}

module.exports = { registerIpcHandlers, setupEventForwarding }

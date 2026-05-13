/**
 * WashBubbles IPC Handlers
 * Bridges the Electron main process with the React renderer
 */
const { ipcMain } = require('electron')

function registerIpcHandlers(posEngine, syncEngine, hardwareAgent) {
  // ─── POS Engine ───
  ipcMain.handle('pos:getMachines', () => posEngine.getMachines())
  ipcMain.handle('pos:getMachine', (e, id) => posEngine.getMachine(id))
  ipcMain.handle('pos:getPrice', (e, type, weight) => posEngine.getPrice(type, weight))
  ipcMain.handle('pos:processSale', (e, ...args) => posEngine.processSale(...args))
  ipcMain.handle('pos:getSession', () => posEngine.getSession())
  ipcMain.handle('pos:resetSession', () => posEngine.resetSession())
  ipcMain.handle('pos:getTransactions', (e, limit) => posEngine.getTransactions(limit))
  ipcMain.handle('pos:getSettings', () => posEngine.getAllSettings())
  ipcMain.handle('pos:performDayClose', (e, notes) => posEngine.performDayClose(notes))

  // ─── Card Operations ───
  ipcMain.handle('card:get', (e, code) => posEngine.getCard(code))
  ipcMain.handle('card:getHistory', (e, code) => posEngine.getCardHistory(code))
  ipcMain.handle('card:topUp', (e, code, amount) => posEngine.topUpCard(code, amount))
  ipcMain.handle('card:remove', () => posEngine.removeCard())

  // ─── Sync Engine ───
  ipcMain.handle('sync:getStatus', () => syncEngine.getStatus())
  ipcMain.handle('sync:forceSync', () => syncEngine.forceSync())

  // ─── Hardware Agent ───
  ipcMain.handle('hw:getStatus', () => hardwareAgent.getStatus())
  ipcMain.handle('hw:dispenseChange', (e, amount) => posEngine.dispenseChange(amount))
  ipcMain.handle('hw:printReceipt', (e, content) => posEngine.printReceipt(content))
  ipcMain.handle('hw:adminStartMachine', (e, id) => posEngine.adminStartMachine(id))
}

function setupEventForwarding(posEngine, syncEngine, hardwareAgent, getWindow) {
  const forward = (channel, data) => {
    const win = getWindow()
    if (win) win.webContents.send(channel, data)
  }

  // POS events
  posEngine.on('session:updated', (session) => forward('pos:session-updated', session))
  posEngine.on('card:loaded', (data) => forward('card:loaded', data))
  posEngine.on('card:unknown', (data) => forward('card:unknown', data))
  posEngine.on('card:removed', () => forward('card:removed'))
  posEngine.on('credit:accepted', (data) => forward('pos:credit-accepted', data))
  posEngine.on('sale:completed', (data) => forward('pos:sale-completed', data))
  posEngine.on('machine:activated', (data) => forward('pos:machine-activated', data))

  // Sync events
  syncEngine.on('online', () => forward('sync:status-changed', { online: true }))
  syncEngine.on('offline', () => forward('sync:status-changed', { online: false }))
  syncEngine.on('sync:pushed', (data) => forward('sync:pushed', data))
  syncEngine.on('sync:pulled', (data) => forward('sync:pulled', data))

  // Hardware events
  hardwareAgent.on('rfid:card_detected', (data) => forward('hw:rfid-detected', data))
  hardwareAgent.on('credit', (data) => forward('hw:credit-received', data))
  hardwareAgent.on('hardware:error', (data) => forward('hw:error', data))
  hardwareAgent.on('hardware:reconnected', (data) => forward('hw:reconnected', data))
}

module.exports = { registerIpcHandlers, setupEventForwarding }

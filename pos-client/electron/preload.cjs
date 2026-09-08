const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // POS Engine
  getMachines: () => ipcRenderer.invoke('pos:getMachines'),
  getMachine: (id) => ipcRenderer.invoke('pos:getMachine', id),
  getPrice: (type, weight) => ipcRenderer.invoke('pos:getPrice', type, weight),
  processSale: (machineId, amount, method, cardCode, batchId, items) => 
    ipcRenderer.invoke('pos:processSale', machineId, amount, method, cardCode, batchId, items),
  getSession: () => ipcRenderer.invoke('pos:getSession'),
  resetSession: () => ipcRenderer.invoke('pos:resetSession'),
  getTransactions: (limit) => ipcRenderer.invoke('pos:getTransactions', limit),
  getSettings: () => ipcRenderer.invoke('pos:getSettings'),
  performDayClose: (notes) => ipcRenderer.invoke('pos:performDayClose', notes),
  issueWifiVoucher: (batchId) => ipcRenderer.invoke('wifi:issueVoucher', batchId),

  // Card Operations
  getCard: (code) => ipcRenderer.invoke('card:get', code),
  getCardHistory: (code) => ipcRenderer.invoke('card:getHistory', code),
  topUpCard: (code, amount) => ipcRenderer.invoke('card:topUp', code, amount),
  removeCard: () => ipcRenderer.invoke('card:remove'),

  // Sync Engine
  getSyncStatus: () => ipcRenderer.invoke('sync:getStatus'),
  forceSync: () => ipcRenderer.invoke('sync:forceSync'),

  // Hardware Agent
  getHardwareStatus: () => ipcRenderer.invoke('hw:getStatus'),
  dispenseChange: (amount) => ipcRenderer.invoke('hw:dispenseChange', amount),
  printReceipt: (content) => ipcRenderer.invoke('hw:printReceipt', content),
  // Requires the operator's admin PIN — this starts a machine without payment.
  adminStartMachine: (id, adminPin) => ipcRenderer.invoke('hw:adminStartMachine', id, adminPin),

  // Virtual Keyboard
  showKeyboard: () => ipcRenderer.send('show-keyboard'),
  hideKeyboard: () => ipcRenderer.send('hide-keyboard'),

  // Event Listeners
  onSessionUpdate: (callback) => ipcRenderer.on('pos:session-updated', (event, value) => callback(value)),
  onCardLoaded: (callback) => ipcRenderer.on('card:loaded', (event, value) => callback(value)),
  onCardUnknown: (callback) => ipcRenderer.on('card:unknown', (event, value) => callback(value)),
  onCardBlocked: (callback) => ipcRenderer.on('card:blocked', (event, value) => callback(value)),
  onCardRemoved: (callback) => ipcRenderer.on('card:removed', (event) => callback()),
  onCreditAccepted: (callback) => ipcRenderer.on('pos:credit-accepted', (event, value) => callback(value)),
  onSaleCompleted: (callback) => ipcRenderer.on('pos:sale-completed', (event, value) => callback(value)),
  onSyncStatusChanged: (callback) => ipcRenderer.on('sync:status-changed', (event, value) => callback(value)),
  onHardwareRfidDetected: (callback) => ipcRenderer.on('hw:rfid-detected', (event, value) => callback(value)),
  onHardwareCreditReceived: (callback) => ipcRenderer.on('hw:credit-received', (event, value) => callback(value)),
  onHardwareError: (callback) => ipcRenderer.on('hw:error', (event, value) => callback(value)),
  onHardwareReconnected: (callback) => ipcRenderer.on('hw:reconnected', (event, value) => callback(value)),
})

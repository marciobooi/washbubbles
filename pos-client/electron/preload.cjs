const { contextBridge, ipcRenderer } = require('electron')

// Expose comprehensive API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: () => process.platform,
  kioskKey: () => process.env.ELECTRON_KIOSK_API_KEY || null,
  isElectron: true,

  // Virtual keyboard
  showKeyboard: () => ipcRenderer.send('show-keyboard'),
  hideKeyboard: () => ipcRenderer.send('hide-keyboard'),

  // ─── POS Operations ───
  pos: {
    getMachines: () => ipcRenderer.invoke('pos:getMachines'),
    getMachine: (id) => ipcRenderer.invoke('pos:getMachine', id),
    getPrice: (type, weight) => ipcRenderer.invoke('pos:getPrice', type, weight),
    getAllPrices: () => ipcRenderer.invoke('pos:getAllPrices'),
    processSale: (data) => ipcRenderer.invoke('pos:processSale', data),
    adminStart: (machineId) => ipcRenderer.invoke('pos:adminStart', machineId),
    dispenseChange: (amount) => ipcRenderer.invoke('pos:dispenseChange', amount),
    printReceipt: (content) => ipcRenderer.invoke('pos:printReceipt', content),
    getSession: () => ipcRenderer.invoke('pos:getSession'),
    resetSession: () => ipcRenderer.invoke('pos:resetSession'),
    getTransactions: (limit) => ipcRenderer.invoke('pos:getTransactions', limit),
    getSetting: (key) => ipcRenderer.invoke('pos:getSetting', key),
    getAllSettings: () => ipcRenderer.invoke('pos:getAllSettings'),
  },

  // ─── Card Operations ───
  card: {
    get: (code) => ipcRenderer.invoke('pos:getCard', code),
    getHistory: (code) => ipcRenderer.invoke('pos:getCardHistory', code),
    topUp: (code, amount) => ipcRenderer.invoke('pos:topUpCard', code, amount),
    remove: () => ipcRenderer.invoke('pos:removeCard'),
  },

  // ─── Sync ───
  sync: {
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    forceSync: () => ipcRenderer.invoke('sync:forceSync'),
    bootstrap: () => ipcRenderer.invoke('sync:bootstrap'),
  },

  // ─── Hardware ───
  hw: {
    getStatus: () => ipcRenderer.invoke('hw:getStatus'),
    reconnect: () => ipcRenderer.invoke('hw:reconnect'),
  },

  // ─── Event Listeners (main → renderer) ───
  on: (channel, callback) => {
    const validChannels = [
      // POS events
      'pos:session-updated', 'pos:credit-accepted', 'pos:credit-rejected', 'pos:credit-fraud',
      'pos:card-loaded', 'pos:card-unknown', 'pos:card-removed',
      'pos:sale-completed', 'pos:machine-activated', 'pos:machine-activation-failed',
      'pos:hopper-dispensed', 'pos:hopper-empty', 'pos:hopper-fault',
      'pos:interface-status',
      // Sync events
      'sync:online', 'sync:offline', 'sync:pushed', 'sync:pulled',
      'sync:bootstrap-start', 'sync:bootstrap-progress', 'sync:bootstrap-complete', 'sync:bootstrap-failed',
    ]
    if (validChannels.includes(channel)) {
      const listener = (_, data) => callback(data)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
    return () => {}
  },

  // Remove all listeners for a channel
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  }
})

console.log('[Preload] electronAPI exposed with POS, Card, Sync, and HW modules')

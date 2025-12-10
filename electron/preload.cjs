const { contextBridge } = require('electron')

// Expose a simple API if needed later
contextBridge.exposeInMainWorld('electronAPI', {
  platform: () => process.platform,
})

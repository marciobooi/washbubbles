const { contextBridge } = require('electron')

// Expose API key and platform to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: () => process.platform,
  kioskKey: () => process.env.POS_KIOSK_API_KEY || null,
})

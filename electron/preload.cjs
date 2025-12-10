const { contextBridge } = require('electron')

// Expose a simple API for kiosk key and platform
contextBridge.exposeInMainWorld('electronAPI', {
  platform: () => process.platform,
  kioskKey: () => process.env.ELECTRON_KIOSK_API_KEY || null,
})

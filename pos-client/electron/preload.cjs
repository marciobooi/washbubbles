const { contextBridge, ipcRenderer } = require('electron')

// Expose API key, platform, and virtual keyboard controls to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: () => process.platform,
  kioskKey: () => process.env.ELECTRON_KIOSK_API_KEY || null,
  showKeyboard: function() {
    console.log('showKeyboard called from renderer')
    ipcRenderer.send('show-keyboard')
  },
  hideKeyboard: function() {
    console.log('hideKeyboard called from renderer')
    ipcRenderer.send('hide-keyboard')
  }
})

console.log('Preload script loaded, electronAPI exposed')

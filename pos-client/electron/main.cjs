const { app, BrowserWindow } = require('electron')
const path = require('path')

// Disable security warnings in development
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

// ========================================
// CONFIGURATION - Edit these values!
// ========================================
const SERVER_URL = 'http://localhost:5173'  // Change to your server URL
const KIOSK_API_KEY = 'b6f3c9a1d4e78b2f90c3a4d6e1f2b3c4d5e6f7890a1b2c3d'
// ========================================

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    // Kiosk mode settings (uncomment for production)
    // kiosk: true,
    // fullscreen: true,
    // autoHideMenuBar: true,
  })

  console.log(`Loading POS from: ${SERVER_URL}`)
  mainWindow.loadURL(SERVER_URL)

  // Open DevTools in development
  if (SERVER_URL.includes('localhost')) {
    mainWindow.webContents.openDevTools()
  }
}

// Expose API key to preload
process.env.ELECTRON_KIOSK_API_KEY = KIOSK_API_KEY

app.on('ready', createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

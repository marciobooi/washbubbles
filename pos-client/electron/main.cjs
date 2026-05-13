/**
 * WashBubbles POS — Electron Main Process
 * Offline-first architecture: local DB, embedded hardware agent, sync engine
 */
const { app, BrowserWindow, ipcMain, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

// Disable security warnings in development
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

// ========================================
// CONFIGURATION
// ========================================
const SERVER_URL = process.env.ELECTRON_START_URL || 'http://localhost:5173'
const KIOSK_API_KEY = process.env.ELECTRON_KIOSK_API_KEY || ''
const API_BASE = process.env.ELECTRON_API_BASE || 'http://localhost:3000/api'
const TENANT_ID = process.env.ELECTRON_TENANT_ID || ''
const ENABLE_VIRTUAL_KEYBOARD = true
const IS_KIOSK = process.env.ELECTRON_IS_KIOSK === 'true' // Toggle via env var
// ========================================

function validateConfig() {
  const missing = []
  if (!TENANT_ID) missing.push('ELECTRON_TENANT_ID')
  if (!KIOSK_API_KEY) missing.push('ELECTRON_KIOSK_API_KEY')
  if (missing.length > 0) {
    console.error(`[Main] CRITICAL ERROR: Missing env vars: ${missing.join(', ')}`)
    return false
  }
  return true
}

let mainWindow = null
let oskProcess = null
let posEngine = null
let syncEngine = null
let hardwareAgent = null
let isQuitting = false

function loadHardwareConfig() {
  const configPath = path.join(__dirname, '..', 'config.json')
  if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  return { peripherals: {} }
}

async function initOfflineSystems() {
  console.log('[Main] Initializing offline-first systems...')
  const { initDatabase } = require('./database.cjs')
  await initDatabase()
  
  const { EmbeddedHardwareAgent } = require('./hardware-agent.cjs')
  hardwareAgent = new EmbeddedHardwareAgent(loadHardwareConfig())
  await hardwareAgent.start()

  const { PosEngine } = require('./pos-engine.cjs')
  posEngine = new PosEngine(hardwareAgent, TENANT_ID)
  posEngine.init()

  const { SyncEngine } = require('./sync-engine.cjs')
  syncEngine = new SyncEngine({ serverUrl: API_BASE, apiKey: KIOSK_API_KEY }, TENANT_ID)
  syncEngine.start()

  const { registerIpcHandlers, setupEventForwarding } = require('./ipc-handlers.cjs')
  registerIpcHandlers(posEngine, syncEngine, hardwareAgent)
  setupEventForwarding(posEngine, syncEngine, hardwareAgent, () => mainWindow)

  const { machines } = require('./database.cjs')
  if (machines.getAll(TENANT_ID).length === 0) {
    syncEngine.bootstrap().catch(err => console.warn('[Main] Bootstrap failed:', err.message))
  }
  console.log('[Main] All systems ready!')
}

function showVirtualKeyboard() {
  if (!ENABLE_VIRTUAL_KEYBOARD) return
  if (process.platform === 'win32') { try { oskProcess = spawn('osk.exe') } catch (e) {} }
  else if (process.platform === 'linux') { try { oskProcess = spawn('onboard') } catch (e) {} }
}

function hideVirtualKeyboard() {
  if (oskProcess) {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/IM', 'osk.exe', '/F'])
      else oskProcess.kill()
      oskProcess = null
    } catch (e) {}
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width: IS_KIOSK ? width : 1280,
    height: IS_KIOSK ? height : 820,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    // Kiosk lockdown settings
    kiosk: IS_KIOSK,
    alwaysOnTop: IS_KIOSK,
    fullscreen: IS_KIOSK,
    frame: !IS_KIOSK,
    autoHideMenuBar: true,
  })

  // Prevent user from closing the window in Kiosk mode
  if (IS_KIOSK) {
    mainWindow.on('close', (e) => {
      if (!isQuitting) e.preventDefault()
    })
  }

  mainWindow.loadURL(SERVER_URL)

  mainWindow.webContents.on('did-finish-load', () => {
    if (ENABLE_VIRTUAL_KEYBOARD) {
      mainWindow.webContents.executeJavaScript(`
        document.addEventListener('focusin', (e) => { if (e.target.matches('input, textarea')) window.electronAPI?.showKeyboard(); });
        document.addEventListener('focusout', (e) => { if (e.target.matches('input, textarea')) setTimeout(() => { if (!document.activeElement.matches('input, textarea')) window.electronAPI?.hideKeyboard(); }, 200); });
      `)
    }
  })

  if (!IS_KIOSK && SERVER_URL.includes('localhost')) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

app.on('ready', async () => {
  validateConfig()
  try { await initOfflineSystems() } catch (err) { console.error('[Main] Init failed:', err) }
  createWindow()
})

app.on('window-all-closed', () => {
  hideVirtualKeyboard()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true
  hideVirtualKeyboard()
  const cleanup = async () => {
    if (syncEngine) syncEngine.stop()
    if (hardwareAgent) await hardwareAgent.stop()
    const { closeDatabase } = require('./database.cjs')
    closeDatabase()
    app.quit()
  }
  cleanup().catch(() => app.exit(1))
})

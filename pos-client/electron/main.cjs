/**
 * WashBubbles POS — Electron Main Process
 * Offline-first architecture: local DB, embedded hardware agent, sync engine
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

// Disable security warnings in development
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

// ========================================
// CONFIGURATION
// ========================================
const SERVER_URL = process.env.ELECTRON_START_URL || 'http://localhost:5173'
const KIOSK_API_KEY = process.env.ELECTRON_KIOSK_API_KEY || 'b6f3c9a1d4e78b2f90c3a4d6e1f2b3c4d5e6f7890a1b2c3d'
const API_BASE = process.env.ELECTRON_API_BASE || 'http://localhost:3000/api'
const TENANT_ID = process.env.ELECTRON_TENANT_ID || ''
const ENABLE_VIRTUAL_KEYBOARD = true
// ========================================

let mainWindow = null
let oskProcess = null
let posEngine = null
let syncEngine = null
let hardwareAgent = null

// ─── Load hardware config ───
function loadHardwareConfig() {
  const configPath = path.join(__dirname, '..', 'config.json')
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  }
  return { peripherals: {} }
}

// ─── Initialize offline-first systems ───
async function initOfflineSystems() {
  console.log('[Main] Initializing offline-first systems...')

  // Phase 1: Initialize local database
  const { initDatabase } = require('./database.cjs')
  initDatabase()
  console.log('[Main] Local database ready')

  // Phase 2: Start embedded hardware agent
  const { EmbeddedHardwareAgent } = require('./hardware-agent.cjs')
  const hwConfig = loadHardwareConfig()
  hardwareAgent = new EmbeddedHardwareAgent(hwConfig)
  await hardwareAgent.start()
  console.log('[Main] Hardware agent ready')

  // Phase 3: Initialize POS engine
  const { PosEngine } = require('./pos-engine.cjs')
  posEngine = new PosEngine(hardwareAgent, TENANT_ID)
  posEngine.init()
  console.log('[Main] POS engine ready')

  // Phase 4: Start sync engine
  const { SyncEngine } = require('./sync-engine.cjs')
  syncEngine = new SyncEngine({
    serverUrl: API_BASE,
    apiKey: KIOSK_API_KEY
  }, TENANT_ID)
  syncEngine.start()
  console.log('[Main] Sync engine ready')

  // Register IPC handlers (Phase 5: bridge to renderer)
  const { registerIpcHandlers, setupEventForwarding } = require('./ipc-handlers.cjs')
  registerIpcHandlers(posEngine, syncEngine, hardwareAgent)
  setupEventForwarding(posEngine, syncEngine, hardwareAgent, () => mainWindow)

  // Phase 6: Check if bootstrap is needed
  const { machines } = require('./database.cjs')
  const existingMachines = machines.getAll(TENANT_ID)
  if (existingMachines.length === 0 && TENANT_ID) {
    console.log('[Main] No local data — triggering bootstrap...')
    syncEngine.bootstrap().catch(err => {
      console.warn('[Main] Bootstrap failed (will retry later):', err.message)
    })
  }

  console.log('[Main] All offline-first systems initialized!')
}

// ─── Virtual Keyboard ───
function showVirtualKeyboard() {
  if (!ENABLE_VIRTUAL_KEYBOARD) return
  if (process.platform === 'win32') {
    try { oskProcess = spawn('osk.exe') } catch (e) { /* ignore */ }
  } else if (process.platform === 'linux') {
    try { oskProcess = spawn('onboard') } catch (e) { /* ignore */ }
  }
}

function hideVirtualKeyboard() {
  if (oskProcess) {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/IM', 'osk.exe', '/F'])
      else oskProcess.kill()
      oskProcess = null
    } catch (e) { /* ignore */ }
  }
}

// ─── Window Creation ───
function createWindow() {
  mainWindow = new BrowserWindow({
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

  console.log(`[Main] Loading POS from: ${SERVER_URL}`)
  mainWindow.loadURL(SERVER_URL)

  // Inject virtual keyboard handlers
  mainWindow.webContents.on('did-finish-load', () => {
    if (ENABLE_VIRTUAL_KEYBOARD) {
      mainWindow.webContents.executeJavaScript(`
        document.addEventListener('focusin', (e) => {
          if (e.target.matches('input, textarea')) window.electronAPI?.showKeyboard();
        });
        document.addEventListener('focusout', (e) => {
          if (e.target.matches('input, textarea')) {
            setTimeout(() => {
              if (!document.activeElement.matches('input, textarea')) window.electronAPI?.hideKeyboard();
            }, 200);
          }
        });
      `)
    }
  })

  // Open DevTools in development
  if (SERVER_URL.includes('localhost')) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

// ─── Keyboard IPC ───
ipcMain.on('show-keyboard', () => showVirtualKeyboard())
ipcMain.on('hide-keyboard', () => hideVirtualKeyboard())

// ─── App Lifecycle ───
app.on('ready', async () => {
  try {
    await initOfflineSystems()
  } catch (err) {
    console.error('[Main] Failed to init offline systems:', err)
    // Continue anyway — UI should still load
  }
  createWindow()
})

app.on('window-all-closed', () => {
  hideVirtualKeyboard()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', async () => {
  hideVirtualKeyboard()
  if (syncEngine) syncEngine.stop()
  if (hardwareAgent) await hardwareAgent.stop()
  const { closeDatabase } = require('./database.cjs')
  closeDatabase()
})

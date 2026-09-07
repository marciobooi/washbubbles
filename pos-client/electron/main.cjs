/**
 * WashBubbles POS — Electron Main Process
 * 
 * Bulletproofing applied:
 * - Content Security Policy (CSP) for security
 * - Restricted BrowserWindow settings
 * - Origin validation for navigation
 * - Fail-fast on config errors
 */
const { app, BrowserWindow, ipcMain, screen, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

// Disable security warnings only in dev
if (!process.env.ELECTRON_START_URL) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'false'
}

const SERVER_URL = process.env.ELECTRON_START_URL || 'https://washbubbles.app' // Production default
const KIOSK_API_KEY = process.env.ELECTRON_KIOSK_API_KEY || ''
const API_BASE = process.env.ELECTRON_API_BASE || 'https://api.washbubbles.app'
const TENANT_ID = process.env.ELECTRON_TENANT_ID || ''
const IS_KIOSK = process.env.ELECTRON_IS_KIOSK === 'true'
/**
 * Development mode. Only ever true when explicitly asked for AND the app is not
 * packaged, so a packaged kiosk build can never fall back to the relaxed CSP
 * even if the env var leaks into the install.
 */
const IS_DEV = process.env.NODE_ENV === 'development' && !app.isPackaged

function validateConfig() {
  if (!TENANT_ID || !KIOSK_API_KEY) {
    console.error('[Main] CRITICAL SECURITY ERROR: Missing TENANT_ID or KIOSK_API_KEY.')
    app.quit()
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

async function initOfflineSystems() {
  console.log('[Main] Booting secure offline systems...')
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
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  // Define a strict CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // `script-src 'unsafe-inline' 'unsafe-eval'` on a renderer that loads
        // remote content means one XSS on the served origin can drive every IPC
        // money handler — it owns the till. Scripts are restricted to bundles
        // this app actually ships; inline styles stay because Tailwind and the
        // component library emit them, and a style injection is not a code
        // execution primitive.
        //
        // In development Vite needs eval for HMR, so the relaxed policy is
        // scoped to dev only and never ships in a packaged kiosk build.
        'Content-Security-Policy': [
          "default-src 'self' " + SERVER_URL + " " + API_BASE + "; " +
          "script-src 'self' " + SERVER_URL + (IS_DEV ? " 'unsafe-inline' 'unsafe-eval'" : "") + "; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "connect-src 'self' " + SERVER_URL + " " + API_BASE + " ws: wss:; " +
          "img-src 'self' data: " + SERVER_URL + " " + API_BASE + "; " +
          "object-src 'none'; base-uri 'none'; frame-ancestors 'none';"
        ]
      }
    })
  })

  mainWindow = new BrowserWindow({
    width: IS_KIOSK ? width : 1280,
    height: IS_KIOSK ? height : 820,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      devTools: !IS_KIOSK // Disable devtools in kiosk mode
    },
    kiosk: IS_KIOSK,
    alwaysOnTop: IS_KIOSK,
    fullscreen: IS_KIOSK,
    frame: !IS_KIOSK,
    autoHideMenuBar: true,
    backgroundColor: '#000000'
  })

  // Security: Prevent navigation to untrusted origins
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url)
    const allowed = [new URL(SERVER_URL).hostname, 'localhost']
    if (!allowed.includes(parsedUrl.hostname)) {
      console.warn(`[Main] Security: Blocked navigation to ${url}`)
      event.preventDefault()
    }
  })

  // Security: Handle window.open properly (prevent popups)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[Main] Security: Blocked popup window for ${url}`)
    return { action: 'deny' }
  })

  if (IS_KIOSK) {
    mainWindow.on('close', (e) => { if (!isQuitting) e.preventDefault() })
  }

  mainWindow.loadURL(SERVER_URL)
}

function loadHardwareConfig() {
  const configPath = path.join(__dirname, '..', 'config.json')
  if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  return { peripherals: {} }
}

app.on('ready', async () => {
  if (!validateConfig()) return
  try { await initOfflineSystems() } catch (err) { console.error('[Main] Init failed:', err) }
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true
  const cleanup = async () => {
    if (syncEngine) syncEngine.stop()
    if (hardwareAgent) await hardwareAgent.stop()
    const { closeDatabase } = require('./database.cjs')
    closeDatabase()
    app.quit()
  }
  cleanup().catch(() => app.exit(1))
})

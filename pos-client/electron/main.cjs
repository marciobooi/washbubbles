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

/**
 * Where the kiosk gets its UI from.
 *
 * `ELECTRON_START_URL` is a developer override for pointing at a live Vite dev
 * server (hot reload while working on the UI). With no override, the kiosk
 * loads its OWN bundled copy of the frontend straight off disk — it used to
 * `loadURL` a remote site (`https://washbubbles.app`) unconditionally, which
 * meant the kiosk had nothing to render at all the moment the internet dropped:
 * not a degraded local screen, an actual browser connection error, because the
 * UI itself had never been fetched.
 *
 * This MUST be the `npm run build:electron` output (repo-root `dist-electron/`),
 * not the plain `npm run build` one (`dist/`, deployed to the web server).
 * The two are built with different Vite `base` values — `dist/` uses
 * absolute asset paths, which 404 under `file://`; `dist-electron/` uses
 * relative ones, which is what a bundle loaded off disk with no server needs.
 * Pointing this at `dist/` looks like it works (the very first paint does)
 * and then breaks the instant the app client-navigates anywhere, or fails to
 * load a single `public/`-folder image — see AUDIT-FINDINGS.md Round 9.
 */
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || null
const LOCAL_UI_PATH = path.join(__dirname, '..', '..', 'dist-electron', 'index.html')
const KIOSK_API_KEY = process.env.ELECTRON_KIOSK_API_KEY || ''
const API_BASE = process.env.ELECTRON_API_BASE || 'https://api.washbubbles.app'
const TENANT_ID = process.env.ELECTRON_TENANT_ID || ''
const IS_KIOSK = process.env.ELECTRON_IS_KIOSK === 'true'
// Used only for the CSP / navigation allowlist below — in dev this is the Vite
// dev server's own origin; in production there is no remote UI origin at all,
// so this is just a label, not something the app actually fetches its shell
// from. API_BASE (below) is what every actual network call targets.
const SERVER_URL = DEV_SERVER_URL || 'http://localhost'
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
        // The dev-server origin only needs to appear here at all when actually
        // loading from one — a packaged kiosk build has no remote UI origin to
        // allow, only the API it talks to.
        'Content-Security-Policy': [
          "default-src 'self' " + (DEV_SERVER_URL ? SERVER_URL + " " : '') + API_BASE + "; " +
          "script-src 'self' " + (DEV_SERVER_URL ? SERVER_URL + " " : '') + (IS_DEV ? "'unsafe-inline' 'unsafe-eval'" : '') + "; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; " +
          "connect-src 'self' " + (DEV_SERVER_URL ? SERVER_URL + " " : '') + API_BASE + " ws: wss:; " +
          "img-src 'self' data: " + (DEV_SERVER_URL ? SERVER_URL + " " : '') + API_BASE + "; " +
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

  // Security: Prevent navigation to untrusted origins. The bundled UI itself
  // is always file:// and trusted (it shipped with this app, not fetched at
  // runtime); anything else is only allowed in dev, to the dev server's own
  // origin.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol === 'file:') return
    const allowed = DEV_SERVER_URL ? [new URL(DEV_SERVER_URL).hostname, 'localhost'] : []
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

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL)
    return
  }

  if (!fs.existsSync(LOCAL_UI_PATH)) {
    // Fail loudly rather than show a silent blank/error window a technician
    // would have no way to diagnose from the kiosk screen itself.
    console.error(`[Main] FATAL: bundled UI not found at ${LOCAL_UI_PATH}. Run "npm run build:electron" in the repo root and deploy its dist-electron/ alongside pos-client/, or set ELECTRON_START_URL for local dev.`)
    mainWindow.loadURL('data:text/html,' + encodeURIComponent(
      '<body style="background:#111;color:#eee;font:16px sans-serif;padding:2rem">' +
      '<h1>Aplicação não encontrada</h1>' +
      '<p>O ficheiro da interface não foi encontrado neste computador. Contacte o suporte técnico.</p>' +
      '</body>'
    ))
    return
  }

  mainWindow.loadFile(LOCAL_UI_PATH)
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

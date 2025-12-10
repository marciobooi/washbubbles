const { app, BrowserWindow } = require('electron')
// In development environment we load dev assets (Vite) that use `eval` for HMR and can trigger
// a Content-Security-Policy warning in Electron. It's safe for dev, but should never be enabled in production.
// Keep warnings during development if you prefer, otherwise set the env var ELECTRON_DISABLE_SECURITY_WARNINGS=1
if (process.env.NODE_ENV === 'development') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}
const path = require('path')
const url = require('url')

function getUrlFromArgs() {
  const arg = process.argv.find((a) => a.startsWith('--url='))
  if (arg) return arg.split('=')[1]

  if (process.argv[2] && !process.argv[2].startsWith('-')) return process.argv[2]

  if (process.env.ELECTRON_START_URL) return process.env.ELECTRON_START_URL
  if (process.env.VITE_APP_URL) return process.env.VITE_APP_URL

  return url.pathToFileURL(path.join(app.getAppPath(), 'dist', 'index.html')).href
}

function createWindow() {
  const startURL = getUrlFromArgs()

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs'),
    },
  })

  let loadUrl = startURL
  if (!/^https?:\/\//.test(startURL) && !/^file:\/\//.test(startURL)) {
    const resolved = path.resolve(app.getAppPath(), startURL)
    loadUrl = url.pathToFileURL(resolved).href
  }

  mainWindow.loadURL(loadUrl)

  if (loadUrl.startsWith('http://localhost')) {
    mainWindow.webContents.openDevTools()
  }
}

app.on('ready', createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// Keep module.exports in case anyone requires it, though electron will just run it.
module.exports = { getUrlFromArgs, createWindow }

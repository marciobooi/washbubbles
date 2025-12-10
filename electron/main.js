import { app, BrowserWindow } from 'electron'
import path from 'path'
import url from 'url'

function getUrlFromArgs() {
  const arg = process.argv.find((a) => a.startsWith('--url='))
  if (arg) return arg.split('=')[1]

  // support `electron . --url dist/index.html`
  if (process.argv[2] && !process.argv[2].startsWith('-')) return process.argv[2]

  if (process.env.ELECTRON_START_URL) return process.env.ELECTRON_START_URL

  return url.pathToFileURL(path.join(app.getAppPath(), 'dist', 'index.html')).href
}

function createWindow() {
  const startURL = getUrlFromArgs()

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(app.getAppPath(), 'electron', 'preload.js'),
    },
  })

  // If user provides a relative file path (e.g., dist/index.html), normalize
  let loadUrl = startURL
  if (!/^https?:\/\//.test(startURL) && !/^file:\/\//.test(startURL)) {
    const resolved = path.resolve(app.getAppPath(), startURL)
    loadUrl = url.pathToFileURL(resolved).href
  }

  mainWindow.loadURL(loadUrl)

  // Open devtools if we detect a local dev server
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

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

// Disable security warnings in development
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

// ========================================
// CONFIGURATION - Edit these values!
// ========================================
const SERVER_URL = 'http://localhost:5173'  // Change to your server URL
const KIOSK_API_KEY = 'b6f3c9a1d4e78b2f90c3a4d6e1f2b3c4d5e6f7890a1b2c3d'
const ENABLE_VIRTUAL_KEYBOARD = true  // Enable/disable virtual keyboard
// ========================================

let oskProcess = null

// Function to show Windows On-Screen Keyboard
function showVirtualKeyboard() {
  if (!ENABLE_VIRTUAL_KEYBOARD) return
  
  if (process.platform === 'win32') {
    // Windows On-Screen Keyboard
    try {
      oskProcess = spawn('osk.exe')
      console.log('Virtual keyboard opened')
    } catch (error) {
      console.error('Failed to open virtual keyboard:', error)
    }
  } else if (process.platform === 'linux') {
    // Linux virtual keyboards (onboard, matchbox-keyboard, etc.)
    try {
      oskProcess = spawn('onboard')
    } catch (error) {
      console.error('Failed to open virtual keyboard. Install onboard: sudo apt-get install onboard')
    }
  }
  // Note: macOS doesn't need this as it has native touch keyboard support
}

// Function to hide virtual keyboard
function hideVirtualKeyboard() {
  if (oskProcess) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/IM', 'osk.exe', '/F'])
      } else {
        oskProcess.kill()
      }
      oskProcess = null
      console.log('Virtual keyboard closed')
    } catch (error) {
      console.error('Failed to close virtual keyboard:', error)
    }
  }
}

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

  // Show virtual keyboard when input fields are focused
  mainWindow.webContents.on('did-finish-load', () => {
    if (ENABLE_VIRTUAL_KEYBOARD) {
      // Inject script to show keyboard on input focus
      mainWindow.webContents.executeJavaScript(`
        document.addEventListener('focusin', (e) => {
          if (e.target.matches('input, textarea')) {
            window.electronAPI?.showKeyboard();
          }
        });
        
        document.addEventListener('focusout', (e) => {
          if (e.target.matches('input, textarea')) {
            // Delay hiding to allow clicking keyboard buttons
            setTimeout(() => {
              if (!document.activeElement.matches('input, textarea')) {
                window.electronAPI?.hideKeyboard();
              }
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
}

// Expose API key to preload
process.env.ELECTRON_KIOSK_API_KEY = KIOSK_API_KEY

// Register IPC handlers for keyboard
ipcMain.on('show-keyboard', () => {
  console.log('IPC: show-keyboard received')
  showVirtualKeyboard()
})

ipcMain.on('hide-keyboard', () => {
  console.log('IPC: hide-keyboard received')
  hideVirtualKeyboard()
})

app.on('ready', createWindow)

app.on('window-all-closed', () => {
  hideVirtualKeyboard() // Clean up keyboard on exit
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// Clean up keyboard process on app quit
app.on('before-quit', () => {
  hideVirtualKeyboard()
})

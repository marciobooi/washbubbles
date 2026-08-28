/*
  Simple WebSocket helper used to connect to an Electron hardware bridge
  Provides a singleton-based connect, subscribe, send and disconnect
*/

let socket = null
const listeners = new Set()

// Same-origin ws(s)://<host>/ws — not localhost:3000 — so a missing
// VITE_HW_BRIDGE_URL at build time doesn't send production kiosks to their
// own browser's localhost.
function defaultWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

export function connect(url = import.meta.env.VITE_HW_BRIDGE_URL || defaultWsUrl()) {
  if (socket && socket.readyState === WebSocket.OPEN) return socket

  // Attach auth token or kiosk api key as query params when available
  try {
    const token = localStorage.getItem('ws_token')
    const kioskKey = window?.electronAPI?.kioskKey?.() || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY
    const parsed = new URL(url)
    if (token) {
      parsed.searchParams.set('token', token)
      console.info('[ws] connecting with token')
    } else if (kioskKey) {
      parsed.searchParams.set('apiKey', kioskKey)
      console.info('[ws] connecting with kioskApiKey')
    } else {
      console.info('[ws] connecting without auth')
    }
    url = parsed.toString()
  } catch (e) {
    // ignore URL parsing errors
    console.error('[ws] connect build url failed', e)
  }

  socket = new WebSocket(url)

  socket.addEventListener('open', () => {
    console.info('[ws] connected to', url)
  })

  socket.addEventListener('message', (evt) => {
    try {
      const data = JSON.parse(evt.data)
      listeners.forEach((cb) => cb(data))
    } catch (err) {
      // non-json messages
      listeners.forEach((cb) => cb(evt.data))
    }
  })

  socket.addEventListener('close', () => {
    console.info('[ws] closed')
  })

  socket.addEventListener('error', (e) => {
    console.error('[ws] error', e)
  })

  return socket
}

export function disconnect() {
  if (socket) {
    socket.close()
    socket = null
  }
}

export function send(data) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  socket.send(payload)
  return true
}

export function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

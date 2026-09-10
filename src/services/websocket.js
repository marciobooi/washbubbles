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

  // Credentials are no longer put in the URL — a JWT or apiKey there ends up
  // in server/proxy access logs and anywhere the URL gets copied (browser
  // devtools included). Instead, connect anonymously and send them as the
  // first WS message; see wsServer.js's matching auth-timeout handshake.
  const token = localStorage.getItem('ws_token')
  const kioskKey = window?.electronAPI?.kioskKey?.() || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY

  socket = new WebSocket(url)

  socket.addEventListener('open', () => {
    console.info('[ws] connected to', url)
    if (token) {
      console.info('[ws] authenticating with token')
      socket.send(JSON.stringify({ type: 'auth', token }))
    } else if (kioskKey) {
      console.info('[ws] authenticating with kioskApiKey')
      socket.send(JSON.stringify({ type: 'auth', apiKey: kioskKey }))
    } else {
      console.info('[ws] no credentials available — connection will be closed by the server')
    }
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

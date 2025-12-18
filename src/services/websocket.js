/*
  Simple WebSocket helper used to connect to an Electron hardware bridge
  Provides a singleton-based connect, subscribe, send and disconnect
*/

let socket = null
const listeners = new Set()

export function connect(url = import.meta.env.VITE_HW_BRIDGE_URL || 'ws://localhost:3000/ws') {
  if (socket && socket.readyState === WebSocket.OPEN) return socket

  // Attach auth token or kiosk api key as query params when available
  try {
    const token = localStorage.getItem('ws_token')
    const kioskKey = window?.electronAPI?.kioskKey?.() || import.meta.env.VITE_KIOSK_API_KEY
    const parsed = new URL(url)
    if (token) parsed.searchParams.set('token', token)
    else if (kioskKey) parsed.searchParams.set('apiKey', kioskKey)
    url = parsed.toString()
  } catch (e) {
    // ignore URL parsing errors
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

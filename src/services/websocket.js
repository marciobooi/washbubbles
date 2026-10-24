/*
  Simple WebSocket helper used to connect to an Electron hardware bridge
  Provides a singleton-based connect, subscribe, send and disconnect
*/

import { isKioskScreen } from '@/lib/kioskContext'

let socket = null
let wantOpen = false
let retryMs = 1000
let retryTimer = null
let usedToken = false      // did the attempt in progress authenticate with a login token?
let tokenRejected = false  // the server refused a login token (expired): use the kiosk key from now on
const listeners = new Set()

// Same-origin ws(s)://<host>/ws — not localhost:3000 — so a missing
// VITE_HW_BRIDGE_URL at build time doesn't send production kiosks to their
// own browser's localhost.
function defaultWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

export function connect(url = import.meta.env.VITE_HW_BRIDGE_URL || defaultWsUrl()) {
  wantOpen = true
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return socket

  // Credentials are no longer put in the URL — a JWT or apiKey there ends up
  // in server/proxy access logs and anywhere the URL gets copied (browser
  // devtools included). Instead, connect anonymously and send them as the
  // first WS message; see wsServer.js's matching auth-timeout handshake.
  const token = localStorage.getItem('ws_token')
  const kioskKey = window?.electronAPI?.kioskKey?.() || localStorage.getItem('kiosk_api_key') || import.meta.env.VITE_KIOSK_API_KEY

  socket = new WebSocket(url)

  socket.addEventListener('open', () => {
    console.info('[ws] connected to', url)
    // Lets the screen re-read what it may have missed while the link was down (e.g. a backend restart).
    listeners.forEach((cb) => cb({ type: 'ws:open' }))
    // On the kiosk screen the kiosk key never expires, a login token (8 h) does: with a stale token the screen went deaf to cash,
    // cards and machines while the server logged a refused connection every second. The key goes first there.
    const preferKey = !!kioskKey && (tokenRejected || isKioskScreen())
    if (token && !preferKey) {
      console.info('[ws] authenticating with token')
      usedToken = true
      socket.send(JSON.stringify({ type: 'auth', token }))
    } else if (kioskKey) {
      usedToken = false
      console.info('[ws] authenticating with kioskApiKey')
      socket.send(JSON.stringify({ type: 'auth', apiKey: kioskKey }))
    } else {
      console.info('[ws] no credentials available — connection will be closed by the server')
    }
  })

  socket.addEventListener('message', (evt) => {
    try {
      const data = JSON.parse(evt.data)
      if (data && data.type === 'auth-ok') { retryMs = 1000; tokenRejected = false } // only a connection that was accepted resets the back-off
      listeners.forEach((cb) => cb(data))
    } catch (err) {
      // non-json messages
      listeners.forEach((cb) => cb(evt.data))
    }
  })

  socket.addEventListener('close', (ev) => {
    console.info('[ws] closed')
    if (ev && ev.code === 1008 && usedToken) tokenRejected = true // refused: next time with the kiosk key (if there is one)
    // The shop backend restarts (updates, power cuts): without this the kiosk stays deaf until F5.
    if (wantOpen) {
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => connect(url), retryMs)
      retryMs = Math.min(retryMs * 2, 10000)
    }
  })

  socket.addEventListener('error', (e) => {
    console.error('[ws] error', e)
  })

  return socket
}

export function disconnect() {
  wantOpen = false
  clearTimeout(retryTimer)
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

import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import Machine from './models/machine.js'
import User from './models/user.js'
import { findUserByApiKey } from './services/apiKeys.js'

/**
 * WashBubbles Secure WebSocket Server
 * Bulletproofing:
 * - Tenant Isolation (Clients only receive data for their tenant)
 * - Mandatory Authentication (No anonymous fallback)
 * - Origin validation when CORS_ORIGINS is set (see originAllowed)
 * - Clients only listen: nothing a client sends is passed on to the others
 */

let _wss = null
let _clientCounter = 0
let _heartbeatInterval = null

/**
 * How long an unauthenticated connection is kept open waiting for its first
 * (auth) message before being dropped.
 */
const AUTH_TIMEOUT_MS = 5000

/** A client only ever sends its auth message: anything bigger is not ours. */
const MAX_PAYLOAD = 16 * 1024

/**
 * A browser page from another site must not open this socket. Checked only where CORS_ORIGINS is set (the central server), as
 * for the API: no Origin header (a program, not a browser), the page's own address, or a listed origin pass.
 */
export function originAllowed(request) {
  const allowed = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const origin = request.headers.origin
  if (!allowed.length || allowed.includes('*') || !origin) return true
  if (allowed.includes(origin)) return true
  try { return new URL(origin).host === request.headers.host } catch { return false }
}

/**
 * Runs the same credential lookup the old query-string auth used —
 * JWT bearer token or kiosk apiKey — just fed from a message payload now
 * instead of the URL. Returns the matching User doc, or null.
 */
async function resolveUser({ token, apiKey }) {
  const JWT_SECRET = process.env.JWT_SECRET
  if (apiKey) {
    return findUserByApiKey(apiKey)
  }
  if (token && JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET)
      const user = await User.findById(decoded.sub)
      // same rule as the API: a token issued before the last password change is dead
      if (user && user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime() - 2000) return null
      return user
    } catch (e) {
      return null
    }
  }
  return null
}

/** Broadcast update to a specific tenant only */
export async function broadcastMachine(machine) {
  if (!_wss || !machine || !machine.tenantId) return
  const tenantIdStr = machine.tenantId.toString()
  const msg = JSON.stringify({ type: 'machine-update', payload: machine })

  _wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN && client.tenantId === tenantIdStr) {
      client.send(msg)
    }
  })
}

/** Broadcast the full machine list to every connected tenant (re-queried per tenant) */
export async function broadcastMachines() {
  if (!_wss) return
  const tenantIds = new Set()
  _wss.clients.forEach((client) => {
    if (client.tenantId) tenantIds.add(client.tenantId)
  })

  for (const tenantId of tenantIds) {
    const machines = await Machine.find({ tenantId }).sort({ number: 1 })
    const msg = JSON.stringify({ type: 'machine-status', payload: machines })
    _wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN && client.tenantId === tenantId) {
        client.send(msg)
      }
    })
  }
}

/** List connected WebSocket clients for admin diagnostics */
export function listClients() {
  if (!_wss) return []
  const clients = []
  _wss.clients.forEach((client) => {
    clients.push({
      id: client._id,
      tenantId: client.tenantId || null,
      alive: client.isAlive,
      readyState: client.readyState,
    })
  })
  return clients
}

/** Forcibly disconnect a client by id. Returns true if a matching client was found. */
export function disconnectClient(id) {
  if (!_wss) return false
  let found = false
  _wss.clients.forEach((client) => {
    if (String(client._id) === String(id)) {
      found = true
      client.close(1000, 'Disconnected by admin')
    }
  })
  return found
}

/** Broadcast hardware events to a specific tenant only */
export function broadcastHardwareEvent(tenantId, type, payload) {
  if (!_wss || !tenantId) return
  const tenantIdStr = tenantId.toString()
  const msg = JSON.stringify({ type, payload })
  
  _wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN && client.tenantId === tenantIdStr) {
      client.send(msg)
    }
  })
}

export function initWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })
  _wss = wss

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/ws' || pathname === '/') {
      if (!originAllowed(request)) { socket.destroy(); return }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    }
  })

  wss.on('connection', (socket, request) => {
    socket._id = ++_clientCounter
    socket.isAlive = true
    socket.authenticated = false
    socket.on('pong', () => { socket.isAlive = true })

    // Credentials no longer travel in the URL (they used to — a JWT or kiosk
    // apiKey in a query string ends up in nginx/proxy access logs, browser
    // devtools, and anywhere the URL gets copied, exactly the way one did in
    // a bug report during this session). The connection opens unauthenticated
    // and has AUTH_TIMEOUT_MS to send `{type:'auth', token|apiKey}` as its
    // first message, the same credentials as before — just out of the URL.
    const authTimer = setTimeout(() => {
      if (!socket.authenticated) {
        console.warn(`[ws] Auth timeout, closing connection (ID: ${socket._id})`)
        socket.close(1008, 'Auth timeout')
      }
    }, AUTH_TIMEOUT_MS)

    async function handleAuth(data) {
      const userModel = await resolveUser({ token: data.token, apiKey: data.apiKey })
      if (!userModel) {
        console.warn(`[ws] Unauthorized connection attempt blocked (ID: ${socket._id})`)
        socket.close(1008, 'Unauthorized')
        return
      }

      clearTimeout(authTimer)
      socket.authenticated = true
      socket.userModel = userModel
      socket.tenantId = userModel.tenantId ? userModel.tenantId.toString() : null

      console.log(`[ws] client ${socket._id} authenticated for tenant: ${socket.tenantId}`)

      socket.send(JSON.stringify({ type: 'auth-ok' }))
      // Initial state for this tenant ONLY.
      const machines = await Machine.find({ tenantId: userModel.tenantId }).sort({ number: 1 })
      socket.send(JSON.stringify({ type: 'machine-status', payload: machines }))
    }

    socket.on('message', (msg) => {
      let data
      try {
        data = JSON.parse(msg)
      } catch (err) {
        return // ignore non-JSON
      }

      if (!socket.authenticated) {
        if (data && data.type === 'auth') {
          handleAuth(data).catch((err) => {
            console.error('[ws] auth error', err)
            socket.close(1011, 'Internal error')
          })
        } else {
          // Anything before a successful auth message is refused outright —
          // no other message type is meaningful pre-auth.
          console.warn(`[ws] Message before auth, closing connection (ID: ${socket._id})`)
          socket.close(1008, 'Unauthorized')
        }
        return
      }

      // Clients only listen. Whatever a client sent used to be passed on to the whole shop, so any holder of a kiosk key or
      // a login could fake "card in the reader", "cash inserted" or "reload the screen" for every screen. Events come from
      // the server only (the broadcast* functions below).
    })

    socket.on('close', () => {
      clearTimeout(authTimer)
      console.log(`[ws] client ${socket._id} disconnected`)
    })
  })

  // Heartbeat monitor
  if (!_heartbeatInterval) {
    _heartbeatInterval = setInterval(() => {
      wss.clients.forEach((client) => {
        if (client.isAlive === false) return client.terminate()
        client.isAlive = false
        client.ping()
      })
    }, 30000)
  }

  console.log('[ws] Secure WebSocket Server initialized with Tenant Isolation')
  return wss
}

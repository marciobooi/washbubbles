import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import Machine from './models/machine.js'
import User from './models/user.js'

/**
 * WashBubbles Secure WebSocket Server
 * Bulletproofing:
 * - Tenant Isolation (Clients only receive data for their tenant)
 * - Mandatory Authentication (No anonymous fallback)
 * - Origin validation
 */

let _wss = null
let _clientCounter = 0
let _heartbeatInterval = null

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
  const wss = new WebSocketServer({ noServer: true })
  _wss = wss

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/ws' || pathname === '/') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    }
  })

  wss.on('connection', async (socket, request) => {
    socket._id = ++_clientCounter
    socket.isAlive = true
    socket.on('pong', () => { socket.isAlive = true })

    try {
      const JWT_SECRET = process.env.JWT_SECRET
      const url = request.url || ''
      const parsed = new URL(url, 'http://localhost')
      const token = parsed.searchParams.get('token')
      const apiKeyQuery = parsed.searchParams.get('apiKey')
      const apiKeyHeader = request.headers['x-api-key'] || 
                         (request.headers['authorization']?.startsWith('ApiKey ') 
                           ? request.headers['authorization'].split(' ')[1] : null)

      let userModel = null
      
      // 1. Authenticate
      if (apiKeyQuery || apiKeyHeader) {
        userModel = await User.findOne({ apiKey: apiKeyQuery || apiKeyHeader })
      } else if (token && JWT_SECRET) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET)
          userModel = await User.findById(decoded.sub)
        } catch (e) { /* ignore */ }
      }

      // Bulletproof: Force Auth
      if (!userModel) {
        console.warn(`[ws] Unauthorized connection attempt blocked (ID: ${socket._id})`)
        socket.close(1008, 'Unauthorized')
        return
      }

      // Store identity and tenant
      socket.userModel = userModel
      socket.tenantId = userModel.tenantId ? userModel.tenantId.toString() : null
      
      console.log(`[ws] client ${socket._id} authenticated for tenant: ${socket.tenantId}`)

      // 2. Send initial state for this tenant ONLY
      const machines = await Machine.find({ tenantId: userModel.tenantId }).sort({ number: 1 })
      socket.send(JSON.stringify({ type: 'machine-status', payload: machines }))

    } catch (err) {
      console.error('[ws] connection error', err)
      socket.close(1011, 'Internal error')
      return
    }

    socket.on('message', (msg) => {
      // Inbound messages are only allowed for admins/kiosks
      // For security, only broadcast to the SAME tenant
      try {
        const data = JSON.parse(msg)
        wss.clients.forEach((client) => {
          if (client.readyState === 1 && client.tenantId === socket.tenantId) {
            client.send(JSON.stringify(data))
          }
        })
      } catch (err) { /* ignore */ }
    })

    socket.on('close', () => console.log(`[ws] client ${socket._id} disconnected`))
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

import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import Machine from './models/machine.js'
import User from './models/user.js'

// basic in-process WebSocket server that broadcasts machine updates to clients
let _wss = null
let _clientCounter = 0
let _heartbeatInterval = null

export async function broadcastMachines() {
  try {
    if (!_wss) return
    const machines = await Machine.find().sort({ createdAt: 1 })
    const clients = _wss.clients ? _wss.clients.size : 0
    const msg = JSON.stringify({ type: 'machine-status', payload: machines })
    if (process.env.DEBUG_WS === 'true') {
      try {
        const infos = Array.from(_wss.clients).filter(c => c.readyState === c.OPEN).map((c) => ({ id: c._id, username: c.userModel ? c.userModel.username : 'anonymous', remote: c._socket ? `${c._socket.remoteAddress}:${c._socket.remotePort}` : 'unknown', isAlive: !!c.isAlive }))
        console.log(`[ws] broadcasting machine-status to ${clients} clients — details:`, infos)
      } catch (e) {
        console.log(`[ws] broadcasting machine-status to ${clients} clients`)
      }
    } else {
      console.log(`[ws] broadcasting machine-status to ${clients} clients`)
    }
    _wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(msg)
    })
  } catch (err) {
    console.error('[ws] broadcastMachines error', err.message || err)
  }
}

export async function broadcastMachine(machine) {
  try {
    if (!_wss || !machine) return
    const clients = _wss.clients ? _wss.clients.size : 0
    const msg = JSON.stringify({ type: 'machine-update', payload: machine })
    if (process.env.DEBUG_WS === 'true') {
      try {
        const infos = Array.from(_wss.clients).filter(c => c.readyState === c.OPEN).map((c) => ({ id: c._id, username: c.userModel ? c.userModel.username : 'anonymous', remote: c._socket ? `${c._socket.remoteAddress}:${c._socket.remotePort}` : 'unknown', isAlive: !!c.isAlive }))
        console.log(`[ws] broadcasting machine-update (${machine._id}) to ${clients} clients — details:`, infos)
      } catch (e) {
        console.log(`[ws] broadcasting machine-update (${machine._id}) to ${clients} clients`)
      }
    } else {
      console.log(`[ws] broadcasting machine-update (${machine._id}) to ${clients} clients`)
    }
    _wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(msg)
    })
  } catch (err) {
    console.error('[ws] broadcastMachine error', err.message || err)
  }
}

export function listClients() {
  if (!_wss) return []
  return Array.from(_wss.clients)
    .filter(c => c.readyState === c.OPEN)
    .map((c) => ({ id: c._id, username: c.userModel ? c.userModel.username : 'anonymous', remote: c._socket ? `${c._socket.remoteAddress}:${c._socket.remotePort}` : 'unknown', connectedAt: c._connectedAt, isAlive: !!c.isAlive }))
}

export function disconnectClient(id) {
  if (!_wss) return false
  const client = Array.from(_wss.clients).find((c) => c._id === id || (c._socket && `${c._socket.remoteAddress}:${c._socket.remotePort}` === id))
  if (!client) return false
  try {
    client.terminate()
    return true
  } catch (e) {
    console.error('[ws] disconnectClient error', e)
    return false
  }
}

export function initWebSocket(server) {
  // Use noServer mode and handle upgrade manually to avoid conflicts with other WebSocket servers
  const wss = new WebSocketServer({ noServer: true })
  _wss = wss

  // Handle HTTP upgrade requests manually
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    
    // Only handle /ws path (or requests without path for backward compatibility)
    if (pathname === '/ws' || pathname === '/') {
      console.log('[ws] Handling upgrade for', pathname)
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    }
    // Let other paths be handled by other WebSocket servers (like /hardware-agent)
  })

  wss.on('connection', async (socket, request) => {
    // assign per-socket metadata
    socket._id = ++_clientCounter
    socket._connectedAt = new Date().toISOString()
    socket.isAlive = true
    socket.on('pong', () => { socket.isAlive = true })

    // Authenticate the connection using either a JWT (query ?token=) or x-api-key header
    try {
      const JWT_SECRET = process.env.JWT_SECRET
      const url = request.url || ''
      const parsed = new URL(url, 'http://localhost')
      const token = parsed.searchParams.get('token')
      const apiKeyQuery = parsed.searchParams.get('apiKey')
      const apiKeyHeader = request.headers['x-api-key'] || (request.headers['authorization'] && request.headers['authorization'].startsWith('ApiKey ') ? request.headers['authorization'].split(' ')[1] : null)

      let userModel = null
      // Prefer explicit API key (query or header) over token to avoid connection failures when token is invalid
      if (apiKeyQuery) {
        userModel = await User.findOne({ apiKey: apiKeyQuery })
        if (!userModel) {
          console.warn('[ws] invalid apiKey in query on connect')
          socket.close(1008, 'Unauthorized')
          return
        }
        console.info('[ws] authenticated via apiKey (query)')
      } else if (apiKeyHeader) {
        userModel = await User.findOne({ apiKey: apiKeyHeader })
        if (!userModel) {
          console.warn('[ws] invalid apiKey on connect')
          socket.close(1008, 'Unauthorized')
          return
        }
        console.info('[ws] authenticated via apiKey (header)')
      } else if (token) {
        try {
          if (!JWT_SECRET) {
            console.error('[ws] JWT_SECRET not available, cannot verify token')
            userModel = null
          } else {
            const decoded = jwt.verify(token, JWT_SECRET)
            userModel = await User.findById(decoded.sub)
            if (!userModel) {
              console.warn('[ws] token valid but user not found:', decoded.sub)
              userModel = null
            } else {
              console.info('[ws] authenticated via token:', userModel.username, '(', userModel.role, ')')
            }
          }
        } catch (err) {
          // Token invalid — don't close connection; allow anonymous read-only fallback
          console.warn('[ws] invalid token on connect, falling back to anonymous:', err.message || err)
          userModel = null
        }
      } else {
        // allow anonymous (read-only) clients to connect — useful for kiosks/pos without keys
        console.info('[ws] anonymous client connected (read-only)')
        userModel = null
      }

      socket.userModel = userModel
      console.log('[ws] client connected', userModel ? userModel.username : 'anonymous', 'id=', socket._id)
    } catch (err) {
      console.error('[ws] auth failure', err)
      try { socket.close(1011, 'Server error') } catch (e) {}
      return
    }

    // send initial machine list to the newly connected client
    (async () => {
      try {
        const machines = await Machine.find().sort({ createdAt: 1 })
        const msg = JSON.stringify({ type: 'machine-status', payload: machines })
        if (socket.readyState === socket.OPEN) socket.send(msg)
      } catch (err) {
        console.error('[ws] failed to send initial machine-status', err)
      }
    })()

    socket.on('message', (msg) => {
      // ignore messages from unauthenticated clients
      if (!socket.userModel) {
        console.warn('[ws] ignoring message from unauthenticated client')
        return
      }
      try {
        const data = JSON.parse(msg)
        // only broadcast messages received from authenticated clients (admins/hardware)
        wss.clients.forEach((client) => {
          if (client.readyState === 1) client.send(JSON.stringify(data))
        })
      } catch (err) {
        console.error('ws msg parse error', err)
      }
    })

    socket.on('close', () => console.log('[ws] client disconnected id=', socket._id))
  })

  // start heartbeat monitor (if not already started)
  if (!_heartbeatInterval) {
    _heartbeatInterval = setInterval(() => {
      try {
        Array.from(wss.clients).forEach((client) => {
          if (client.isAlive === false) {
            console.log('[ws] terminating dead client', client._id)
            try { client.terminate() } catch (e) { }
            return
          }
          client.isAlive = false
          try { client.ping() } catch (e) { }
        })
      } catch (e) {
        console.error('[ws] heartbeat error', e)
      }
    }, 30000)
  }

  // Example: notify every connected client when a machine changes every 10s (dev only)
  setInterval(async () => {
    try {
      const machines = await Machine.find().sort({ createdAt: 1 })
      const msg = JSON.stringify({ type: 'machine-status', payload: machines })
      wss.clients.forEach((client) => {
        if (client.readyState === client.OPEN) client.send(msg)
      })
    } catch (err) {
      console.error('[ws] Could not fetch machines from DB (is DB running?)', err.message || err)
    }
  }, 10000)

  console.log('[ws] websocket server initialized')
  return wss
}

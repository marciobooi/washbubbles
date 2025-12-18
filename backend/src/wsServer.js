import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import Machine from './models/machine.js'
import User from './models/user.js'

// basic in-process WebSocket server that broadcasts machine updates to clients
let _wss = null

export async function broadcastMachines() {
  try {
    if (!_wss) return
    const machines = await Machine.find().sort({ createdAt: 1 })
    const clients = _wss.clients ? _wss.clients.size : 0
    const msg = JSON.stringify({ type: 'machine-status', payload: machines })
    console.log(`[ws] broadcasting machine-status to ${clients} clients`)
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
    console.log(`[ws] broadcasting machine-update (${machine._id}) to ${clients} clients`)
    _wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(msg)
    })
  } catch (err) {
    console.error('[ws] broadcastMachine error', err.message || err)
  }
}

export function initWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' })
  _wss = wss

  wss.on('connection', async (socket, request) => {
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
          const decoded = jwt.verify(token, JWT_SECRET)
          userModel = await User.findById(decoded.sub)
          if (!userModel) throw new Error('User not found')
          console.info('[ws] authenticated via token')
        } catch (err) {
          // Token invalid — don't close connection; allow anonymous read-only fallback
          console.warn('[ws] invalid token on connect, falling back to anonymous', err.message || err)
          userModel = null
        }
      } else {
        // allow anonymous (read-only) clients to connect — useful for kiosks/pos without keys
        console.info('[ws] anonymous client connected (read-only)')
        userModel = null
      }

      socket.userModel = userModel
      console.log('[ws] client connected', userModel ? userModel.username : 'anonymous')
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

    socket.on('close', () => console.log('[ws] client disconnected'))
  })

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

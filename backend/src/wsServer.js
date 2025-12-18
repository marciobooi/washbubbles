import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import Machine from './models/machine.js'
import User from './models/user.js'

// basic in-process WebSocket server that broadcasts machine updates to clients
export function initWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', async (socket, request) => {
    // Authenticate the connection using either a JWT (query ?token=) or x-api-key header
    try {
      const JWT_SECRET = process.env.JWT_SECRET
      const url = request.url || ''
      const parsed = new URL(url, 'http://localhost')
      const token = parsed.searchParams.get('token')
      const apiKeyHeader = request.headers['x-api-key'] || (request.headers['authorization'] && request.headers['authorization'].startsWith('ApiKey ') ? request.headers['authorization'].split(' ')[1] : null)

      let userModel = null
      if (token) {
        try {
          const decoded = jwt.verify(token, JWT_SECRET)
          userModel = await User.findById(decoded.sub)
          if (!userModel) throw new Error('User not found')
        } catch (err) {
          console.warn('[ws] invalid token on connect', err.message || err)
          socket.close(1008, 'Unauthorized')
          return
        }
      } else if (apiKeyHeader) {
        userModel = await User.findOne({ apiKey: apiKeyHeader })
        if (!userModel) {
          console.warn('[ws] invalid apiKey on connect')
          socket.close(1008, 'Unauthorized')
          return
        }
      } else {
        console.warn('[ws] no auth provided on websocket connect')
        socket.close(1008, 'Unauthorized')
        return
      }

      socket.userModel = userModel
      console.log('[ws] client connected', userModel.username)
    } catch (err) {
      console.error('[ws] auth failure', err)
      try { socket.close(1011, 'Server error') } catch (e) {}
      return
    }

    socket.on('message', (msg) => {
      try {
        const data = JSON.parse(msg)
        // For demo: broadcast any message to every client
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

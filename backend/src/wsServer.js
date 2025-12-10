import { WebSocketServer } from 'ws'
import Machine from './models/machine.js'

// basic in-process WebSocket server that broadcasts machine updates to clients
export function initWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (socket) => {
    console.log('[ws] client connected')

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

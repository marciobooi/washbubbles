import { WebSocketServer } from 'ws'

// basic in-process WebSocket server that broadcasts machine updates to clients
export function initWebSocket(server, prisma) {
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
    const machines = await prisma.machine.findMany()
    const msg = JSON.stringify({ type: 'machine-status', payload: machines })
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(msg)
    })
  }, 10000)

  console.log('[ws] websocket server initialized')
  return wss
}

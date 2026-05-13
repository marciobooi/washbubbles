import 'dotenv/config'
import express from 'express'
import http from 'http'
import cors from 'cors'
import { connectMongo } from './db.js'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import posRoutes from './routes/pos.js'
import { initWebSocket, broadcastHardwareEvent } from './wsServer.js'
import hardwareAgentServer from './hardwareAgentServer.js'
import coinMachine from './services/coinMachine.js'
import { resolveTenant } from './middleware/tenant.js'
import gatewaysRoutes from './routes/gateways.js'
import middlewareRoutes from './routes/middleware.js'
import syncRoutes from './routes/sync.js'

// Enforce presence of JWT secret in production-like environments
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Set JWT_SECRET in environment and restart the server.')
  process.exit(1)
}

const app = express()
const server = http.createServer(app)

app.use(cors())
app.use(express.json())
// Resolve tenant early so routes can use `req.tenantFilter` and `req.tenantId`
app.use(resolveTenant)
// We import models directly where needed (no request-scoped ORM)

// Mount under /api prefix for reverse proxying (nginx) or direct access
app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/pos', posRoutes)
// Backwards compatibility: also expose pos endpoints under `/api` (eg. `/api/machine`)
app.use('/api', posRoutes)

// Gateways (kiosk)
app.use('/api/gateways', gatewaysRoutes)

// Middleware (coin machine)
app.use('/api/middleware', middlewareRoutes)

// Sync routes (offline-first POS ↔ server)
app.use('/api/sync', syncRoutes)

app.get('/api/health', (req, res) => res.json({ ok: true }))

// Initialize WebSocket server (models will be imported in wsServer.js)
initWebSocket(server)

// Initialize Hardware Agent WebSocket server
hardwareAgentServer.init(server)

// Listen for hardware events and integrate with coinMachine
hardwareAgentServer.on('peripheral:credit', (data) => {
  console.log('[Backend] Peripheral credit event:', data)
  broadcastHardwareEvent('peripheral:credit', data)
  // Route directly into coinMachine handlers — coinMachine.emit() would fire on the coinMachine
  // EventEmitter, but the internal subscriptions are on coinMachine.middleware, so we call
  // the handler methods directly to ensure balance tracking, bonuses, etc. are applied.
  if (data.type === 'coin_acceptor') {
    coinMachine.handleCoinInserted({ value: data.amount })
  } else if (data.type === 'bill_acceptor') {
    coinMachine.handleBillInserted({ value: data.amount })
  }
})

hardwareAgentServer.on('peripheral:rejected', (data) => {
  broadcastHardwareEvent(data.fraud ? 'peripheral:fraud' : 'peripheral:rejected', data)
  // Inject into coinMachine middleware event bus so rejection handlers apply
  if (data.type === 'coin_acceptor') {
    coinMachine.middleware.emit('coin-rejected', { reason: data.reason })
  } else if (data.type === 'bill_acceptor') {
    coinMachine.middleware.emit('bill-rejected', { reason: data.reason, fraud: data.fraud })
  }
})

hardwareAgentServer.on('peripheral:fault', (data) => {
  console.log('[Backend] Peripheral fault:', data)
  broadcastHardwareEvent('peripheral:fault', data)
})

hardwareAgentServer.on('interface:status', (data) => {
  console.log('[Backend] Interface status event:', data)
  broadcastHardwareEvent('interface:status', data)
  // Inject into coinMachine middleware so machine-status-update handlers run
  coinMachine.middleware.emit('machine-status-update', data)
})

hardwareAgentServer.on('interface:error', (data) => {
  console.log('[Backend] Interface error:', data)
  broadcastHardwareEvent('interface:error', data)
})

hardwareAgentServer.on('rfid:card_detected', (data) => {
  console.log('[Backend] RFID card detected:', data)
  broadcastHardwareEvent('rfid:card_detected', data)
  // Call handleCardRead directly — event name on coinMachine's own emitter differs
  coinMachine.handleCardRead({ cardNumber: data.cardCode })
})

hardwareAgentServer.on('hopper:dispensed', (data) => {
  if (!data.success) {
    console.warn('[Backend] Hopper dispense failed:', data)
    broadcastHardwareEvent('hopper:fault', { reason: 'dispense_failed' })
  }
})

hardwareAgentServer.on('hopper:empty', (data) => {
  console.warn('[Backend] Hopper empty')
  broadcastHardwareEvent('hopper:empty', data)
  coinMachine.middleware.emit('hopper-empty', data)
})

hardwareAgentServer.on('hopper:fault', (data) => {
  console.error('[Backend] Hopper fault:', data)
  broadcastHardwareEvent('hopper:fault', data)
  coinMachine.middleware.emit('hopper-fault', data)
})

hardwareAgentServer.on('machine:activation_sent', (data) => {
  broadcastHardwareEvent('machine:activation_sent', data)
})

hardwareAgentServer.on('machine:activation_failed', (data) => {
  console.error('[Backend] Machine activation failed:', data)
  broadcastHardwareEvent('machine:activation_failed', data)
})

hardwareAgentServer.on('card_dispenser:dispensed', (data) => {
  broadcastHardwareEvent('card_dispenser:dispensed', data)
})

const port = process.env.PORT || 3000
async function start() {
  const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/washstore'
  try {
    await connectMongo(MONGODB_URL)
    
    // Start coin machine system after DB connection
    if (process.env.ENABLE_COIN_MACHINE !== 'false') {
      try {
        await coinMachine.start()
        console.log('CoinMachine system initialized')
      } catch (err) {
        console.warn('Failed to initialize CoinMachine (peripherals may not be connected):', err.message)
      }
    }
  } catch (err) {
    console.error('Warning: Failed to connect to MongoDB at startup — continuing without DB (some endpoints will fail).', err.message || err)
  }

  server.listen(port, () => {
    console.log(`API/WS server listening on port ${port}`)
  })
}

start()

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server')
  await coinMachine.stop()
  server.close(() => {
    console.log('HTTP server closed')
  })
})
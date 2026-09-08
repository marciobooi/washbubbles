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
import wifiRoutes from './routes/wifi.js'
import kioskWatchdog from './services/kioskWatchdog.js'

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

// Guest WiFi vouchers (post-purchase)
app.use('/api/wifi', wifiRoutes)

app.get('/api/health', (req, res) => res.json({ ok: true }))

// Catch-all error handler. Without this an unhandled rejection in any async
// route handler takes the whole process down on Node 18+ — on a POS backend
// that means one bad request stops every kiosk on every site.
// Must be registered after all routes; Express identifies it by arity 4.
app.use((err, req, res, next) => {
  console.error(`[api] Unhandled error on ${req.method} ${req.originalUrl}:`, err)
  if (res.headersSent) return next(err)
  res.status(err.status || 500).json({ error: 'Internal server error' })
})

// Express 4 does not forward rejected promises from async handlers to the
// error middleware, so catch what escapes rather than letting it kill the
// process mid-transaction.
process.on('unhandledRejection', (reason) => {
  console.error('[api] Unhandled promise rejection:', reason)
})

// Initialize WebSocket server (models will be imported in wsServer.js)
initWebSocket(server)

// Initialize Hardware Agent WebSocket server
hardwareAgentServer.init(server)

// Broadcast a hardware event to the tenant that owns the agent it came from.
// Hardware agents identify themselves by agentId, not tenantId, so we resolve
// the tenant via hardwareAgentServer's connection registry.
function broadcastAgentEvent(data, type) {
  const tenantId = hardwareAgentServer.getAgentTenantId(data.agentId)
  if (!tenantId) {
    console.warn(`[Backend] Could not resolve tenant for agent ${data.agentId}; dropping ${type} broadcast`)
    return
  }
  broadcastHardwareEvent(tenantId, type, data)
}

// Listen for hardware events and integrate with coinMachine
hardwareAgentServer.on('peripheral:credit', (data) => {
  console.log('[Backend] Peripheral credit event:', data)
  broadcastAgentEvent(data, 'peripheral:credit')
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
  broadcastAgentEvent(data, data.fraud ? 'peripheral:fraud' : 'peripheral:rejected')
  // Inject into coinMachine middleware event bus so rejection handlers apply
  if (data.type === 'coin_acceptor') {
    coinMachine.middleware.emit('coin-rejected', { reason: data.reason })
  } else if (data.type === 'bill_acceptor') {
    coinMachine.middleware.emit('bill-rejected', { reason: data.reason, fraud: data.fraud })
  }
})

hardwareAgentServer.on('peripheral:fault', (data) => {
  console.log('[Backend] Peripheral fault:', data)
  broadcastAgentEvent(data, 'peripheral:fault')
})

hardwareAgentServer.on('interface:status', (data) => {
  console.log('[Backend] Interface status event:', data)
  broadcastAgentEvent(data, 'interface:status')
  // Inject into coinMachine middleware so machine-status-update handlers run
  coinMachine.middleware.emit('machine-status-update', data)
})

hardwareAgentServer.on('interface:error', (data) => {
  console.log('[Backend] Interface error:', data)
  broadcastAgentEvent(data, 'interface:error')
})

hardwareAgentServer.on('rfid:card_detected', (data) => {
  console.log('[Backend] RFID card detected:', data)
  broadcastAgentEvent(data, 'rfid:card_detected')
  // Call handleCardRead directly — event name on coinMachine's own emitter differs
  coinMachine.handleCardRead({ cardNumber: data.cardCode })
})

hardwareAgentServer.on('hopper:dispensed', (data) => {
  if (!data.success) {
    console.warn('[Backend] Hopper dispense failed:', data)
    broadcastAgentEvent(data, 'hopper:fault')
  }
})

hardwareAgentServer.on('hopper:empty', (data) => {
  console.warn('[Backend] Hopper empty')
  broadcastAgentEvent(data, 'hopper:empty')
  coinMachine.middleware.emit('hopper-empty', data)
})

hardwareAgentServer.on('hopper:fault', (data) => {
  console.error('[Backend] Hopper fault:', data)
  broadcastAgentEvent(data, 'hopper:fault')
  coinMachine.middleware.emit('hopper-fault', data)
})

hardwareAgentServer.on('machine:activation_sent', (data) => {
  broadcastAgentEvent(data, 'machine:activation_sent')
})

hardwareAgentServer.on('machine:activation_failed', (data) => {
  console.error('[Backend] Machine activation failed:', data)
  broadcastAgentEvent(data, 'machine:activation_failed')
})

hardwareAgentServer.on('card_dispenser:dispensed', (data) => {
  broadcastAgentEvent(data, 'card_dispenser:dispensed')
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
    kioskWatchdog.start()
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
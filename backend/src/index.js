import 'dotenv/config'
import express from 'express'
import http from 'http'
import cors from 'cors'
import { connectMongo } from './db.js'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import posRoutes from './routes/pos.js'
import { initWebSocket } from './wsServer.js'

// Enforce presence of JWT secret in production-like environments
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Set JWT_SECRET in environment and restart the server.')
  process.exit(1)
}

const app = express()
const server = http.createServer(app)

app.use(cors())
app.use(express.json())
// We import models directly where needed (no request-scoped ORM)

// Mount under /api prefix for reverse proxying (nginx) or direct access
app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/pos', posRoutes)
// Backwards compatibility: also expose pos endpoints under `/api` (eg. `/api/machine`)
app.use('/api', posRoutes)

// Gateways (kiosk)
import gatewaysRoutes from './routes/gateways.js'
app.use('/api/gateways', gatewaysRoutes)

app.get('/api/health', (req, res) => res.json({ ok: true }))

// Initialize WebSocket server (models will be imported in wsServer.js)
initWebSocket(server)

const port = process.env.PORT || 3000
async function start() {
  const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/washstore'
  try {
    await connectMongo(MONGODB_URL)
  } catch (err) {
    console.error('Warning: Failed to connect to MongoDB at startup — continuing without DB (some endpoints will fail).', err.message || err)
  }

  server.listen(port, () => {
    console.log(`API/WS server listening on port ${port}`)
  })
}

start()

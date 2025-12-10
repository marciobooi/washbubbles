import express from 'express'
import http from 'http'
import cors from 'cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import posRoutes from './routes/pos.js'
import { initWebSocket } from './wsServer.js'

dotenv.config()

const app = express()
const server = http.createServer(app)

const prisma = new PrismaClient()

app.use(cors())
app.use(express.json())
app.use((req, res, next) => {
  req.prisma = prisma
  next()
})

// Mount under /api prefix for reverse proxying (nginx) or direct access
app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/pos', posRoutes)

app.get('/api/health', (req, res) => res.json({ ok: true }))

// Initialize WebSocket server and share Prisma
initWebSocket(server, prisma)

const port = process.env.PORT || 3000
server.listen(port, () => {
  console.log(`API/WS server listening on port ${port}`)
})

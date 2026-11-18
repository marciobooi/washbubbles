import 'dotenv/config'
import './services/logTime.js' // every log line gets its time
import './services/asyncRoutes.js' // a rejected async route handler answers with an error instead of hanging
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import http from 'http'
import cors from 'cors'
import { noOperators } from './middleware/noOperators.js'
import { connectMongo } from './db.js'
import authRoutes from './routes/auth.js'
import adminRoutes, { uploadDir } from './routes/admin.js'
import storesRoutes from './routes/stores.js'
import installerRoutes from './routes/installer.js'
import { uploadsFetchThrough } from './services/uploadsCache.js'
import posRoutes from './routes/pos.js'
import { initWebSocket, broadcastHardwareEvent } from './wsServer.js'
import hardwareAgentServer from './hardwareAgentServer.js'
import coinMachine from './services/coinMachine.js'
import { resolveTenant } from './middleware/tenant.js'
import gatewaysRoutes from './routes/gateways.js'
import middlewareRoutes from './routes/middleware.js'
import syncRoutes from './routes/sync.js'
import * as mbwayLinkRoutes from './routes/mbwayLink.js'
import wifiRoutes from './routes/wifi.js'
import publicRoutes from './routes/public.js'
import kioskWatchdog from './services/kioskWatchdog.js'
import { startDomainWatcher } from './services/domainWatcher.js'
import { hasRole } from './services/roles.js'
import { startShutdownScheduler } from './services/shutdownScheduler.js'
import { startDailyBackup } from './services/dailyBackup.js'
import { startFlowTimer } from './services/flows.js'

// Enforce presence of JWT secret in production-like environments
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Set JWT_SECRET in environment and restart the server.')
  process.exit(1)
}

const app = express()
const server = http.createServer(app)

/**
 * How many reverse-proxy hops sit in front of this process, so express and
 * express-rate-limit resolve the real client IP from X-Forwarded-For instead
 * of the last proxy's address (or, unset, refusing to trust the header at
 * all and throwing on every rate-limited request — ERR_ERL_UNEXPECTED_X_FORWARDED_FOR).
 * 0 (default) = no reverse proxy — correct for the shop-PC install, which
 * binds the kiosk browser straight to this process. The Hetzner/Docker
 * deployment sits behind TWO nginx hops (host nginx, then the frontend
 * container's own nginx) and sets TRUST_PROXY=2 in docker-compose.yml.
 */
const trustProxy = parseInt(process.env.TRUST_PROXY, 10)
if (trustProxy > 0) app.set('trust proxy', trustProxy)

// Browsers may only call the API from these origins when CORS_ORIGINS is set (comma separated); the site and the kiosk are
// same-origin and need no CORS at all. Unset = open (development).
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
app.disable('x-powered-by')
app.use(corsOrigins.length && !corsOrigins.includes('*') ? cors({ origin: corsOrigins }) : cors())
app.use(express.json())
app.use(noOperators)
// Resolve tenant early so routes can use `req.tenantFilter` and `req.tenantId`
app.use(resolveTenant)
// We import models directly where needed (no request-scoped ORM)

// Mount under /api prefix for reverse proxying (nginx) or direct access
app.use('/api/auth', authRoutes)
// Which parts this process serves (APP_ROLES, see services/roles.js; the default is everything, as on every shop PC).
if (hasRole('sync')) {
  app.use('/api/installer', installerRoutes)
  // Sync routes (offline-first POS ↔ server)
  app.use('/api/sync', syncRoutes)
}
if (hasRole('web')) {
app.use('/api/admin/stores', storesRoutes) // before the admin router: superadmin-only, its own guard
app.use('/api/admin', adminRoutes)
app.use('/api/pos', posRoutes)
// Backwards compatibility: also expose pos endpoints under `/api` (eg. `/api/machine`)
app.use('/api', posRoutes)

// Gateways (kiosk)
app.use('/api/gateways', gatewaysRoutes)

// Middleware (coin machine)
app.use('/api/middleware', middlewareRoutes)
}

// MB WAY by QR: the shop creates / picks up (kiosk key); the customer's phone opens /pagar/<token> and types their number
app.use('/api/mbway-link', mbwayLinkRoutes.shopRouter)
app.use(mbwayLinkRoutes.publicRouter)

// Guest WiFi vouchers (post-purchase)
app.use('/api/wifi', wifiRoutes)

app.get('/api/health', (req, res) => res.json({ ok: true }))

// Uploaded logo/banner images (see routes/admin.js's upload endpoints) —
// serving them was previously left to whatever static hosting happened to
// share a filesystem with this process, which only ever really held for
// local dev (Vite's own publicDir already covers the same resolved path).
// The Docker/cloud deployment runs this in a separate container from the
// one serving the SPA, with no shared volume, so nothing served these at
// all; the shop-kiosk single-process build had the same gap. Mounted here,
// once, so every deployment mode actually serves what it just wrote.
app.use('/uploads', express.static(uploadDir))
// A shop PC does not hold the pictures uploaded on the central server: fetch a missing one once and keep it
// (no-op on the central server itself, which has no SYNC_SERVER_URL). See services/uploadsCache.js.
app.use('/uploads', uploadsFetchThrough({ uploadDir }))

// Server-rendered public front page (real HTML in the first response, for
// crawlers/link-previews) — the cloud/public deployment only. The shop-kiosk
// build's "/" is the point-of-sale UI (SERVE_FRONTEND below) and must never be
// shadowed by this; the two are mutually exclusive by what each deployment sets.
if (process.env.PUBLIC_LANDING_PAGE === 'true') {
  // The website's own copy of its fonts (Inter, Poppins): visitors never contact Google for them.
  app.use('/og', express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/og'), { maxAge: '7d' }))
  app.use('/fonts', express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/fonts'), { maxAge: '365d', immutable: true }))
  app.use('/', publicRoutes)
  console.log('Public front page enabled at /')
}

// Single-process kiosk install: serve the built web UI from this process so the
// kiosk browser only needs http://localhost:PORT (same origin => /api and /ws
// just work, no nginx). Opt-in; the Docker/nginx deployment is unaffected.
if (process.env.SERVE_FRONTEND === 'true') {
  const webDist = process.env.WEB_DIST
    || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist')
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist))
    // Client-side routes (BrowserRouter) — anything that is not API/WS/uploads.
    app.get(/^\/(?!api\/|ws|uploads\/).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')))
    console.log(`Serving web UI from ${webDist}`)
  } else {
    console.warn(`SERVE_FRONTEND=true but no build found at ${webDist} — run "npm run build"`)
  }
}

// An unknown API address answers JSON, not Express's default HTML page ("Cannot GET ...").
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))

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
    // The first shop owns PRIMARY_DOMAIN (freshbubbles.pt) until addresses are set in the admin; user names are unique system-wide.
    try {
      const { ensurePrimaryDomain } = await import('./services/tenantDomains.js')
      if (await ensurePrimaryDomain()) console.log(`[Tenants] ${process.env.PRIMARY_DOMAIN} assigned to the first shop`)
      const { ensureGlobalUsernameIndex } = await import('./services/ensureIndexes.js')
      const User = (await import('./models/user.js')).default
      const r = await ensureGlobalUsernameIndex(User)
      if (r.status === 'created') console.log('[Users] user names are now unique across all shops')
      if (r.status === 'duplicates') console.warn(`[Users] the same user name exists in more than one shop (${r.duplicates.join(', ')}): rename them, the system-wide unique index was NOT created`)
    } catch (err) { console.warn('[Tenants] start-up check failed:', err.message) }
    // Indexes Mongoose will not replace by itself (a unique email index that broke creating a second user without an email).
    try {
      const { ensureUserIndexes } = await import('./services/ensureIndexes.js')
      const User = (await import('./models/user.js')).default
      const fixed = await ensureUserIndexes(User)
      if (fixed.length) console.log(`[Users] index(es) rebuilt: ${fixed.join(', ')}`)
    } catch (err) { console.warn('[Users] could not check indexes:', err.message) }
    // A staff PIN saved before PINs were hashed is converted now.
    try {
      const { migrateAdminPins } = await import('./services/staffPin.js')
      const SettingModel = (await import('./models/setting.js')).default
      const n = await migrateAdminPins(SettingModel)
      if (n) console.log(`[Settings] ${n} staff PIN(s) stored as a hash`)
      const { datePins } = await import('./services/staffPin.js')
      const d = await datePins(SettingModel)
      if (d) console.log(`[Settings] ${d} staff PIN(s) dated today: they expire in a week`)
    } catch (err) { console.warn('[Settings] could not migrate the staff PIN:', err.message) }
    // Sales that reached the central server without their machine get it back from their own line (see services/saleMachines.js).
    try {
      const { backfillSaleMachines } = await import('./services/saleMachines.js')
      const n = await backfillSaleMachines()
      if (n) console.log(`[Sales] ${n} sale(s) got their machine back`)
    } catch (err) { console.warn('[Sales] could not recover the machines of old sales:', err.message) }
    // The last real close, as the point the shop's coin and note count starts from (see services/cashDrawer.js)
    try {
      const { ensureResetMarker } = await import('./services/cashDrawer.js')
      const DayCloseModel = (await import('./models/dayClose.js')).default
      const n = await ensureResetMarker(DayCloseModel)
      if (n) console.log(`[CashDrawer] the last real close was marked as the start of the coin and note count (${n} shop(s))`)
    } catch (err) { console.warn('[CashDrawer] could not mark the last close:', err.message) }
    // Card balances are whole cents: round away any float dust left by older updates (a no-op when all are exact).
    try {
      const { normalizeBalances } = await import('./services/cardBalance.js')
      const Card = (await import('./models/card.js')).default
      const n = await normalizeBalances(Card)
      if (n) console.log(`[Cards] ${n} card balance(s) rounded to whole cents`)
    } catch (err) { console.warn('[Cards] could not normalise balances:', err.message) }
    
    // Start coin machine system after DB connection
    if (process.env.ENABLE_COIN_MACHINE !== 'false') {
      try {
        await coinMachine.start()
        console.log('CoinMachine system initialized')
        startShutdownScheduler(coinMachine) // only on a shop PC: the central server never gets here (ENABLE_COIN_MACHINE=false)
        startDailyBackup(coinMachine) // 23:00: a copy of the data here and on the central server (same rule: shop PC only)
      } catch (err) {
        console.warn('Failed to initialize CoinMachine (peripherals may not be connected):', err.message)
      }
    }
    startFlowTimer() // customer actions (flows) are closed when idle and sent to the central server
    if (hasRole('worker')) kioskWatchdog.start()
    // translations that the last restart cut off (an update restarts the server) are started again, a little after the translator is up
    if (hasRole('worker')) setTimeout(async () => {
      try {
        await (await import('./services/legalTranslate.js')).resumeInterrupted()
        await (await import('./services/landingTranslate.js')).resumeInterrupted()
      } catch (e) { console.warn('[translate] could not resume interrupted translations:', e.message) }
    }, 20_000).unref?.()
    // central server only: moves new shops' site addresses along (DNS -> certificate -> "your site is live" e-mail)
    if (process.env.PUBLIC_LANDING_PAGE === 'true' && hasRole('worker')) startDomainWatcher()
  } catch (err) {
    console.error('Warning: Failed to connect to MongoDB at startup — continuing without DB (some endpoints will fail).', err.message || err)
  }

  // HOST=127.0.0.1 keeps a kiosk PC's API off the shop LAN (and avoids the
  // Windows Firewall "allow Node.js?" prompt). Unset = all interfaces, as before.
  const onListening = () => console.log(`API/WS server listening on ${process.env.HOST || '*'}:${port}`)
  if (process.env.HOST) server.listen(port, process.env.HOST, onListening)
  else server.listen(port, onListening)
}

start()

// Graceful shutdown
// No new connections (nginx then sends them to the process that replaces this one), the requests under way get a few seconds to
// finish, open sockets (WebSocket clients) are closed so they reconnect to the new process, then this one exits.
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server')
  const bye = setTimeout(() => { console.log('Shutdown: exiting'); process.exit(0) }, 8000)
  bye.unref?.()
  // what a customer was doing is closed normally and saved first, instead of being left open ('interrupted' on the next start)
  try { await Promise.race([(await import('./services/flows.js')).closeAll(), new Promise((r) => setTimeout(r, 3000))]) } catch (e) { console.warn('Shutdown: flows not closed:', e.message) }
  server.close(() => { console.log('HTTP server closed'); process.exit(0) })
  server.closeIdleConnections?.()
  try { await coinMachine.stop() } catch (e) { console.warn('Shutdown: coin machine stop failed:', e.message) }
  setTimeout(() => server.closeAllConnections?.(), 5000).unref?.()
})

/**
 * Hardware bridge: the ONE long-lived connection to the shop controller.
 *
 * Found on the shop controller: it switches the bill acceptor off whenever the program connected to it
 * goes away, and a plain reconnect does not switch it back on. The shop backend is restarted for every
 * deploy (and can crash), so each restart took the note slot away until someone re-seated a cable.
 *
 * This small program keeps the controller's TCP session open for as long as it runs, and lets the
 * backend connect to IT (127.0.0.1:16853) instead of to the controller. Restarting the backend now only
 * closes a local socket; the controller never sees a disconnect.
 *
 *   controller (192.168.2.201:16852)  <->  bridge  <->  backend (LOWLEVEL_HOST=127.0.0.1 LOWLEVEL_PORT=16853)
 *
 * It does no interpretation of the protocol except:
 *  - money events (coin-inserted, bill-inserted) that arrive while no backend is connected are kept for a
 *    couple of minutes and handed to the backend when it connects, so a restart does not lose a coin;
 *  - it tells every backend that connects how old the controller session is (`bridge-status`), so the
 *    app can warn the operator when the session is brand new (the bill acceptor may then be off).
 *
 * Run:  node src/hardwareBridge.js        (env: CONTROLLER_HOST, CONTROLLER_PORT, BRIDGE_PORT)
 */
import net from 'net'
import { pathToFileURL } from 'url'
import { LowLevelStreamParser, LOWLEVEL_DEFAULT_HOST, LOWLEVEL_DEFAULT_PORT } from './services/lowLevel.js'

export const BRIDGE_DEFAULT_PORT = 16853
const MONEY_OPS = new Set(['coin-inserted', 'bill-inserted'])

export function startBridge({
  controllerHost = LOWLEVEL_DEFAULT_HOST,
  controllerPort = LOWLEVEL_DEFAULT_PORT,
  listenHost = '127.0.0.1',
  listenPort = BRIDGE_DEFAULT_PORT,
  // A drop is followed by new attempts fast: 3 s to connect (the Windows default is ~21 s: 2026-11-10..17 the controller's SYN was lost
  // five times and every one of them cost 25 s without a controller; the next attempt connected at once), then 1 s before the next one.
  reconnectMs = 1000,
  connectTimeoutMs = 3000,
  connect = net.createConnection, // replaceable, for the tests
  bufferTtlMs = 120_000,
  // with the time: bridge.log had none, so a controller drop could not be matched with anything else (2026-11-10)
  log = (...a) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), '[bridge]', ...a),
} = {}) {
  const clients = new Set()
  const parser = new LowLevelStreamParser()
  let controller = null
  let controllerUp = false
  let controllerSince = null
  let reconnectTimer = null
  // What happens between a drop and the next connection says what the controller did: attempts REFUSED at once = its program
  // restarted (the device stayed on); attempts that TIME OUT = the device or its network was off.
  let lostAt = null
  let failed = [] // error codes of the attempts since the drop
  let stopped = false
  let heldMoney = [] // { raw, at }

  const status = () => JSON.stringify({
    op: 'bridge-status',
    controller: controllerUp ? 'connected' : 'disconnected',
    sessionAgeMs: controllerUp && controllerSince ? Date.now() - controllerSince : 0,
  })

  const tellClients = () => {
    const msg = status()
    for (const c of clients) { try { c.write(msg) } catch { /* the client is going away */ } }
  }

  function connectController() {
    if (stopped) return
    const sock = connect({ host: controllerHost, port: controllerPort })
    controller = sock
    sock.setKeepAlive(true, 30_000)
    sock.setNoDelay(true)
    // an attempt that gets no answer is given up after connectTimeoutMs and the next one starts (cleared once connected)
    sock.setTimeout(connectTimeoutMs)
    sock.on('timeout', () => { if (!controllerUp) sock.destroy(Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })) })

    sock.on('connect', () => {
      sock.setTimeout(0)
      controllerUp = true
      controllerSince = Date.now()
      log(`controller connected ${controllerHost}:${controllerPort}` + (lostAt ? ` (down for ${Math.round((Date.now() - lostAt) / 1000)} s; ${failed.length} failed attempt(s)${failed.length ? ': ' + [...new Set(failed)].join(', ') : ''})` : ''))
      lostAt = null
      failed = []
      tellClients()
    })
    sock.on('data', (chunk) => {
      for (const c of clients) { try { c.write(chunk) } catch { /* ignore */ } }
      // Keep money that arrives while nobody is listening.
      if (clients.size === 0) {
        for (const msg of parser.push(chunk)) {
          if (MONEY_OPS.has(msg.op)) heldMoney.push({ raw: JSON.stringify(msg), at: Date.now() })
        }
        if (heldMoney.length > 50) heldMoney = heldMoney.slice(-50)
      } else {
        parser.push(chunk) // keep the parser in step; nothing to keep
      }
    })
    const down = (why) => {
      if (controller !== sock) return
      const was = controllerUp
      controllerUp = false
      controller = null
      if (was) {
        log(`controller link lost (${why}) after a session of ${controllerSince ? Math.round((Date.now() - controllerSince) / 60000) : '?'} min`)
        lostAt = Date.now()
      } else if (why !== 'closed') {
        failed.push(why) // not logged one by one (every 2 s): summed up when it connects again
        if (failed.length > 500) failed = failed.slice(-500)
      }
      tellClients()
      if (!stopped) reconnectTimer = setTimeout(connectController, reconnectMs)
    }
    sock.on('error', (e) => down(e.code || e.message))
    sock.on('close', () => down('closed'))
  }

  const server = net.createServer((client) => {
    clients.add(client)
    client.setNoDelay(true)
    log(`backend connected (${clients.size} client${clients.size === 1 ? '' : 's'})`)
    client.write(status())
    // Hand over money that arrived while the backend was away.
    const now = Date.now()
    const fresh = heldMoney.filter((m) => now - m.at <= bufferTtlMs)
    heldMoney = []
    if (fresh.length) {
      log(`handing over ${fresh.length} held money event(s)`)
      setTimeout(() => { for (const m of fresh) { try { client.write(m.raw) } catch { /* gone */ } } }, 500)
    }
    // The backend can ask for a fresh controller session ({"op":"bridge-reset"}): the controller was found answering nothing at all
    // while the TCP connection still looked fine (2026-11-06), which only a new connection (or a power cycle) cures.
    const fromBackend = new LowLevelStreamParser()
    client.on('data', (chunk) => {
      const msgs = fromBackend.push(chunk)
      if (msgs.some((m) => m?.c?.op === 'bridge-reset' || m?.op === 'bridge-reset')) {
        log('backend asked for a new controller session')
        controller?.destroy() // 'close' reconnects by itself
        return
      }
      if (controllerUp && controller) controller.write(chunk)
    })
    const gone = () => { if (clients.delete(client)) log(`backend disconnected (${clients.size} left)`) }
    client.on('close', gone)
    client.on('error', gone)
  })

  server.listen(listenPort, listenHost, () => log(`listening on ${listenHost}:${listenPort}`))
  connectController()

  return {
    server,
    get controllerUp() { return controllerUp },
    get clientCount() { return clients.size },
    close() {
      stopped = true
      clearTimeout(reconnectTimer)
      for (const c of clients) c.destroy()
      controller?.destroy()
      server.close()
    },
  }
}

// Run as a program.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBridge({
    controllerHost: process.env.CONTROLLER_HOST || LOWLEVEL_DEFAULT_HOST,
    controllerPort: Number(process.env.CONTROLLER_PORT) || LOWLEVEL_DEFAULT_PORT,
    listenPort: Number(process.env.BRIDGE_PORT) || BRIDGE_DEFAULT_PORT,
  })
  process.on('uncaughtException', (e) => console.error('[bridge] uncaught:', e.message))
}

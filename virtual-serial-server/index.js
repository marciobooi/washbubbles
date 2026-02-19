// index.js
// Virtual Serial/ccTalk Simulator (Node-only, no COM drivers)
// - USE_MOCK=1 => in-memory "COM" with @serialport/binding-mock
// - WebSocket control API (bill:insert, bill:reject, hopper:dispense, etc.)
// - Optional TCP bus (CCTALK_BUS_PORT) speaking raw ccTalk frames

import { SerialPort } from 'serialport'
import { MockBinding } from '@serialport/binding-mock'
import { CCTalkParser } from '@serialport/parser-cctalk'
import { WebSocketServer } from 'ws'
import http from 'http'
import net from 'node:net'
import { Transform, Duplex } from 'node:stream'

// -------------------- ENV & Defaults --------------------
const USE_MOCK = (process.env.USE_MOCK ?? 'true') === 'true'
if (USE_MOCK) SerialPort.binding = MockBinding

const CONTROL_PORT = Number(process.env.VSS_CONTROL_PORT || 4002)
const DEFAULT_PORTS = ['COM10', 'COM11', 'COM12', 'COM13', 'COM14']

const portsArg = (process.env.MOCK_PORTS || (process.argv.find(a => a.startsWith('--ports=')) || '')).replace('--ports=', '')
const PORTS = portsArg ? portsArg.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_PORTS

// Mapeamento lógico
const defaultMapping = {
  [PORTS[0]]: 'rfid_reader',
  [PORTS[1]]: 'bill_acceptor',   // <-- alterei para bill_acceptor (antes "coin_acceptor")
  [PORTS[2]]: 'interface',
  [PORTS[3]]: 'hopper',
  [PORTS[4]]: 'card_dispenser',
}
const mappingArg = process.env.MOCK_MAPPING || (process.argv.find(a => a.startsWith('--mapping=')) || '')
const mapping = { ...defaultMapping }
if (mappingArg) {
  const body = mappingArg.replace('--mapping=', '')
  body.split(',').forEach(pair => {
    const [p, t] = pair.split('=') || []
    if (p && t) mapping[p.trim()] = t.trim()
  })
}
console.log('[vss] USE_MOCK=', USE_MOCK)
console.log('[vss] PORTS=', PORTS)
console.log('[vss] MAPPING=', mapping)

// -------------------- ccTalk Basics --------------------
const CC = {
  HOST: 1,
  ADDR: { BV: 40, HOP: 4 },
  ROUTE: { RETURN: 0x00, STACK: 0x01 },  // revisões novas incluem outros valores (ex.: 255)  // ref: ccTalk Part 1 4.4 [5](https://www.prajwaldesai.com/disable-driver-signature-enforcement-in-windows-11/)
}

// Eventos de BV (pares [eventCode, billType]). Códigos exemplificativos (cada vendor tem sua tabela).
const BV_EVENTS = {
  inserted: (type = 5) => [0x10, type],
  stacked : (type = 5) => [0x11, type],
  rejected: (type = 5) => [0x12, type],
}

function ccFrame(dest, src, header, data = []) {
  const arr = [dest, data.length, src, header, ...data]
  const cks = (256 - (arr.reduce((a, b) => a + b, 0) & 0xFF)) & 0xFF
  return Buffer.from([...arr, cks])
}

// -------------------- State --------------------
const ports = new Map()   // portName -> { serial, type }
const ccState = new Map() // portName -> { type, queue:number[], hopper:{enabled:boolean, pending:number}, _lastType?:number }

// in-process serial used as a safe fallback when running with USE_MOCK
function createInMemorySerial(path) {
  const s = new Duplex({
    write(chunk, _enc, cb) {
      // echo writes back to readable side so listeners/parsers still receive data
      this.push(Buffer.from(chunk))
      cb()
    },
    read() { /* noop - data is pushed from write() */ }
  })
  s.path = path
  s.isOpen = true
  s.open = (cb) => { s.isOpen = true; if (cb) cb() }
  s.close = (cb) => { s.isOpen = false; s.emit('close'); if (cb) cb() }
  return s
}

// -------------------- Open Ports --------------------
async function openAllPorts() {
  for (const p of PORTS) {
    const type = mapping[p] || 'unknown'
    try {
      // when mocking, register a mock port with MockBinding so SerialPort uses the mock binding
      if (USE_MOCK) {
        try {
          await MockBinding.createPort(p, { echo: false, record: true })
        } catch (e) {
          if (!/exists|already/i.test(String(e.message))) console.warn(`[vss] MockBinding.createPort ${p} -> ${e.message}`)
        }
      }

      let serial = null
      if (USE_MOCK) {
        // pure mock mode — do NOT attempt to open OS COM devices
        try {
          await MockBinding.createPort(p, { echo: false, record: true })
        } catch (e) {
          if (!/exists|already/i.test(String(e.message))) console.warn(`[vss] MockBinding.createPort ${p} -> ${e.message}`)
        }
        serial = createInMemorySerial(p)
        console.log(`[vss] Mocked in-memory serial ${p} (type=${type})`)
      } else {
        serial = new SerialPort({ path: p, baudRate: 9600, autoOpen: false })
        await new Promise((res, rej) => serial.open(err => err ? rej(err) : res()))
        console.log(`[vss] Opened serial ${p} (type=${type})`)
      }

      serial.on('data', (chunk) => {
        broadcast({ event: 'data', port: p, type, dataHex: chunk.toString('hex'), text: tryToUtf8(chunk) })
      })
      serial.on('error', (err) => console.error(`[vss] Serial ${p} error:`, err.message))

      // ccTalk-capable
      if (['bill_acceptor', 'coin_acceptor', 'hopper'].includes(type)) {
        attachCcTalkHandlers(p, type, serial)
      }

      ports.set(p, { serial, type })
    } catch (err) {
      console.warn(`[vss] Failed to open ${p}:`, err.message)
    }
  }
}

function attachCcTalkHandlers(portName, type, serial) {
  if (!ccState.has(portName)) ccState.set(portName, { type, queue: [], hopper: { enabled:false, pending:0 } })

  try {
    const parser = serial.pipe(new CCTalkParser(100)) // aceita até 100ms de gap entre bytes
    parser.on('data', (buf) => {
      const dest = buf[0], len = buf[1], src = buf[2], header = buf[3]
      const data = buf.slice(4, 4 + len)
      broadcast({ event: 'cctalk:recv', port: portName, type, packetHex: Buffer.from(buf).toString('hex') })

      let resp = null
      if (type === 'bill_acceptor' || type === 'coin_acceptor') {
        resp = handleBV(dest, len, src, header, data, portName)
      } else if (type === 'hopper') {
        resp = handleHOP(dest, len, src, header, data, portName)
      }
      if (resp) {
        serial.write(resp)
        broadcast({ event: 'cctalk:send', port: portName, type, packetHex: resp.toString('hex') })
      }
    })
  } catch (e) {
    console.warn(`[vss] Could not attach CCTalkParser to ${portName}: ${e.message}`)
  }
}

// ---------- BV (addr 40) ----------
function handleBV(dest, len, src, header, data, portName) {
  if (dest !== CC.ADDR.BV && dest !== 0) return null
  const st = ccState.get(portName)

  switch (header) {
    case 0xFE: return ccFrame(src, CC.ADDR.BV, 0x00) // 254 Simple poll -> ACK  // ref: Command list [3](https://com0com.sourceforge.net/doc/UsingCom0com.pdf)
    case 0xF6: return ccFrame(src, CC.ADDR.BV, 0x00, [...Buffer.from('NRI')])                 // 246 Manufacturer id [3](https://com0com.sourceforge.net/doc/UsingCom0com.pdf)
    case 0xF5: return ccFrame(src, CC.ADDR.BV, 0x00, [...Buffer.from('Bill Validator')])      // 245 Equipment category id [3](https://com0com.sourceforge.net/doc/UsingCom0com.pdf)
    case 0xF4: return ccFrame(src, CC.ADDR.BV, 0x00, [...Buffer.from('MODEL-X')])            // 244 Product code [3](https://com0com.sourceforge.net/doc/UsingCom0com.pdf)
    case 0xF2: return ccFrame(src, CC.ADDR.BV, 0x00, [...Buffer.from('SN123456')])           // 242 Serial number [3](https://com0com.sourceforge.net/doc/UsingCom0com.pdf)

    case 0x9F: { // 159 Read buffered bill events -> Reply header=0 com pares [evento, tipo]  // ref: Bill Validator commands [3](https://com0com.sourceforge.net/doc/UsingCom0com.pdf)
      const out = []
      while (out.length < 8 && st.queue.length) { // até 4 pares
        out.push(st.queue.shift(), st.queue.shift())
      }
      return ccFrame(src, CC.ADDR.BV, 0x00, out)
    }

    case 0x9A: { // 154 Route bill (0x01=STACK, 0x00=RETURN; há variações)  // ref: Part 1 notes “route code 255 added” [5](https://www.prajwaldesai.com/disable-driver-signature-enforcement-in-windows-11/)
      const code = data[0] ?? CC.ROUTE.STACK
      const t = st._lastType ?? 5
      if (code === CC.ROUTE.STACK) st.queue.push(...BV_EVENTS.stacked(t))
      else                         st.queue.push(...BV_EVENTS.rejected(t))
      return ccFrame(src, CC.ADDR.BV, 0x00) // ACK
    }

    default: return ccFrame(src, CC.ADDR.BV, 0x05) // NAK
  }
}

// ---------- Hopper (addr 4) ----------
function handleHOP(dest, len, src, header, data, portName) {
  if (dest !== CC.ADDR.HOP && dest !== 0) return null
  const st = ccState.get(portName)

  switch (header) {
    case 0xFE: return ccFrame(src, CC.ADDR.HOP, 0x00)                                        // 254 poll -> ACK [3](https://com0com.sourceforge.net/doc/UsingCom0com.pdf)
    case 0xF6: return ccFrame(src, CC.ADDR.HOP, 0x00, [...Buffer.from('HOPPER')])            // 246 manufacturer [3](https://com0com.sourceforge.net/doc/UsingCom0com.pdf)
    case 0xF5: return ccFrame(src, CC.ADDR.HOP, 0x00, [...Buffer.from('Payout')])            // 245 category   [3](https://com0com.sourceforge.net/doc/UsingCom0com.pdf)
    case 0xF4: return ccFrame(src, CC.ADDR.HOP, 0x00, [...Buffer.from('HOP-U2')])            // 244 product    [3](https://com0com.sourceforge.net/doc/UsingCom0com.pdf)
    case 0xF2: return ccFrame(src, CC.ADDR.HOP, 0x00, [0x01,0x02,0x03])                      // 242 serial     [3](https://com0com.sourceforge.net/doc/UsingCom0com.pdf)

    case 0xA4: // 164 Enable hopper (alguns modelos exigem 0xA5; se precisar, valide)        // ref: field note enable=A5 [6](https://github.com/swinton/Virtual-Serial-Ports)
      st.hopper.enabled = true
      return ccFrame(src, CC.ADDR.HOP, 0x00)

    case 0xA6: { // 166 Request status (0=ok/idle; 1=pagando)                                  // ref: hopper status cmd [4](https://sourceforge.net/projects/signed-drivers/files/com0com/)
      const status = st.hopper.pending > 0 ? 0x01 : 0x00
      return ccFrame(src, CC.ADDR.HOP, 0x00, [status])
    }

    case 0xA7: { // 167 Dispense coins (payload: [count])                                      // ref: dispense cmd [4](https://sourceforge.net/projects/signed-drivers/files/com0com/)
      const count = data[0] ?? 0
      st.hopper.pending += count
      setTimeout(() => { st.hopper.pending = Math.max(0, st.hopper.pending - count) }, Math.max(1, count) * 400)
      return ccFrame(src, CC.ADDR.HOP, 0x00) // ACK
    }

    default: return ccFrame(src, CC.ADDR.HOP, 0x05) // NAK
  }
}

// -------------------- Helpers --------------------
function tryToUtf8(buf) {
  try { return buf.toString('utf8') } catch { return '' }
}

// Exemplos de periféricos não-ccTalk (RFID, interface, etc)
function sendRfid(port, cardCode = '12345678') {
  const entry = ports.get(port); if (!entry) return false
  const buf = Buffer.from(String(cardCode).trim() + '\r\n', 'utf8')
  entry.serial.write(buf); return true
}
function sendKitsecStatus(port, statusByte = 0x00) {
  const entry = ports.get(port); if (!entry) return false
  const buf = Buffer.from([0x02, 0x53, statusByte, 0x03])
  entry.serial.write(buf); return true
}
function sendBVEvent(port, eventName = 'inserted', billType = 5) {
  const entry = ports.get(port); if (!entry) return false
  const ev = BV_EVENTS[eventName]; if (!ev) return false
  const st = ccState.get(port) || { queue:[], hopper:{enabled:false,pending:0} }
  st._lastType = billType
  st.queue.push(...ev(billType))
  ccState.set(port, st)
  return true
}
function sendHopperDispenseCmd(port, count = 1) {
  const entry = ports.get(port); if (!entry) return false
  const pkt = ccFrame(CC.ADDR.HOP, CC.HOST, 0xA7, [count]) // 167
  entry.serial.write(pkt); return true
}

// -------------------- WebSocket Control (with fallback) --------------------
let wss = null
let actualControlPort = CONTROL_PORT

async function createWSSWithFallback(start = CONTROL_PORT, maxTries = 20) {
  let port = start
  while (port < start + maxTries) {
    try {
      await new Promise((resolve, reject) => {
        const httpServer = http.createServer()
        httpServer.once('error', (err) => {
          if (err && err.code === 'EADDRINUSE') { reject(err) } else reject(err)
        })
        httpServer.listen(port, '127.0.0.1', () => {
          const server = new WebSocketServer({ server: httpServer })
          wss = server
          setupWSHandlers(server)
          console.log(`[vss] Control WebSocket listening on ws://localhost:${port}/`)
          resolve(null)
        })
      })
      actualControlPort = port
      return port
    } catch (e) {
      if (e.code === 'EADDRINUSE') {
        console.warn(`[vss] port ${port} in use, trying ${port+1}...`); port++; continue
      }
      throw e
    }
  }
  throw new Error('No free port for WebSocket control')
}

function setupWSHandlers(server) {
  server.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'welcome', message: 'virtual-serial-server', ports: Array.from(ports.keys()) }))
    ws.on('message', raw => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { ws.send(JSON.stringify({ error: 'invalid-json' })); return }
      handleWsMessage(ws, msg)
    })
  })
  server.on('error', (err) => console.error('[vss] WebSocket server error:', err.message))
}

function broadcast(obj) {
  if (!wss) return
  const msg = JSON.stringify(obj)
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(msg)
  }
}

function handleWsMessage(ws, msg) {
  const { action } = msg
  switch (action) {
    case 'list':
      ws.send(JSON.stringify({ type: 'ports', ports: Array.from(ports.entries()).map(([p, v]) => ({ port: p, type: v.type })) }))
      break

    case 'write': {
      const { port, data, encoding = 'utf8' } = msg
      const entry = ports.get(port)
      if (!entry) return ws.send(JSON.stringify({ error: 'port-not-open', port }))
      let buf
      if (typeof data === 'string' && data.startsWith('hex:')) buf = Buffer.from(data.replace(/^hex:/, ''), 'hex')
      else if (typeof data === 'string') buf = Buffer.from(data, encoding)
      else if (Array.isArray(data)) buf = Buffer.from(data)
      else return ws.send(JSON.stringify({ error: 'invalid-data' }))
      entry.serial.write(buf)
      ws.send(JSON.stringify({ ok: true }))
      break
    }

    case 'emit': {
      const { port, event, payload } = msg
      if (!ports.has(port)) return ws.send(JSON.stringify({ error: 'port-not-open', port }))
      switch (event) {
        case 'rfid':
          sendRfid(port, payload?.card || payload?.cardCode || '12345678'); ws.send(JSON.stringify({ ok: true })); break
        case 'interface:status':
          sendKitsecStatus(port, payload?.statusByte ?? 0x00); ws.send(JSON.stringify({ ok: true })); break
        case 'bill:insert':
          sendBVEvent(port, 'inserted', Number(payload?.type ?? 5)); ws.send(JSON.stringify({ ok: true })); break
        case 'bill:reject':
          sendBVEvent(port, 'rejected', Number(payload?.type ?? 5)); ws.send(JSON.stringify({ ok: true })); break
        case 'hopper:dispense':
          sendHopperDispenseCmd(port, Number(payload?.count ?? 1)); ws.send(JSON.stringify({ ok: true })); break
        default:
          ws.send(JSON.stringify({ error: 'unknown-event' }))
      }
      break
    }

    case 'help':
    default:
      ws.send(JSON.stringify({
        help: {
          actions: ['list','write','emit'],
          examples: [
            { action: 'emit', event: 'bill:insert',       port: PORTS[1], payload: { type: 5 } },
            { action: 'emit', event: 'hopper:dispense',   port: PORTS[3], payload: { count: 1 } },
            { action: 'write', port: PORTS[0], data: 'hex:02005301f403' } // interface:status exemplo
          ]
        }
      }))
  }
}

// -------------------- Optional TCP ccTalk Bus --------------------
const BUS_PORT = process.env.CCTALK_BUS_PORT ? Number(process.env.CCTALK_BUS_PORT) : null
if (BUS_PORT) {
  net.createServer(sock => {
    console.log('[vss] ccTalk TCP client connected on :'+BUS_PORT)
    const pass = new Transform({ transform(c,_e,cb){ this.push(c); cb() } })
    const parser = pass.pipe(new CCTalkParser(100))
    sock.on('data', d => pass.write(d))
    parser.on('data', buf => {
      const [dest,len,src,header] = buf
      const data = buf.slice(4,4+len)
      // roteia para os handlers usando os estados das portas mapeadas
      const bvPort = findPortByType('bill_acceptor') || findPortByType('coin_acceptor')
      const hopPort = findPortByType('hopper')
      let resp = null
      if (dest === CC.ADDR.BV || dest === 0)  resp = handleBV(dest,len,src,header,data, bvPort ?? '__tcp_bv__')
      if (!resp && (dest === CC.ADDR.HOP || dest === 0)) resp = handleHOP(dest,len,src,header,data, hopPort ?? '__tcp_hop__')
      if (resp) sock.write(resp)
    })
  }).listen(BUS_PORT, () => console.log('[vss] ccTalk TCP bus listening on :'+BUS_PORT))
}

function findPortByType(t){
  for (const [p, v] of ports.entries()) if (v.type === t) return p
  return null
}

// -------------------- Start --------------------
;(async () => {
  await createWSSWithFallback()
  await openAllPorts()

  console.log(`[vss] WS control on ws://localhost:${actualControlPort}/`)
  console.log('[vss] Example via wscat:')
  console.log(`  wscat -c ws://localhost:${actualControlPort}`)
  console.log(`  {"action":"emit","event":"bill:insert","port":"${PORTS[1]}","payload":{"type":5}}`)
  if (BUS_PORT) console.log(`  ccTalk TCP bus on :${BUS_PORT}`)
})()